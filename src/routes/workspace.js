import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { fail, jsonBody, ok } from '../lib/http.js';
import { effectivePermissions, permissionFor } from '../lib/auth.js';
import { effectiveWorkspaceAccess, workspaceModule } from '../lib/workspace.js';
import { normalizeText, nextCode } from '../lib/codes.js';
import { audit } from '../lib/audit.js';

export const workspaceRoutes = new Hono();

const ACTION_COLUMN = {
  VIEW:'can_view', CREATE:'can_create', EDIT:'can_edit', APPROVE:'can_approve',
  POST:'can_post', EXPORT:'can_export', MANAGE:'can_manage',
};

async function requireWorkspaceAccess(c, moduleCode, action = 'VIEW') {
  const user = c.get('erpUser');
  const module = workspaceModule(moduleCode);
  if (!module) return { error:fail(c, 'Unknown enterprise module.', 404) };
  if (user.role_code === 'ADMIN') return { user, module };
  const permissions = await effectivePermissions(c.env.DB, user);
  const access = await effectiveWorkspaceAccess(c.env.DB, user, permissions);
  if (!access.includes(moduleCode)) return { error:fail(c, 'This module is not assigned to your account.', 403) };
  if (action !== 'VIEW') {
    const permission = await permissionFor(c.env.DB, user, module.permission);
    if (!permission[ACTION_COLUMN[action] || 'can_view']) {
      return { error:fail(c, `You do not have ${action.toLowerCase()} access in this module.`, 403) };
    }
  }
  return { user, module };
}

workspaceRoutes.get('/modules/:code/summary', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const code = access.module.code;
  const counts = await first(c.env.DB,
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status='DRAFT' THEN 1 ELSE 0 END) drafts,
            SUM(CASE WHEN status='FOR_APPROVAL' THEN 1 ELSE 0 END) pending,
            SUM(CASE WHEN status IN ('APPROVED','POSTED','CLOSED') THEN 1 ELSE 0 END) completed,
            SUM(CASE WHEN json_extract(payload_json,'$.businessChannel')='B2B' THEN 1 ELSE 0 END) b2b,
            SUM(CASE WHEN json_extract(payload_json,'$.businessChannel')='B2C' THEN 1 ELSE 0 END) b2c,
            SUM(CASE WHEN json_extract(payload_json,'$.businessChannel')='B2B2C' THEN 1 ELSE 0 END) b2b2c
       FROM erp_module_records WHERE module_code=?`, [code]);
  const recent = await all(c.env.DB,
    `SELECT id,record_no,record_type,transaction_date,description,amount,status,owner_email,updated_at,
            json_extract(payload_json,'$.businessChannel') business_channel
       FROM erp_module_records WHERE module_code=? ORDER BY updated_at DESC,id DESC LIMIT 8`, [code]);
  return ok(c, { module:access.module, counts:{
    total:counts?.total||0, drafts:counts?.drafts||0, pending:counts?.pending||0, completed:counts?.completed||0,
    b2b:counts?.b2b||0, b2c:counts?.b2c||0, b2b2c:counts?.b2b2c||0,
  }, recent });
});

workspaceRoutes.get('/modules/:code/records', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const q = normalizeText(c.req.query('q')).toLowerCase();
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const channel = normalizeText(c.req.query('channel')).toUpperCase();
  const params = [access.module.code];
  let where = 'module_code=?';
  if (q) {
    where += ` AND (lower(record_no) LIKE ? OR lower(description) LIKE ? OR lower(entity_name) LIKE ? OR lower(owner_email) LIKE ?)`;
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (status) { where += ' AND status=?'; params.push(status); }
  if (channel) { where += ` AND json_extract(payload_json,'$.businessChannel')=?`; params.push(channel); }
  const rows = await all(c.env.DB,
    `SELECT id,record_no,record_type,transaction_date,entity_name,department,description,amount,status,owner_email,created_at,updated_at,
            json_extract(payload_json,'$.businessChannel') business_channel
       FROM erp_module_records WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 300`, params);
  return ok(c, { rows });
});

workspaceRoutes.get('/modules/:code/records/:id', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const record = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE module_code=? AND id=?`, [access.module.code, Number(c.req.param('id'))]);
  if (!record) return fail(c, 'Record not found.', 404);
  try { record.payload = JSON.parse(record.payload_json || '{}'); } catch { record.payload = {}; }
  delete record.payload_json;
  return ok(c, { record });
});

workspaceRoutes.post('/modules/:code/records', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'), 'CREATE');
  if (access.error) return access.error;
  const b = await jsonBody(c);
  const payload={...(b.payload||{})};
  for(const key of ['businessChannel','contractEndDate','billingFrequency','unitCount']){
    if(b[key]!==undefined)payload[key]=key==='unitCount'?Number(b[key]||0):normalizeText(b[key]);
  }
  const status = ['DRAFT','FOR_APPROVAL'].includes(normalizeText(b.status).toUpperCase()) ? normalizeText(b.status).toUpperCase() : 'DRAFT';
  const recordNo = await nextCode(c.env.DB, `WS_${access.module.groupCode.toUpperCase()}`, access.module.groupCode.toUpperCase(), 8);
  const result = await run(c.env.DB,
    `INSERT INTO erp_module_records(
       record_no,module_code,category_code,record_type,transaction_date,entity_name,department,description,amount,status,owner_email,payload_json,created_by,updated_by
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [recordNo, access.module.code, access.module.groupCode, normalizeText(b.recordType||access.module.label),
     normalizeText(b.transactionDate)||new Date().toISOString().slice(0,10), normalizeText(b.entityName), normalizeText(b.department),
     normalizeText(b.description), Number(b.amount||0), status, normalizeText(b.ownerEmail)||access.user.email,
     JSON.stringify(payload), access.user.email, access.user.email]);
  const record = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE id=?`, [result.meta.last_row_id]);
  await audit(c, { action:'CREATE_WORKSPACE_RECORD', module:access.module.permission, recordType:access.module.code, recordId:record.id, recordNo:record.record_no, after:record });
  return ok(c, { record }, 201);
});

workspaceRoutes.patch('/modules/:code/records/:id', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'), 'EDIT');
  if (access.error) return access.error;
  const id = Number(c.req.param('id'));
  const before = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE module_code=? AND id=?`, [access.module.code, id]);
  if (!before) return fail(c, 'Record not found.', 404);
  const b = await jsonBody(c);
  const payload={...(b.payload||{})};
  for(const key of ['businessChannel','contractEndDate','billingFrequency','unitCount']){
    if(b[key]!==undefined)payload[key]=key==='unitCount'?Number(b[key]||0):normalizeText(b[key]);
  }
  const status = ['DRAFT','FOR_APPROVAL','APPROVED','POSTED','CLOSED','CANCELLED'].includes(normalizeText(b.status).toUpperCase())
    ? normalizeText(b.status).toUpperCase() : before.status;
  await run(c.env.DB,
    `UPDATE erp_module_records SET record_type=?,transaction_date=?,entity_name=?,department=?,description=?,amount=?,status=?,owner_email=?,payload_json=?,updated_by=?,updated_at=datetime('now') WHERE id=?`,
    [normalizeText(b.recordType||before.record_type), normalizeText(b.transactionDate||before.transaction_date), normalizeText(b.entityName),
     normalizeText(b.department), normalizeText(b.description), Number(b.amount||0), status, normalizeText(b.ownerEmail)||access.user.email,
     JSON.stringify(payload), access.user.email, id]);
  const after = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE id=?`, [id]);
  await audit(c, { action:'UPDATE_WORKSPACE_RECORD', module:access.module.permission, recordType:access.module.code, recordId:id, recordNo:after.record_no, before, after });
  return ok(c, { record:after });
});
