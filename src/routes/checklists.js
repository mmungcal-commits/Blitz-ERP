import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nextCode, normalizeSerial, normalizeText } from '../lib/codes.js';

export const checklistRoutes = new Hono();

checklistRoutes.get('/', requirePermission('DELIVERIES','VIEW'), async c=>{const {page,size,offset}=pageParams(c);const serial=normalizeSerial(c.req.query('serial'));const rows=await all(c.env.DB,`SELECT * FROM erp_pre_release_checks ${serial?'WHERE serial_no=?':''} ORDER BY check_date DESC,id DESC LIMIT ? OFFSET ?`,serial?[serial,size,offset]:[size,offset]);return ok(c,{rows,page,size});});

checklistRoutes.post('/', requirePermission('DELIVERIES','CREATE'), async c=>{const b=await jsonBody(c);const serial=normalizeSerial(b.serialNo);if(!serial)return fail(c,'Motorcycle serial is required');const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[serial]);if(!asset)return fail(c,'Serial is not registered',404);const no=await nextCode(c.env.DB,'CHECKLIST','PRC',6);const result=b.result||((b.defects||[]).length?'FAILED':'PASSED');const r=await run(c.env.DB,`INSERT INTO erp_pre_release_checks(checklist_no,assignment_id,serial_no,check_date,checklist_json,result,defects,checked_by,approved_by) VALUES(?,?,?,?,?,?,?,?,?)`,[no,b.assignmentId||null,serial,b.checkDate||new Date().toISOString(),JSON.stringify(b.checklist||{}),result,Array.isArray(b.defects)?b.defects.join('; '):normalizeText(b.defects),c.get('erpUser').email,b.approvedBy||'']);await audit(c,{action:'PRE_RELEASE_CHECK',module:'DELIVERIES',recordType:'CHECKLIST',recordId:r.meta.last_row_id,recordNo:no,after:{serial,result}});return ok(c,{id:r.meta.last_row_id,checklistNo:no,result},201);});
