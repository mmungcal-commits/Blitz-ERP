import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody } from '../lib/http.js';
import { ERP_MODULES, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeText, nextCode, normalizeSerial } from '../lib/codes.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { WORKSPACE_MODULES } from '../lib/workspace.js';

export const adminRoutes = new Hono();

function userColumns() {
  return `u.id,u.email,u.display_name,u.role_code,u.department,u.live_access,u.active,u.last_login_at,u.created_at,
          CASE WHEN cr.activated_at IS NOT NULL AND cr.password_hash IS NOT NULL THEN 1 ELSE 0 END activated`;
}

async function issueAuthLink(c, user, mode) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const activation = mode === 'activate';
  await run(c.env.DB, `INSERT OR IGNORE INTO erp_user_credentials(user_id) VALUES(?)`, [user.id]);
  await run(c.env.DB,
    activation
      ? `UPDATE erp_user_credentials SET activation_token_hash=?,activation_expires_at=datetime('now','+24 hours'),updated_at=datetime('now') WHERE user_id=?`
      : `UPDATE erp_user_credentials SET reset_token_hash=?,reset_expires_at=datetime('now','+1 hour'),updated_at=datetime('now') WHERE user_id=?`,
    [tokenHash, user.id]);
  const url = new URL(c.req.url);
  const key = activation ? 'activate' : 'reset';
  return `${url.origin}/?${key}=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
}

adminRoutes.get('/users', requirePermission('ADMIN','MANAGE'), async c=>{
  const users=await all(c.env.DB,`SELECT ${userColumns()} FROM erp_users u LEFT JOIN erp_user_credentials cr ON cr.user_id=u.id ORDER BY u.active DESC,u.email`);
  const roles=await all(c.env.DB,`SELECT * FROM erp_roles ORDER BY name`);
  const permissions=await all(c.env.DB,`SELECT * FROM erp_role_permissions ORDER BY role_code,module`);
  const userAccess=await all(c.env.DB,`SELECT user_id,module,allowed FROM erp_user_module_access ORDER BY user_id,module`);
  const workspaceAccess=await all(c.env.DB,`SELECT user_id,module_code,allowed FROM erp_user_workspace_access ORDER BY user_id,module_code`);
  const roleMap=new Map();
  for(const permission of permissions){
    if(!roleMap.has(permission.role_code))roleMap.set(permission.role_code,[]);
    if(permission.can_view)roleMap.get(permission.role_code).push(permission.module);
  }
  const accessMap=new Map();
  for(const access of userAccess){
    if(!accessMap.has(access.user_id))accessMap.set(access.user_id,[]);
    if(access.allowed)accessMap.get(access.user_id).push(access.module);
  }
  const workspaceMap=new Map();
  for(const access of workspaceAccess){
    if(!workspaceMap.has(access.user_id))workspaceMap.set(access.user_id,[]);
    if(access.allowed)workspaceMap.get(access.user_id).push(access.module_code);
  }
  for(const user of users){
    const explicit=userAccess.some(access=>access.user_id===user.id);
    user.allowed_modules=user.role_code==='ADMIN'?[...ERP_MODULES]:(explicit?(accessMap.get(user.id)||[]):(roleMap.get(user.role_code)||[]));
    user.module_count=user.allowed_modules.length;
    const explicitWorkspace=workspaceAccess.some(access=>access.user_id===user.id);
    user.allowed_workspace_modules=user.role_code==='ADMIN'
      ? WORKSPACE_MODULES.map(module=>module.code)
      : (explicitWorkspace
        ? (workspaceMap.get(user.id)||[])
        : WORKSPACE_MODULES.filter(module=>user.allowed_modules.includes(module.permission)).map(module=>module.code));
  }
  return ok(c,{users,roles,permissions,modules:ERP_MODULES,workspaceModules:WORKSPACE_MODULES});
});

adminRoutes.post('/users', requirePermission('ADMIN','MANAGE'), async c=>{
  const b=await jsonBody(c);
  const email=normalizeText(b.email).toLowerCase();
  if(!email.endsWith('@nrdev.ph'))return fail(c,'Only @nrdev.ph accounts are allowed');
  const before=await first(c.env.DB,`SELECT * FROM erp_users WHERE email=?`,[email]);
  if(before){
    await run(c.env.DB,`UPDATE erp_users SET display_name=?,role_code=?,department=?,live_access=?,active=? WHERE email=?`,[normalizeText(b.displayName||before.display_name),b.roleCode||before.role_code,normalizeText(b.department),b.liveAccess?1:0,b.active===false?0:1,email]);
  }else{
    await run(c.env.DB,`INSERT INTO erp_users(email,display_name,role_code,department,live_access,active) VALUES(?,?,?,?,?,?)`,[email,normalizeText(b.displayName||email.split('@')[0]),b.roleCode||'STAFF',normalizeText(b.department),b.liveAccess?1:0,b.active===false?0:1]);
  }
  const after=await first(c.env.DB,`SELECT * FROM erp_users WHERE email=?`,[email]);
  await run(c.env.DB,`INSERT OR IGNORE INTO erp_user_credentials(user_id) VALUES(?)`,[after.id]);
  const modulesProvided=Array.isArray(b.modules);
  const requestedModules=modulesProvided?b.modules.map(value=>normalizeText(value).toUpperCase()).filter(value=>ERP_MODULES.includes(value)):[];
  const allowedModules=after.role_code==='ADMIN'?ERP_MODULES:(modulesProvided?requestedModules:(!before?['DASHBOARD']:null));
  if(allowedModules){
    for(const module of ERP_MODULES){
      await run(c.env.DB,`INSERT INTO erp_user_module_access(user_id,module,allowed,updated_at,updated_by) VALUES(?,?,?,datetime('now'),?) ON CONFLICT(user_id,module) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[after.id,module,allowedModules.includes(module)?1:0,c.get('erpUser').email]);
    }
  }
  const workspaceProvided=Array.isArray(b.workspaceModules);
  if(workspaceProvided){
    const requestedWorkspace=new Set(b.workspaceModules.map(value=>normalizeText(value).toLowerCase()));
    for(const module of WORKSPACE_MODULES){
      await run(c.env.DB,`INSERT INTO erp_user_workspace_access(user_id,module_code,allowed,updated_at,updated_by) VALUES(?,?,?,datetime('now'),?) ON CONFLICT(user_id,module_code) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[after.id,module.code,requestedWorkspace.has(module.code)?1:0,c.get('erpUser').email]);
    }
  }
  const credential=await first(c.env.DB,`SELECT activated_at,password_hash FROM erp_user_credentials WHERE user_id=?`,[after.id]);
  const activationLink=!credential?.activated_at||!credential?.password_hash?await issueAuthLink(c,after,'activate'):null;
  const savedAccess=await all(c.env.DB,`SELECT module FROM erp_user_module_access WHERE user_id=? AND allowed=1 ORDER BY module`,[after.id]);
  const effectiveAllowed=after.role_code==='ADMIN'?ERP_MODULES:savedAccess.map(row=>row.module);
  await audit(c,{action:before?'UPDATE_USER':'CREATE_USER',module:'ADMIN',recordType:'USER',recordId:after.id,recordNo:email,before,after:{...after,allowedModules:effectiveAllowed}});
  const savedWorkspace=await all(c.env.DB,`SELECT module_code FROM erp_user_workspace_access WHERE user_id=? AND allowed=1 ORDER BY module_code`,[after.id]);
  const effectiveWorkspace=after.role_code==='ADMIN'?WORKSPACE_MODULES.map(module=>module.code):savedWorkspace.map(row=>row.module_code);
  return ok(c,{user:{...after,allowed_modules:effectiveAllowed,allowed_workspace_modules:effectiveWorkspace},activationLink});
});

adminRoutes.post('/users/:id/activation', requirePermission('ADMIN','MANAGE'), async c=>{
  const user=await first(c.env.DB,`SELECT * FROM erp_users WHERE id=?`,[Number(c.req.param('id'))]);
  if(!user)return fail(c,'User not found',404);
  const activationLink=await issueAuthLink(c,user,'activate');
  await audit(c,{action:'ISSUE_ACTIVATION',module:'ADMIN',recordType:'USER',recordId:user.id,recordNo:user.email});
  return ok(c,{activationLink});
});

adminRoutes.post('/users/:id/reset', requirePermission('ADMIN','MANAGE'), async c=>{
  const user=await first(c.env.DB,`SELECT * FROM erp_users WHERE id=?`,[Number(c.req.param('id'))]);
  if(!user)return fail(c,'User not found',404);
  const resetLink=await issueAuthLink(c,user,'reset');
  await run(c.env.DB,`DELETE FROM erp_sessions WHERE user_id=?`,[user.id]);
  await audit(c,{action:'ISSUE_PASSWORD_RESET',module:'ADMIN',recordType:'USER',recordId:user.id,recordNo:user.email});
  return ok(c,{resetLink});
});

adminRoutes.post('/permissions/:role', requirePermission('ADMIN','MANAGE'), async c=>{const role=normalizeText(c.req.param('role')).toUpperCase();const b=await jsonBody(c);const rows=Array.isArray(b.permissions)?b.permissions:[];for(const p of rows){if(!ERP_MODULES.includes(p.module))continue;await run(c.env.DB,`INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(role_code,module) DO UPDATE SET can_view=excluded.can_view,can_create=excluded.can_create,can_edit=excluded.can_edit,can_approve=excluded.can_approve,can_post=excluded.can_post,can_export=excluded.can_export,can_manage=excluded.can_manage`,[role,p.module,p.canView?1:0,p.canCreate?1:0,p.canEdit?1:0,p.canApprove?1:0,p.canPost?1:0,p.canExport?1:0,p.canManage?1:0]);}await audit(c,{action:'UPDATE_PERMISSIONS',module:'ADMIN',recordType:'ROLE',recordNo:role,after:{permissions:rows}});return ok(c,{updated:rows.length});});

adminRoutes.get('/diagnostics', requirePermission('ADMIN','MANAGE'), async c=>{const tables=['erp_items','erp_partners','erp_shipments','erp_expected_assets','erp_receipts','erp_assets','erp_stock_ledger','erp_requisitions','erp_sales_orders','erp_deliveries','erp_reconciliation_cases','erp_serial_exceptions'];const counts={};for(const table of tables){counts[table]=(await first(c.env.DB,`SELECT COUNT(*) n FROM ${table}`))?.n||0;}const invariants={duplicateAssets:(await first(c.env.DB,`SELECT COUNT(*) n FROM (SELECT serial_no FROM erp_assets GROUP BY serial_no HAVING COUNT(*)>1)`))?.n||0,orphanMovements:(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_stock_ledger l LEFT JOIN erp_assets a ON a.id=l.asset_id WHERE l.asset_id IS NOT NULL AND a.id IS NULL`))?.n||0,unreconciled:(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_reconciliation_cases WHERE status='UNRECONCILED'`))?.n||0,availableOnHold:(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_assets WHERE current_status IN ('AVAILABLE','IN_STOCK') AND reconciliation_status!='CLEAR'`))?.n||0};return ok(c,{counts,invariants,healthy:invariants.duplicateAssets===0&&invariants.orphanMovements===0});});

adminRoutes.post('/qr-review', requirePermission('INVENTORY','CREATE'), async c=>{const b=await jsonBody(c);const serial=normalizeSerial(b.detectedSerial||b.rawPayload);const asset=serial?await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=? OR secondary_serial=? LIMIT 1`,[serial,serial]):null;const no=await nextCode(c.env.DB,'QR_REVIEW','QR',8);const r=await run(c.env.DB,`INSERT INTO erp_qr_reviews(review_no,module,raw_payload,detected_serial,asset_id,status,created_by) VALUES(?,?,?,?,?,'FOR_REVIEW',?)`,[no,b.module||'INVENTORY',normalizeText(b.rawPayload),serial,asset?.id||null,c.get('erpUser').email]);return ok(c,{id:r.meta.last_row_id,reviewNo:no,detectedSerial:serial,asset,found:!!asset},201);});

adminRoutes.post('/qr-review/:id/confirm', requirePermission('INVENTORY','POST'), async c=>{const id=Number(c.req.param('id'));const b=await jsonBody(c);const before=await first(c.env.DB,`SELECT * FROM erp_qr_reviews WHERE id=?`,[id]);if(!before)return fail(c,'QR review not found',404);await run(c.env.DB,`UPDATE erp_qr_reviews SET status='CONFIRMED',detected_serial=COALESCE(?,detected_serial),reviewed_by=?,reviewed_at=datetime('now'),posted_record_type=?,posted_record_id=? WHERE id=?`,[b.detectedSerial||null,c.get('erpUser').email,b.postedRecordType||'',b.postedRecordId||null,id]);return ok(c,{confirmed:true});});
