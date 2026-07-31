import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { fail, jsonBody, ok } from '../lib/http.js';
import { effectivePermissions, permissionFor } from '../lib/auth.js';
import { effectiveWorkspaceAccess, workspaceModule } from '../lib/workspace.js';
import { definitionFor } from '../lib/module-definitions.js';
import { normalizeText, nextCode, ensurePartner, ensureItem } from '../lib/codes.js';
import { audit } from '../lib/audit.js';
import {
  syncSpecialistRecord, specialistConnected, validateSpecialistAction, afterSpecialistAction, reverseSpecialistRecord,
  ensureWorkflowApprovals, decideWorkflowApproval, assertWorkflowApprovalsComplete,
} from '../lib/specialist-engine.js';

export const workspaceRoutes = new Hono();

const ACTION_COLUMN = {
  VIEW:'can_view', CREATE:'can_create', EDIT:'can_edit', APPROVE:'can_approve',
  POST:'can_post', EXPORT:'can_export', MANAGE:'can_manage',
};
const IMMUTABLE_STATUSES = new Set([
  'POSTED','CLOSED','COMPLETED','REVERSED','VOIDED','TERMINATED','EXPIRED',
]);

async function sha256Hex(buffer) {
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

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

function fieldPayload(definition,body,existing={}){
  const payload={...existing,...(body.payload||{})};
  for(const field of definition.fields){
    if(body[field.key]===undefined)continue;
    if(field.type==='number')payload[field.key]=Number(body[field.key]||0);
    else if(field.type==='checkbox')payload[field.key]=body[field.key]===true||body[field.key]==='true'||body[field.key]==='on';
    else payload[field.key]=normalizeText(body[field.key]);
  }
  return payload;
}


async function connectedDefinition(db,module){
  const definition=definitionFor(module);
  let submodules=await all(db,`SELECT submodule_code,submodule_name,sequence_no,record_type,
    connected_module_code,posting_event_type FROM erp_module_submodules
    WHERE module_code=? AND active=1 ORDER BY sequence_no,submodule_name`,[module.code]);
  if(!submodules.length){
    submodules=(definition.recordTypes||[]).map((recordType,index)=>({
      submodule_code:normalizeText(recordType).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),
      submodule_name:recordType,sequence_no:(index+1)*10,record_type:recordType,
      connected_module_code:'',posting_event_type:'',
    }));
  }
  return {...definition,submodules};
}

async function syncConnectedRecord(db,moduleCode,record,payload,userEmail){
  if(moduleCode==='sd-crm'&&normalizeText(record.entity_name)){
    const customer=await ensurePartner(db,{
      name:record.entity_name,type:'CUSTOMER',sourceSystem:'CRM',sourceKey:record.record_no,
    });
    const existing=await first(db,`SELECT id FROM erp_crm_activities WHERE workspace_record_id=?`,[record.id]);
    if(!existing){
      const activityNo=await nextCode(db,'CRM_ACTIVITY','CRM-ACT',8);
      await run(db,`INSERT INTO erp_crm_activities(
        activity_no,customer_id,workspace_record_id,activity_type,activity_date,contact_person,
        subject,notes,next_action,next_action_date,status,owner_email,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        activityNo,customer.id,record.id,record.record_type,record.transaction_date,payload.contactPerson||'',
        record.description||record.record_type,record.description||'',payload.salesStage||'',
        payload.nextActionDate||'',record.status,record.owner_email,userEmail,
      ]);
    }else{
      await run(db,`UPDATE erp_crm_activities SET customer_id=?,activity_type=?,activity_date=?,
        contact_person=?,subject=?,notes=?,next_action=?,next_action_date=?,status=?,owner_email=?
        WHERE workspace_record_id=?`,[
        customer.id,record.record_type,record.transaction_date,payload.contactPerson||'',
        record.description||record.record_type,record.description||'',payload.salesStage||'',
        payload.nextActionDate||'',record.status,record.owner_email,record.id,
      ]);
    }
  }
  if(moduleCode==='sd-lease-contract-management'){
    let customer=null;
    if(normalizeText(payload.clientName)){
      customer=await ensurePartner(db,{
        name:payload.clientName,type:'CUSTOMER',address:payload.clientAddress||'',
        email:payload.clientEmail||'',sourceSystem:'LEASE_CONTRACT',sourceKey:record.record_no,
      });
    }
    await run(db,`INSERT INTO erp_lease_contracts(
      lease_no,workspace_record_id,customer_id,business_channel,service_provider,service_provider_address,
      client_name,client_address,client_email,leased_units_description,replacement_value,
      contract_term_months,lock_in_months,effective_date,end_of_term,daily_rate_vat_ex,late_penalty,
      billing_basis,payment_channel,provider_authorized_rep,client_authorized_rep,billing_frequency,
      unit_count,deposit_amount,status,created_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(workspace_record_id) DO UPDATE SET
        customer_id=excluded.customer_id,business_channel=excluded.business_channel,
        service_provider=excluded.service_provider,service_provider_address=excluded.service_provider_address,
        client_name=excluded.client_name,client_address=excluded.client_address,client_email=excluded.client_email,
        leased_units_description=excluded.leased_units_description,replacement_value=excluded.replacement_value,
        contract_term_months=excluded.contract_term_months,lock_in_months=excluded.lock_in_months,
        effective_date=excluded.effective_date,end_of_term=excluded.end_of_term,
        daily_rate_vat_ex=excluded.daily_rate_vat_ex,late_penalty=excluded.late_penalty,
        billing_basis=excluded.billing_basis,payment_channel=excluded.payment_channel,
        provider_authorized_rep=excluded.provider_authorized_rep,
        client_authorized_rep=excluded.client_authorized_rep,billing_frequency=excluded.billing_frequency,
        unit_count=excluded.unit_count,deposit_amount=excluded.deposit_amount,status=excluded.status,
        updated_at=datetime('now')`,[
      record.record_no,record.id,customer?.id||null,payload.businessChannel||'B2B',
      payload.serviceProvider||'E88 Ventures, Inc.',payload.serviceProviderAddress||'',
      payload.clientName||record.entity_name||'',payload.clientAddress||'',payload.clientEmail||'',
      payload.leasedUnitsDescription||'',Number(payload.replacementValue||0),
      Number(payload.contractTermMonths||0),Number(payload.lockInMonths||0),
      payload.contractStartDate||record.transaction_date||'',payload.contractEndDate||'',
      Number(payload.dailyLeaseRate||0),payload.latePenalty||'',payload.billingBasis||'',
      payload.paymentChannel||'',payload.providerAuthorizedRep||'',payload.clientAuthorizedRep||'',
      payload.billingFrequency||'',Number(payload.unitCount||0),Number(payload.depositAmount||0),
      record.status,userEmail,
    ]);
  }
  if(moduleCode==='sd-pim'&&normalizeText(payload.itemCode)){
    const item=await ensureItem(db,{
      itemCode:payload.itemCode,itemName:record.entity_name||record.description||payload.model||payload.itemCode,
      category:payload.category,manufacturer:payload.brand,model:payload.model,
      serialized:['MC','BAT','BSS','CHG'].includes(normalizeText(payload.category).toUpperCase()),
      standardCost:Number(payload.standardCost||0),autoCreated:false,sourceSystem:'PIM',sourceKey:record.record_no,
    });
    await run(db,`UPDATE erp_items SET item_name=?,manufacturer=?,model=?,base_uom=?,
      standard_cost=?,active=?,auto_created=0,source_system='PIM',source_key=?,updated_at=datetime('now')
      WHERE id=?`,[
      normalizeText(record.entity_name||record.description||item.item_name),normalizeText(payload.brand),
      normalizeText(payload.model),normalizeText(payload.uom||'EA'),Number(payload.standardCost||0),
      record.status==='INACTIVE'?0:1,record.record_no,item.id,
    ]);
  }
  if(moduleCode==='ip-supplier-portal'&&normalizeText(payload.supplierName||record.entity_name)){
    await ensurePartner(db,{
      name:payload.supplierName||record.entity_name,type:'VENDOR',code:payload.supplierCode||'',
      email:payload.contactEmail||'',sourceSystem:'SUPPLIER_PORTAL',sourceKey:record.record_no,
    });
  }
  if(moduleCode==='ip-subcontracting'&&normalizeText(payload.vendor||record.entity_name)){
    await ensurePartner(db,{
      name:payload.vendor||record.entity_name,type:'VENDOR',sourceSystem:'SUBCONTRACT',
      sourceKey:record.record_no,
    });
  }
  await syncSpecialistRecord(db,moduleCode,record,payload,userEmail);
}

workspaceRoutes.get('/modules/:code/definition', async c => {
  const access=await requireWorkspaceAccess(c,c.req.param('code'));
  if(access.error)return access.error;
  return ok(c,{definition:await connectedDefinition(c.env.DB,access.module)});
});

workspaceRoutes.get('/modules/:code/summary', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const code = access.module.code;
  const definition=await connectedDefinition(c.env.DB,access.module);
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
            payload_json,json_extract(payload_json,'$.businessChannel') business_channel
       FROM erp_module_records WHERE module_code=? ORDER BY updated_at DESC,id DESC LIMIT 8`, [code]);
  const statusCounts=await all(c.env.DB,`
    SELECT status,COUNT(*) count FROM erp_module_records WHERE module_code=? GROUP BY status ORDER BY status`,[code]);
  const typeCounts=await all(c.env.DB,`
    SELECT record_type,COUNT(*) count FROM erp_module_records WHERE module_code=? GROUP BY record_type ORDER BY count DESC`,[code]);
  const parsedRecent=recent.map(row=>{
    try{row.payload=JSON.parse(row.payload_json||'{}');}catch{row.payload={};}
    delete row.payload_json;return row;
  });
  return ok(c, { module:access.module,definition,statusCounts,typeCounts,counts:{
    total:counts?.total||0, drafts:counts?.drafts||0, pending:counts?.pending||0, completed:counts?.completed||0,
    b2b:counts?.b2b||0, b2c:counts?.b2c||0, b2b2c:counts?.b2b2c||0,
  }, recent:parsedRecent });
});

workspaceRoutes.get('/modules/:code/records', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const q = normalizeText(c.req.query('q')).toLowerCase();
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const type = normalizeText(c.req.query('type'));
  const channel = normalizeText(c.req.query('channel')).toUpperCase();
  const params = [access.module.code];
  let where = 'module_code=?';
  if (q) {
    where += ` AND (lower(record_no) LIKE ? OR lower(description) LIKE ? OR lower(entity_name) LIKE ? OR lower(owner_email) LIKE ?)`;
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (status) { where += ' AND status=?'; params.push(status); }
  if (type) { where += ' AND record_type=?'; params.push(type); }
  if (channel) { where += ` AND json_extract(payload_json,'$.businessChannel')=?`; params.push(channel); }
  const rows = await all(c.env.DB,
    `SELECT id,record_no,record_type,transaction_date,entity_name,department,description,amount,status,owner_email,created_at,updated_at,
            payload_json,json_extract(payload_json,'$.businessChannel') business_channel
       FROM erp_module_records WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 300`, params);
  return ok(c, { rows:rows.map(row=>{
    try{row.payload=JSON.parse(row.payload_json||'{}');}catch{row.payload={};}
    delete row.payload_json;
    return row;
  }) });
});

workspaceRoutes.get('/modules/:code/records/:id', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'));
  if (access.error) return access.error;
  const record = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE module_code=? AND id=?`, [access.module.code, Number(c.req.param('id'))]);
  if (!record) return fail(c, 'Record not found.', 404);
  try { record.payload = JSON.parse(record.payload_json || '{}'); } catch { record.payload = {}; }
  delete record.payload_json;
  const documents=await all(c.env.DB,`
    SELECT id,document_no,document_type,file_name,content_type,file_size,uploaded_by,uploaded_at
    FROM erp_documents
    WHERE module=? AND record_type='WORKSPACE_RECORD' AND record_id=? AND active=1
    ORDER BY uploaded_at DESC,id DESC`,[access.module.code,record.id]);
  let connected={};
  if(access.module.code==='sd-lease-contract-management'){
    const lease=await first(c.env.DB,`SELECT * FROM erp_lease_contracts WHERE workspace_record_id=?`,[record.id]);
    const units=lease?await all(c.env.DB,`SELECT u.*,a.item_name,a.category,a.current_status,a.current_location_code
      FROM erp_lease_contract_units u JOIN erp_assets a ON a.id=u.asset_id
      WHERE u.lease_contract_id=? ORDER BY a.category,a.item_name,u.serial_no`,[lease.id]):[];
    const availableAssets=await all(c.env.DB,`SELECT a.id,a.serial_no,a.item_code,a.item_name,a.category,
      a.current_location_code,a.current_status
      FROM erp_assets a
      WHERE a.active=1 AND a.current_status IN ('AVAILABLE','IN_STOCK','RESERVED_FOR_ASSIGNMENT')
        AND a.reconciliation_status='CLEAR'
        AND NOT EXISTS(
          SELECT 1 FROM erp_lease_contract_units u
          JOIN erp_lease_contracts lc ON lc.id=u.lease_contract_id
          WHERE u.asset_id=a.id AND lc.status NOT IN ('TERMINATED','EXPIRED','VOIDED','REVERSED')
        )
      ORDER BY a.category,a.item_name,a.serial_no LIMIT 2000`);
    connected={lease,units,availableAssets};
  }
  connected={...connected,specialist:await specialistConnected(c.env.DB,access.module.code,record.id)};
  return ok(c, { record,documents,definition:await connectedDefinition(c.env.DB,access.module),connected });
});

workspaceRoutes.post('/modules/:code/records', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'), 'CREATE');
  if (access.error) return access.error;
  const b = await jsonBody(c);
  const definition=definitionFor(access.module);
  const payload=fieldPayload(definition,b);
  for(const field of definition.fields){
    if(field.required&&!String(payload[field.key]??'').trim())return fail(c,`${field.label} is required.`);
  }
  const status = definition.workflow.stages[0];
  const recordType=definition.recordTypes.includes(normalizeText(b.recordType))?normalizeText(b.recordType):definition.recordTypes[0];
  const recordNo = await nextCode(c.env.DB, `WS_${access.module.code.toUpperCase().replaceAll('-','_')}`, definition.prefix, 8);
  const result = await run(c.env.DB,
    `INSERT INTO erp_module_records(
       record_no,module_code,category_code,record_type,transaction_date,entity_name,department,description,amount,status,owner_email,payload_json,created_by,updated_by
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [recordNo, access.module.code, access.module.groupCode, recordType,
     normalizeText(b.transactionDate)||new Date().toISOString().slice(0,10), normalizeText(b.entityName), normalizeText(b.department),
     normalizeText(b.description), Number(b.amount||0), status, normalizeText(b.ownerEmail)||access.user.email,
     JSON.stringify(payload), access.user.email, access.user.email]);
  const record = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE id=?`, [result.meta.last_row_id]);
  await syncConnectedRecord(c.env.DB,access.module.code,record,payload,access.user.email);
  await audit(c, { action:'CREATE_WORKSPACE_RECORD', module:access.module.permission, recordType:access.module.code, recordId:record.id, recordNo:record.record_no, after:record });
  return ok(c, { record }, 201);
});

workspaceRoutes.patch('/modules/:code/records/:id', async c => {
  const access = await requireWorkspaceAccess(c, c.req.param('code'), 'EDIT');
  if (access.error) return access.error;
  const id = Number(c.req.param('id'));
  const before = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE module_code=? AND id=?`, [access.module.code, id]);
  if (!before) return fail(c, 'Record not found.', 404);
  if(IMMUTABLE_STATUSES.has(before.status)){
    return fail(c,`${before.record_no} is ${before.status}. Preserve it and use the approval-controlled reversal or void process.`,409);
  }
  const b = await jsonBody(c);
  const definition=definitionFor(access.module);
  let existingPayload={};
  try{existingPayload=JSON.parse(before.payload_json||'{}');}catch{}
  const payload=fieldPayload(definition,b,existingPayload);
  for(const field of definition.fields){
    if(field.required&&!String(payload[field.key]??'').trim())return fail(c,`${field.label} is required.`);
  }
  const recordType=definition.recordTypes.includes(normalizeText(b.recordType))?normalizeText(b.recordType):before.record_type;
  const status = before.status;
  await run(c.env.DB,
    `UPDATE erp_module_records SET record_type=?,transaction_date=?,entity_name=?,department=?,description=?,amount=?,status=?,owner_email=?,payload_json=?,updated_by=?,updated_at=datetime('now') WHERE id=?`,
    [recordType, normalizeText(b.transactionDate||before.transaction_date), normalizeText(b.entityName),
     normalizeText(b.department), normalizeText(b.description), Number(b.amount||0), status, normalizeText(b.ownerEmail)||access.user.email,
     JSON.stringify(payload), access.user.email, id]);
  const after = await first(c.env.DB, `SELECT * FROM erp_module_records WHERE id=?`, [id]);
  await syncConnectedRecord(c.env.DB,access.module.code,after,payload,access.user.email);
  await audit(c, { action:'UPDATE_WORKSPACE_RECORD', module:access.module.permission, recordType:access.module.code, recordId:id, recordNo:after.record_no, before, after });
  return ok(c, { record:after });
});

workspaceRoutes.post('/modules/:code/records/:id/action', async c => {
  const module=workspaceModule(c.req.param('code'));
  if(!module)return fail(c,'Unknown enterprise module.',404);
  const definition=definitionFor(module);
  const b=await jsonBody(c);
  const action=definition.workflow.actions.find(value=>value.code===normalizeText(b.action).toUpperCase());
  if(!action)return fail(c,'Invalid workflow action.');
  if(action.code==='REVERSE')return fail(c,'A posted record must be reversed through an approved change request.',409);
  const access=await requireWorkspaceAccess(c,module.code,action.permission);
  if(access.error)return access.error;
  const id=Number(c.req.param('id'));
  const before=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE module_code=? AND id=?`,[module.code,id]);
  if(!before)return fail(c,'Record not found.',404);
  if(!action.from.includes(before.status))return fail(c,`${action.label} is not allowed while the record is ${before.status}.`,409);
  let beforePayload={};try{beforePayload=JSON.parse(before.payload_json||'{}');}catch{}
  try{await validateSpecialistAction(c.env.DB,module.code,before,beforePayload,action);}catch(error){return fail(c,error.message,409);}
  let approvalDecision=null;
  let targetStatus=action.to;
  try{
    if(action.permission==='APPROVE'){
      approvalDecision=await decideWorkflowApproval(c.env.DB,module.code,before,access.user,b.decision||'APPROVE',b.notes||'');
      if(approvalDecision.rejected)targetStatus='DRAFT';
      else if(!approvalDecision.completed)targetStatus=before.status;
    }else if(action.permission==='POST')await assertWorkflowApprovalsComplete(c.env.DB,before.id);
  }catch(error){return fail(c,error.message,409);}
  await run(c.env.DB,`
    UPDATE erp_module_records SET status=?,updated_by=?,updated_at=datetime('now') WHERE id=?`,
    [targetStatus,access.user.email,id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=?`,[id]);
  let payload={};try{payload=JSON.parse(after.payload_json||'{}');}catch{}
  if(['FOR_APPROVAL','SUBMITTED','BASELINE'].includes(targetStatus))await ensureWorkflowApprovals(c.env.DB,module.code,after,access.user.email);
  await syncConnectedRecord(c.env.DB,module.code,after,payload,access.user.email);
  const effectiveAction={...action,to:targetStatus};
  const financeEvent=targetStatus===action.to?await afterSpecialistAction(c.env.DB,module.code,after,payload,effectiveAction,access.user.email):null;
  await audit(c,{action:`WORKSPACE_${action.code}`,module:module.permission,recordType:module.code,
    recordId:id,recordNo:after.record_no,before,after,metadata:{approvalDecision}});
  return ok(c,{record:after,action:effectiveAction,approvalDecision,financeEvent});
});

workspaceRoutes.get('/modules/:code/change-requests', async c => {
  const access=await requireWorkspaceAccess(c,c.req.param('code'),'VIEW');
  if(access.error)return access.error;
  const rows=await all(c.env.DB,`SELECT * FROM erp_record_change_requests
    WHERE module_code=? ORDER BY CASE status WHEN 'REQUESTED' THEN 0 ELSE 1 END,requested_at DESC,id DESC`,[
    access.module.code,
  ]);
  return ok(c,{rows});
});

workspaceRoutes.post('/modules/:code/records/:id/change-requests', async c => {
  const access=await requireWorkspaceAccess(c,c.req.param('code'),'EDIT');
  if(access.error)return access.error;
  const id=Number(c.req.param('id'));
  const record=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE module_code=? AND id=?`,[
    access.module.code,id,
  ]);
  if(!record)return fail(c,'Record not found.',404);
  if(['VOIDED','REVERSED'].includes(record.status)){
    return fail(c,`${record.record_no} is already ${record.status}.`,409);
  }
  const b=await jsonBody(c);
  const actionType=normalizeText(b.actionType).toUpperCase();
  if(!['DELETE','REVERSE'].includes(actionType))return fail(c,'Choose delete or reverse.');
  if(actionType==='REVERSE'&&!['POSTED','ACTIVE','CLOSED','COMPLETED'].includes(record.status)){
    return fail(c,'Only a posted, active, closed, or completed record can be reversed.',409);
  }
  const reason=normalizeText(b.reason);
  if(reason.length<8)return fail(c,'Enter a clear reason for the approval request.');
  const open=await first(c.env.DB,`SELECT request_no FROM erp_record_change_requests
    WHERE record_id=? AND action_type=? AND status='REQUESTED'`,[id,actionType]);
  if(open)return fail(c,`${open.request_no} is already awaiting approval.`,409);
  const requestNo=await nextCode(c.env.DB,'CHANGE_REQUEST','CHG',8);
  const inserted=await run(c.env.DB,`INSERT INTO erp_record_change_requests(
    request_no,module_code,record_id,record_no,action_type,reason,requested_by)
    VALUES(?,?,?,?,?,?,?)`,[
    requestNo,access.module.code,id,record.record_no,actionType,reason,access.user.email,
  ]);
  await audit(c,{action:`REQUEST_${actionType}`,module:access.module.permission,recordType:access.module.code,
    recordId:id,recordNo:record.record_no,before:record,after:{requestNo,reason,status:'REQUESTED'}});
  return ok(c,{request:{id:inserted.meta.last_row_id,requestNo,status:'REQUESTED'}},201);
});

workspaceRoutes.post('/modules/:code/change-requests/:requestId/decision', async c => {
  const access=await requireWorkspaceAccess(c,c.req.param('code'),'APPROVE');
  if(access.error)return access.error;
  const requestId=Number(c.req.param('requestId'));
  const request=await first(c.env.DB,`SELECT * FROM erp_record_change_requests
    WHERE id=? AND module_code=?`,[requestId,access.module.code]);
  if(!request)return fail(c,'Change request not found.',404);
  if(request.status!=='REQUESTED')return fail(c,'Change request has already been decided.',409);
  if(request.requested_by===access.user.email)return fail(c,'The requester cannot approve their own deletion or reversal.',409);
  const b=await jsonBody(c);
  const decision=normalizeText(b.decision).toUpperCase();
  const notes=normalizeText(b.notes);
  if(!['APPROVE','REJECT'].includes(decision))return fail(c,'Choose approve or reject.');
  if(decision==='REJECT'){
    await run(c.env.DB,`UPDATE erp_record_change_requests SET status='REJECTED',rejected_by=?,
      rejected_at=datetime('now'),decision_notes=? WHERE id=?`,[access.user.email,notes,requestId]);
    await audit(c,{action:'REJECT_CHANGE_REQUEST',module:access.module.permission,
      recordType:access.module.code,recordId:request.record_id,recordNo:request.record_no,after:{request,notes}});
    return ok(c,{status:'REJECTED'});
  }
  const before=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=? AND module_code=?`,[
    request.record_id,access.module.code,
  ]);
  if(!before)return fail(c,'Target record not found.',404);
  const targetStatus=request.action_type==='REVERSE'?'REVERSED':'VOIDED';
  await run(c.env.DB,`UPDATE erp_module_records SET status=?,updated_by=?,updated_at=datetime('now')
    WHERE id=?`,[targetStatus,access.user.email,before.id]);
  await run(c.env.DB,`UPDATE erp_record_change_requests SET status='EXECUTED',approved_by=?,
    approved_at=datetime('now'),decision_notes=?,executed_by=?,executed_at=datetime('now') WHERE id=?`,[
    access.user.email,notes,access.user.email,requestId,
  ]);
  const after=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=?`,[before.id]);
  let payload={};try{payload=JSON.parse(after.payload_json||'{}');}catch{}
  await syncConnectedRecord(c.env.DB,access.module.code,after,payload,access.user.email);
  if(request.action_type==='REVERSE')await reverseSpecialistRecord(c.env.DB,access.module.code,after,access.user.email,request.request_no);
  await audit(c,{action:`APPROVE_${request.action_type}`,module:access.module.permission,
    recordType:access.module.code,recordId:before.id,recordNo:before.record_no,before,after});
  return ok(c,{status:'EXECUTED',record:after});
});

workspaceRoutes.post('/modules/:code/records/:id/documents', async c => {
  const access=await requireWorkspaceAccess(c,c.req.param('code'),'EDIT');
  if(access.error)return access.error;
  const recordId=Number(c.req.param('id'));
  const record=await first(c.env.DB,`
    SELECT * FROM erp_module_records WHERE module_code=? AND id=?`,[access.module.code,recordId]);
  if(!record)return fail(c,'Record not found.',404);
  if(!c.env.DOCS)return fail(c,'Document storage is not configured.',503);
  const form=await c.req.raw.formData();
  const file=form.get('file');
  if(!(file instanceof File))return fail(c,'Choose a contract or supporting document.');
  if(file.size>15*1024*1024)return fail(c,'Document must be 15 MB or smaller.');
  const allowed=[
    'application/pdf','image/png','image/jpeg','image/webp',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv',
  ];
  if(file.type&&!allowed.includes(file.type))return fail(c,'Upload a PDF, image, Word, Excel, or CSV file.');
  const buffer=await file.arrayBuffer();
  const documentNo=await nextCode(c.env.DB,'DOCUMENT','DOC',8);
  const safeName=file.name.replace(/[^A-Za-z0-9._-]+/g,'_');
  const storageKey=`workspace/${access.module.code}/${record.record_no}/${documentNo}-${safeName}`;
  await c.env.DOCS.put(storageKey,buffer,{httpMetadata:{contentType:file.type||'application/octet-stream'}});
  const inserted=await run(c.env.DB,`
    INSERT INTO erp_documents(
      document_no,module,record_type,record_id,record_no,document_type,file_name,storage_key,
      content_type,file_size,file_hash,uploaded_by)
    VALUES(?,?,'WORKSPACE_RECORD',?,?,?,?,?,?,?,?,?)`,
    [documentNo,access.module.code,recordId,record.record_no,normalizeText(form.get('documentType')||'CONTRACT'),
     file.name,storageKey,file.type||'application/octet-stream',file.size,await sha256Hex(buffer),access.user.email]);
  if(access.module.code==='sd-lease-contract-management'&&normalizeText(form.get('documentType')).toUpperCase()==='CONTRACT'){
    await run(c.env.DB,`UPDATE erp_lease_contracts SET signed_document_id=?,updated_at=datetime('now')
      WHERE workspace_record_id=?`,[inserted.meta.last_row_id,recordId]);
  }
  await audit(c,{action:'UPLOAD_WORKSPACE_DOCUMENT',module:access.module.permission,recordType:access.module.code,
    recordId,recordNo:record.record_no,after:{documentId:inserted.meta.last_row_id,documentNo,fileName:file.name}});
  return ok(c,{document:{id:inserted.meta.last_row_id,documentNo,fileName:file.name}},201);
});

workspaceRoutes.post('/modules/sd-lease-contract-management/records/:id/units', async c => {
  const access=await requireWorkspaceAccess(c,'sd-lease-contract-management','EDIT');
  if(access.error)return access.error;
  const recordId=Number(c.req.param('id'));
  const lease=await first(c.env.DB,`SELECT lc.*,r.record_no FROM erp_lease_contracts lc
    JOIN erp_module_records r ON r.id=lc.workspace_record_id
    WHERE lc.workspace_record_id=?`,[recordId]);
  if(!lease)return fail(c,'Save the lease contract before adding units.',404);
  const b=await jsonBody(c);
  const serials=[...new Set((Array.isArray(b.serials)?b.serials:[]).map(value=>normalizeText(value).toUpperCase()).filter(Boolean))];
  if(!serials.length)return fail(c,'Select at least one available serial.');
  const added=[];
  for(const serial of serials){
    const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=? AND active=1`,[serial]);
    if(!asset)return fail(c,`Serial ${serial} is not registered.`);
    if(!['AVAILABLE','IN_STOCK','RESERVED_FOR_ASSIGNMENT'].includes(asset.current_status)||asset.reconciliation_status!=='CLEAR'){
      return fail(c,`Serial ${serial} is not available for this lease.`,409);
    }
    const other=await first(c.env.DB,`SELECT lc.lease_no FROM erp_lease_contract_units u
      JOIN erp_lease_contracts lc ON lc.id=u.lease_contract_id
      WHERE u.asset_id=? AND lc.id!=? AND lc.status NOT IN ('TERMINATED','EXPIRED','VOIDED','REVERSED')`,[
      asset.id,lease.id,
    ]);
    if(other)return fail(c,`Serial ${serial} is already linked to ${other.lease_no}.`,409);
    await run(c.env.DB,`INSERT INTO erp_lease_contract_units(
      lease_contract_id,asset_id,serial_no,item_code,unit_role,replacement_value,daily_rate_vat_ex,
      start_date,end_date,status)
      VALUES(?,?,?,?,?,?,?,?,?,'PLANNED')
      ON CONFLICT(lease_contract_id,asset_id) DO UPDATE SET
        unit_role=excluded.unit_role,replacement_value=excluded.replacement_value,
        daily_rate_vat_ex=excluded.daily_rate_vat_ex,start_date=excluded.start_date,end_date=excluded.end_date`,[
      lease.id,asset.id,asset.serial_no,asset.item_code,asset.category,
      Number(b.replacementValue||lease.replacement_value||0),Number(b.dailyRate||lease.daily_rate_vat_ex||0),
      lease.effective_date||'',lease.end_of_term||'',
    ]);
    added.push(serial);
  }
  await run(c.env.DB,`UPDATE erp_lease_contracts SET unit_count=(
    SELECT COUNT(*) FROM erp_lease_contract_units WHERE lease_contract_id=?
  ),updated_at=datetime('now') WHERE id=?`,[lease.id,lease.id]);
  await audit(c,{action:'ADD_LEASE_UNITS',module:'SALES',recordType:'LEASE_CONTRACT',recordId:lease.id,
    recordNo:lease.lease_no,after:{serials:added}});
  return ok(c,{leaseNo:lease.lease_no,added});
});

workspaceRoutes.get('/documents/:id/file', async c => {
  const document=await first(c.env.DB,`SELECT * FROM erp_documents WHERE id=? AND active=1`,[Number(c.req.param('id'))]);
  if(!document)return fail(c,'Document not found.',404);
  const access=await requireWorkspaceAccess(c,document.module,'VIEW');
  if(access.error)return access.error;
  if(!c.env.DOCS)return fail(c,'Document storage is not configured.',503);
  const object=await c.env.DOCS.get(document.storage_key);
  if(!object)return fail(c,'Stored file not found.',404);
  const headers=new Headers();
  headers.set('Content-Type',document.content_type||'application/octet-stream');
  headers.set('Content-Disposition',`inline; filename="${document.file_name.replaceAll('"','')}"`);
  headers.set('Cache-Control','private, no-store');
  return new Response(object.body,{headers});
});
