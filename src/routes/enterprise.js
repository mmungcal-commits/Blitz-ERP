import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { fail, jsonBody, ok } from '../lib/http.js';
import { effectivePermissions, permissionFor } from '../lib/auth.js';
import { effectiveWorkspaceAccess, workspaceModule } from '../lib/workspace.js';
import { audit } from '../lib/audit.js';
import {
  specialistConnected, addSpecialistLine, deleteSpecialistLine, rolloutReadiness,
  createIntegrationRun,
} from '../lib/specialist-engine.js';

export const enterpriseRoutes = new Hono();

const ACTION_COLUMN={VIEW:'can_view',CREATE:'can_create',EDIT:'can_edit',APPROVE:'can_approve',POST:'can_post',EXPORT:'can_export',MANAGE:'can_manage'};

async function access(c,moduleCode,action='VIEW'){
  const user=c.get('erpUser');
  const module=workspaceModule(moduleCode);
  if(!module)return {error:fail(c,'Unknown enterprise module.',404)};
  if(user.session_scope==='ADMIN')return {error:fail(c,'Admin-scope sessions do not have access to operational modules.',403)};
  const permissions=await effectivePermissions(c.env.DB,user);
  const assigned=await effectiveWorkspaceAccess(c.env.DB,user,permissions);
  if(!assigned.includes(moduleCode))return {error:fail(c,'This module is not assigned to your account.',403)};
  if(action!=='VIEW'){
    const permission=await permissionFor(c.env.DB,user,module.permission);
    if(!permission[ACTION_COLUMN[action]||'can_view'])return {error:fail(c,`You do not have ${action.toLowerCase()} access in this module.`,403)};
  }
  return {user,module};
}

enterpriseRoutes.get('/readiness',async c=>{
  const user=c.get('erpUser');
  if(user.session_scope!=='ADMIN'){
    const permission=await permissionFor(c.env.DB,user,'DASHBOARD');
    if(!permission.can_view)return fail(c,'Dashboard access is required.',403);
  }
  return ok(c,await rolloutReadiness(c.env.DB));
});

enterpriseRoutes.get('/modules/:code/records/:id',async c=>{
  const a=await access(c,c.req.param('code'),'VIEW');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT id,record_no,module_code,status FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  return ok(c,{specialist:await specialistConnected(c.env.DB,a.module.code,record.id)});
});

enterpriseRoutes.post('/modules/:code/records/:id/lines',async c=>{
  const a=await access(c,c.req.param('code'),'EDIT');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  if(['POSTED','CLOSED','COMPLETED','REVERSED','VOIDED','TERMINATED','EXPIRED'].includes(record.status))return fail(c,'The record is protected. Reverse it through approval instead of changing detail lines.',409);
  try{
    const specialist=await addSpecialistLine(c.env.DB,a.module.code,record.id,await jsonBody(c),a.user.email);
    await audit(c,{action:'ADD_SPECIALIST_LINE',module:a.module.permission,recordType:a.module.code,recordId:record.id,recordNo:record.record_no,after:{lineCount:specialist.lines.length}});
    return ok(c,{specialist},201);
  }catch(error){return fail(c,error.message,409);}
});

enterpriseRoutes.delete('/modules/:code/records/:id/lines/:lineId',async c=>{
  const a=await access(c,c.req.param('code'),'EDIT');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  if(record.status!=='DRAFT'&&record.status!=='OPEN')return fail(c,'Only draft or open records may remove unposted detail lines.',409);
  try{
    const result=await deleteSpecialistLine(c.env.DB,a.module.code,record.id,Number(c.req.param('lineId')),a.user.email);
    await audit(c,{action:'DELETE_SPECIALIST_LINE',module:a.module.permission,recordType:a.module.code,recordId:record.id,recordNo:record.record_no,after:result});
    return ok(c,result);
  }catch(error){return fail(c,error.message,409);}
});

enterpriseRoutes.get('/approval-matrices',async c=>{
  const user=c.get('erpUser');
  if(user.session_scope!=='ADMIN')return fail(c,'Administrator access is required.',403);
  return ok(c,{rows:await all(c.env.DB,`SELECT m.*,u.email approver_email FROM erp_approval_matrices m LEFT JOIN erp_users u ON u.id=m.approver_user_id ORDER BY module_code,document_type,amount_from,step_no`)});
});

enterpriseRoutes.post('/approval-matrices',async c=>{
  const user=c.get('erpUser');if(user.session_scope!=='ADMIN')return fail(c,'Administrator access is required.',403);
  const b=await jsonBody(c);
  if(!b.moduleCode||!b.approverRoleCode)return fail(c,'Module and approver role are required.');
  if(b.moduleCode!=='*'&&!workspaceModule(b.moduleCode))return fail(c,'Unknown enterprise module.');
  const role=await first(c.env.DB,`SELECT code FROM erp_roles WHERE code=? AND active=1`,[b.approverRoleCode]);
  if(!role)return fail(c,'Approver role is not active.');
  if(Number(b.amountFrom||0)<0)return fail(c,'Amount from cannot be negative.');
  if(b.amountTo!==''&&b.amountTo!=null&&Number(b.amountTo)<Number(b.amountFrom||0))return fail(c,'Amount to must be greater than or equal to amount from.');
  const matrixCode=b.matrixCode||`APR-${Date.now()}`;
  await run(c.env.DB,`INSERT INTO erp_approval_matrices(matrix_code,module_code,document_type,department,amount_from,amount_to,step_no,approver_role_code,approver_user_id,action_code,active,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(matrix_code) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    department=excluded.department,amount_from=excluded.amount_from,amount_to=excluded.amount_to,step_no=excluded.step_no,
    approver_role_code=excluded.approver_role_code,approver_user_id=excluded.approver_user_id,action_code=excluded.action_code,active=excluded.active`,[
    matrixCode,b.moduleCode,b.documentType||'*',b.department||'*',Number(b.amountFrom||0),b.amountTo===''||b.amountTo==null?null:Number(b.amountTo),Number(b.stepNo||1),b.approverRoleCode,b.approverUserId||null,b.actionCode||'APPROVE',b.active===false?0:1,user.email]);
  await audit(c,{action:'UPSERT_APPROVAL_MATRIX',module:'ADMIN',recordType:'APPROVAL_MATRIX',recordNo:matrixCode,after:b});
  return ok(c,{matrixCode});
});

enterpriseRoutes.post('/integrations/:id/runs',async c=>{
  const user=c.get('erpUser');
  if(user.session_scope!=='ADMIN')return fail(c,'Administrator access is required.',403);
  try{
    const runRecord=await createIntegrationRun(c.env.DB,Number(c.req.param('id')),user.email);
    await audit(c,{action:'START_INTEGRATION_RUN',module:'ADMIN',recordType:'INTEGRATION_RUN',recordId:runRecord.id,recordNo:runRecord.run_no,after:runRecord});
    return ok(c,{run:runRecord},201);
  }catch(error){return fail(c,error.message,409);}
});
import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { fail, jsonBody, ok } from '../lib/http.js';
import { effectivePermissions, permissionFor } from '../lib/auth.js';
import { effectiveWorkspaceAccess, workspaceModule } from '../lib/workspace.js';
import { audit } from '../lib/audit.js';
import {
  specialistConnected, addSpecialistLine, deleteSpecialistLine, rolloutReadiness,
  createIntegrationRun,
} from '../lib/specialist-engine.js';

export const enterpriseRoutes = new Hono();

const ACTION_COLUMN={VIEW:'can_view',CREATE:'can_create',EDIT:'can_edit',APPROVE:'can_approve',POST:'can_post',EXPORT:'can_export',MANAGE:'can_manage'};

async function access(c,moduleCode,action='VIEW'){
  const user=c.get('erpUser');
  const module=workspaceModule(moduleCode);
  if(!module)return {error:fail(c,'Unknown enterprise module.',404)};
  if(user.role_code==='ADMIN')return {user,module};
  const permissions=await effectivePermissions(c.env.DB,user);
  const assigned=await effectiveWorkspaceAccess(c.env.DB,user,permissions);
  if(!assigned.includes(moduleCode))return {error:fail(c,'This module is not assigned to your account.',403)};
  if(action!=='VIEW'){
    const permission=await permissionFor(c.env.DB,user,module.permission);
    if(!permission[ACTION_COLUMN[action]||'can_view'])return {error:fail(c,`You do not have ${action.toLowerCase()} access in this module.`,403)};
  }
  return {user,module};
}

enterpriseRoutes.get('/readiness',async c=>{
  const user=c.get('erpUser');
  if(user.role_code!=='ADMIN'){
    const permission=await permissionFor(c.env.DB,user,'DASHBOARD');
    if(!permission.can_view)return fail(c,'Dashboard access is required.',403);
  }
  return ok(c,await rolloutReadiness(c.env.DB));
});

enterpriseRoutes.get('/modules/:code/records/:id',async c=>{
  const a=await access(c,c.req.param('code'),'VIEW');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT id,record_no,module_code,status FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  return ok(c,{specialist:await specialistConnected(c.env.DB,a.module.code,record.id)});
});

enterpriseRoutes.post('/modules/:code/records/:id/lines',async c=>{
  const a=await access(c,c.req.param('code'),'EDIT');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  if(['POSTED','CLOSED','COMPLETED','REVERSED','VOIDED','TERMINATED','EXPIRED'].includes(record.status))return fail(c,'The record is protected. Reverse it through approval instead of changing detail lines.',409);
  try{
    const specialist=await addSpecialistLine(c.env.DB,a.module.code,record.id,await jsonBody(c),a.user.email);
    await audit(c,{action:'ADD_SPECIALIST_LINE',module:a.module.permission,recordType:a.module.code,recordId:record.id,recordNo:record.record_no,after:{lineCount:specialist.lines.length}});
    return ok(c,{specialist},201);
  }catch(error){return fail(c,error.message,409);}
});

enterpriseRoutes.delete('/modules/:code/records/:id/lines/:lineId',async c=>{
  const a=await access(c,c.req.param('code'),'EDIT');if(a.error)return a.error;
  const record=await first(c.env.DB,`SELECT * FROM erp_module_records WHERE id=? AND module_code=?`,[Number(c.req.param('id')),a.module.code]);
  if(!record)return fail(c,'Record not found.',404);
  if(record.status!=='DRAFT'&&record.status!=='OPEN')return fail(c,'Only draft or open records may remove unposted detail lines.',409);
  try{
    const result=await deleteSpecialistLine(c.env.DB,a.module.code,record.id,Number(c.req.param('lineId')),a.user.email);
    await audit(c,{action:'DELETE_SPECIALIST_LINE',module:a.module.permission,recordType:a.module.code,recordId:record.id,recordNo:record.record_no,after:result});
    return ok(c,result);
  }catch(error){return fail(c,error.message,409);}
});

enterpriseRoutes.get('/approval-matrices',async c=>{
  const user=c.get('erpUser');
  if(user.role_code!=='ADMIN')return fail(c,'Administrator access is required.',403);
  return ok(c,{rows:await all(c.env.DB,`SELECT m.*,u.email approver_email FROM erp_approval_matrices m LEFT JOIN erp_users u ON u.id=m.approver_user_id ORDER BY module_code,document_type,amount_from,step_no`)});
});

enterpriseRoutes.post('/approval-matrices',async c=>{
  const user=c.get('erpUser');if(user.role_code!=='ADMIN')return fail(c,'Administrator access is required.',403);
  const b=await jsonBody(c);
  if(!b.moduleCode||!b.approverRoleCode)return fail(c,'Module and approver role are required.');
  if(b.moduleCode!=='*'&&!workspaceModule(b.moduleCode))return fail(c,'Unknown enterprise module.');
  const role=await first(c.env.DB,`SELECT code FROM erp_roles WHERE code=? AND active=1`,[b.approverRoleCode]);
  if(!role)return fail(c,'Approver role is not active.');
  if(Number(b.amountFrom||0)<0)return fail(c,'Amount from cannot be negative.');
  if(b.amountTo!==''&&b.amountTo!=null&&Number(b.amountTo)<Number(b.amountFrom||0))return fail(c,'Amount to must be greater than or equal to amount from.');
  const matrixCode=b.matrixCode||`APR-${Date.now()}`;
  await run(c.env.DB,`INSERT INTO erp_approval_matrices(matrix_code,module_code,document_type,department,amount_from,amount_to,step_no,approver_role_code,approver_user_id,action_code,active,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(matrix_code) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    department=excluded.department,amount_from=excluded.amount_from,amount_to=excluded.amount_to,step_no=excluded.step_no,
    approver_role_code=excluded.approver_role_code,approver_user_id=excluded.approver_user_id,action_code=excluded.action_code,active=excluded.active`,[
    matrixCode,b.moduleCode,b.documentType||'*',b.department||'*',Number(b.amountFrom||0),b.amountTo===''||b.amountTo==null?null:Number(b.amountTo),Number(b.stepNo||1),b.approverRoleCode,b.approverUserId||null,b.actionCode||'APPROVE',b.active===false?0:1,user.email]);
  await audit(c,{action:'UPSERT_APPROVAL_MATRIX',module:'ADMIN',recordType:'APPROVAL_MATRIX',recordNo:matrixCode,after:b});
  return ok(c,{matrixCode});
});

enterpriseRoutes.post('/integrations/:id/runs',async c=>{
  const user=c.get('erpUser');
  if(user.role_code!=='ADMIN')return fail(c,'Administrator access is required.',403);
  try{
    const runRecord=await createIntegrationRun(c.env.DB,Number(c.req.param('id')),user.email);
    await audit(c,{action:'START_INTEGRATION_RUN',module:'ADMIN',recordType:'INTEGRATION_RUN',recordId:runRecord.id,recordNo:runRecord.run_no,after:runRecord});
    return ok(c,{run:runRecord},201);
  }catch(error){return fail(c,error.message,409);}
});
