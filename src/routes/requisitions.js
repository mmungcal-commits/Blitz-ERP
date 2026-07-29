import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensurePartner, ensureItem, nextCode, normalizeText } from '../lib/codes.js';

export const requisitionRoutes = new Hono();

requisitionRoutes.get('/', requirePermission('REQUISITIONS','VIEW'), async c => {
  const {page,size,offset}=pageParams(c); const q=`%${normalizeText(c.req.query('q'))}%`; const status=normalizeText(c.req.query('status'));
  const where=[]; const args=[]; if(q!=='%%'){where.push('(r.requisition_no LIKE ? OR r.requestor_name LIKE ? OR r.purpose LIKE ? OR r.destination LIKE ?)');args.push(q,q,q,q);} if(status){where.push('r.status=?');args.push(status);} const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=await all(c.env.DB,`SELECT r.*,p.name partner_name,(SELECT COUNT(*) FROM erp_requisition_lines l WHERE l.requisition_id=r.id) line_count FROM erp_requisitions r LEFT JOIN erp_partners p ON p.id=r.partner_id ${w} ORDER BY COALESCE(r.required_date,r.request_date,r.created_at) DESC LIMIT ? OFFSET ?`,[...args,size,offset]); const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_requisitions r ${w}`,args); return ok(c,{rows,page,size,total:total?.n||0});
});

requisitionRoutes.post('/', requirePermission('REQUISITIONS','CREATE'), async c => {
  const b=await jsonBody(c); const lines=(Array.isArray(b.lines)?b.lines:[]).filter(x=>numberValue(x.qty)>0&&normalizeText(x.description||x.itemName||x.itemCode)); if(!lines.length)return fail(c,'At least one requisition line is required');
  const no=normalizeText(b.requisitionNo)||await nextCode(c.env.DB,'REQUISITION','REQ',6); let partner=null; if(b.companyName)partner=await ensurePartner(c.env.DB,{name:b.companyName,type:b.partnerType||'CUSTOMER',address:b.destination||'',sourceSystem:b.sourceSystem||'E88_FINSYS'});
  const r=await run(c.env.DB,`INSERT INTO erp_requisitions(requisition_no,request_date,requestor_email,requestor_name,department,purpose,fulfillment_method,partner_id,destination,required_date,status,remarks,source_system,source_key) VALUES(?,?,?,?,?,?,?,?,?,?,'SUBMITTED',?,?,?)`,[no,b.requestDate||new Date().toISOString(),b.requestorEmail||c.get('erpUser').email,b.requestorName||c.get('erpUser').display_name,b.department||c.get('erpUser').department||'',normalizeText(b.purpose),normalizeText(b.fulfillmentMethod),partner?.id||null,normalizeText(b.destination),b.requiredDate||'',normalizeText(b.remarks),normalizeText(b.sourceSystem||'E88_FINSYS'),normalizeText(b.sourceKey)]);
  for(const line of lines){const item=await ensureItem(c.env.DB,{itemCode:line.itemCode,itemName:line.itemName||line.description,category:line.category,serialized:!!line.serialRequired,sourceSystem:'REQUISITION',sourceKey:`${no}|${line.itemCode||line.description}`});await run(c.env.DB,`INSERT INTO erp_requisition_lines(requisition_id,item_id,item_code,description,qty,serial_required) VALUES(?,?,?,?,?,?)`,[r.meta.last_row_id,item.id,item.item_code,line.description||item.item_name,numberValue(line.qty),line.serialRequired?1:0]);}
  await audit(c,{action:'CREATE',module:'REQUISITIONS',recordType:'REQUISITION',recordId:r.meta.last_row_id,recordNo:no,after:b}); return ok(c,{id:r.meta.last_row_id,requisitionNo:no},201);
});

requisitionRoutes.get('/:id', requirePermission('REQUISITIONS','VIEW'), async c => {
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT r.*,p.name partner_name FROM erp_requisitions r LEFT JOIN erp_partners p ON p.id=r.partner_id WHERE r.id=?`,[id]); if(!header)return fail(c,'Requisition not found',404); const lines=await all(c.env.DB,`SELECT l.*,i.category,i.serialized FROM erp_requisition_lines l LEFT JOIN erp_items i ON i.id=l.item_id WHERE l.requisition_id=? ORDER BY l.id`,[id]); const deliveries=await all(c.env.DB,`SELECT * FROM erp_deliveries WHERE requisition_id=? ORDER BY created_at DESC`,[id]); return ok(c,{header,lines,deliveries});
});

requisitionRoutes.post('/:id/approve', requirePermission('REQUISITIONS','APPROVE'), async c => {
  const id=Number(c.req.param('id')); const before=await first(c.env.DB,`SELECT * FROM erp_requisitions WHERE id=?`,[id]); if(!before)return fail(c,'Requisition not found',404); if(!['SUBMITTED','DRAFT'].includes(before.status))return fail(c,'Requisition cannot be approved in its current status',409); await run(c.env.DB,`UPDATE erp_requisitions SET status='APPROVED' WHERE id=?`,[id]); const after=await first(c.env.DB,`SELECT * FROM erp_requisitions WHERE id=?`,[id]); await audit(c,{action:'APPROVE',module:'REQUISITIONS',recordType:'REQUISITION',recordId:id,recordNo:after.requisition_no,before,after}); return ok(c,{requisition:after});
});

requisitionRoutes.post('/:id/cancel', requirePermission('REQUISITIONS','EDIT'), async c => {
  const id=Number(c.req.param('id')); const b=await jsonBody(c); const before=await first(c.env.DB,`SELECT * FROM erp_requisitions WHERE id=?`,[id]); if(!before)return fail(c,'Requisition not found',404); if(['FULFILLED','CANCELLED'].includes(before.status))return fail(c,'Requisition cannot be cancelled',409); await run(c.env.DB,`UPDATE erp_requisitions SET status='CANCELLED',remarks=trim(COALESCE(remarks,'')||' '||?) WHERE id=?`,[normalizeText(b.reason),id]); await audit(c,{action:'CANCEL',module:'REQUISITIONS',recordType:'REQUISITION',recordId:id,recordNo:before.requisition_no,before,after:{...before,status:'CANCELLED'}}); return ok(c,{cancelled:true});
});
