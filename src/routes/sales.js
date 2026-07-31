import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensurePartner, ensureItem, nextCode, normalizeText, normalizeSerial } from '../lib/codes.js';
import { getAsset, isAvailable } from '../lib/inventory.js';

export const salesRoutes = new Hono();

salesRoutes.get('/lookups', requirePermission('SALES','VIEW'), async c => {
  const [customers,employees,items,assets]=await Promise.all([
    all(c.env.DB,`SELECT id,partner_code,name,credit_status,overdue_balance
      FROM erp_partners WHERE partner_type='CUSTOMER' AND active=1 ORDER BY name`),
    all(c.env.DB,`SELECT id,partner_code,name,'CLEAR' credit_status,0 overdue_balance
      FROM erp_partners WHERE partner_type='EMPLOYEE' AND active=1 ORDER BY name`),
    all(c.env.DB,`SELECT id,item_code,item_name,category,serialized,standard_cost
      FROM erp_items WHERE active=1 ORDER BY category,item_name`),
    all(c.env.DB,`SELECT a.id,a.serial_no,a.item_id,a.item_code,a.item_name,a.category,
        a.current_location_code,a.current_status,a.unit_cost
      FROM erp_assets a
      WHERE a.active=1 AND a.current_status IN ('AVAILABLE','IN_STOCK')
        AND a.reconciliation_status='CLEAR'
        AND NOT EXISTS(
          SELECT 1 FROM erp_sales_lines l JOIN erp_sales_orders s ON s.id=l.sales_order_id
          WHERE l.asset_id=a.id AND s.status IN ('DRAFT','APPROVED','FULFILMENT')
        )
        AND NOT EXISTS(
          SELECT 1 FROM erp_requisition_allocations ra JOIN erp_requisitions r ON r.id=ra.requisition_id
          WHERE ra.asset_id=a.id AND ra.allocation_status IN ('SELECTED','RESERVED','ISSUED')
            AND r.status NOT IN ('CANCELLED','FULFILLED')
        )
      ORDER BY a.category,a.item_name,a.serial_no`),
  ]);
  return ok(c,{customers,employees,items,assets});
});

salesRoutes.get('/', requirePermission('SALES','VIEW'), async c => {
  const {page,size,offset}=pageParams(c); const q=`%${normalizeText(c.req.query('q'))}%`; const status=normalizeText(c.req.query('status')); const type=normalizeText(c.req.query('type'));
  const where=[];const args=[];if(q!=='%%'){where.push('(s.sales_order_no LIKE ? OR p.name LIKE ?)');args.push(q,q);}if(status){where.push('s.status=?');args.push(status);}if(type){where.push('s.transaction_type=?');args.push(type);}const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=await all(c.env.DB,`SELECT s.*,p.partner_code customer_code,p.name customer_name,p.credit_status,(SELECT COUNT(*) FROM erp_sales_lines l WHERE l.sales_order_id=s.id) line_count FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id ${w} ORDER BY COALESCE(s.order_date,s.created_at) DESC LIMIT ? OFFSET ?`,[...args,size,offset]);const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id ${w}`,args);return ok(c,{rows,page,size,total:total?.n||0});
});

salesRoutes.post('/', requirePermission('SALES','CREATE'), async c => {
  const b=await jsonBody(c); const tx=normalizeText(b.transactionType).toUpperCase(); if(!['SALE','LEASE','DEMO','PILOT','EMPLOYEE_ASSIGNMENT'].includes(tx))return fail(c,'Invalid transaction type'); if(!b.customerName&&!b.customerId)return fail(c,'Customer or holder is required');
  let customer=b.customerId?await first(c.env.DB,`SELECT * FROM erp_partners WHERE id=?`,[Number(b.customerId)]):null; if(!customer)customer=await ensurePartner(c.env.DB,{name:b.customerName,type:tx==='EMPLOYEE_ASSIGNMENT'?'EMPLOYEE':'CUSTOMER',address:b.deliveryAddress||'',email:b.customerEmail||'',phone:b.customerPhone||'',sourceSystem:b.sourceSystem||'E88_FINSYS'});
  if(customer.credit_status==='BLOCKED'&&!b.overrideCreditHold)return fail(c,`Customer ${customer.name} is blocked: ${customer.hold_reason||'overdue account'}`,409);
  const requested=(Array.isArray(b.lines)?b.lines:[]).filter(x=>normalizeText(x.serialNo||x.description||x.itemName));if(!requested.length)return fail(c,'At least one item or serial is required');
  const no=normalizeText(b.salesOrderNo)||await nextCode(c.env.DB,'SALES_ORDER','SO',6); let gross=0;const prepared=[];
  for(const line of requested){let asset=null; if(line.serialNo){asset=await getAsset(c.env.DB,normalizeSerial(line.serialNo));if(!asset)return fail(c,`Serial ${line.serialNo} is not registered`);if(!isAvailable(asset))return fail(c,`Serial ${asset.serial_no} is not available (${asset.current_status}/${asset.reconciliation_status})`,409);}const item=asset?await first(c.env.DB,`SELECT * FROM erp_items WHERE id=?`,[asset.item_id]):await ensureItem(c.env.DB,{itemCode:line.itemCode,itemName:line.itemName||line.description,category:line.category,serialized:!!line.serialNo,sourceSystem:'SALES',sourceKey:`${no}|${line.serialNo||line.description}`});const qty=numberValue(line.qty,1);const price=numberValue(line.unitPrice);gross+=qty*price;prepared.push({asset,item,qty,price,description:line.description||asset?.item_name||item.item_name,lineRole:line.lineRole||asset?.category||item.category});}
  const r=await run(c.env.DB,`INSERT INTO erp_sales_orders(sales_order_no,transaction_type,customer_id,order_date,contract_start,contract_end,status,gross_amount,delivery_address,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,'DRAFT',?,?,?,?,?)`,[no,tx,customer.id,b.orderDate||new Date().toISOString().slice(0,10),b.contractStart||'',b.contractEnd||'',gross,normalizeText(b.deliveryAddress||customer.address),normalizeText(b.sourceSystem||'E88_FINSYS'),normalizeText(b.sourceKey),c.get('erpUser').email]);
  let ln=0;for(const line of prepared){ln+=1;await run(c.env.DB,`INSERT INTO erp_sales_lines(sales_order_id,line_no,item_id,item_code,description,qty,unit_price,asset_id,serial_no,line_role) VALUES(?,?,?,?,?,?,?,?,?,?)`,[r.meta.last_row_id,ln,line.item.id,line.item.item_code,line.description,line.qty,line.price,line.asset?.id||null,line.asset?.serial_no||'',line.lineRole]);}
  await audit(c,{action:'CREATE',module:'SALES',recordType:'SALES_ORDER',recordId:r.meta.last_row_id,recordNo:no,after:{...b,gross}});return ok(c,{id:r.meta.last_row_id,salesOrderNo:no,gross},201);
});

salesRoutes.get('/:id', requirePermission('SALES','VIEW'), async c => {
  const id=Number(c.req.param('id'));const header=await first(c.env.DB,`SELECT s.*,p.name customer_name,p.credit_status,p.hold_reason FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id WHERE s.id=?`,[id]);if(!header)return fail(c,'Sales order not found',404);const lines=await all(c.env.DB,`SELECT l.*,a.current_status,a.current_location_code,a.reconciliation_status FROM erp_sales_lines l LEFT JOIN erp_assets a ON a.id=l.asset_id WHERE l.sales_order_id=? ORDER BY l.line_no`,[id]);const assignments=await all(c.env.DB,`SELECT * FROM erp_assignments WHERE source_request_no=?`,[header.sales_order_no]);const deliveries=await all(c.env.DB,`SELECT * FROM erp_deliveries WHERE sales_order_id=? ORDER BY created_at DESC`,[id]);return ok(c,{header,lines,assignments,deliveries});
});

salesRoutes.post('/:id/approve', requirePermission('SALES','APPROVE'), async c => {
  const id=Number(c.req.param('id'));const before=await first(c.env.DB,`SELECT s.*,p.name customer_name,p.credit_status,p.hold_reason FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id WHERE s.id=?`,[id]);if(!before)return fail(c,'Sales order not found',404);if(before.status!=='DRAFT')return fail(c,'Only draft orders can be approved',409);if(before.credit_status==='BLOCKED')return fail(c,`Customer is blocked: ${before.hold_reason||'overdue account'}`,409);
  const lines=await all(c.env.DB,`SELECT l.*,a.current_status,a.reconciliation_status FROM erp_sales_lines l LEFT JOIN erp_assets a ON a.id=l.asset_id WHERE l.sales_order_id=?`,[id]);for(const line of lines.filter(x=>x.serial_no)){if(!['AVAILABLE','IN_STOCK'].includes(line.current_status)||line.reconciliation_status!=='CLEAR')return fail(c,`Serial ${line.serial_no} is no longer available`,409);}
  let assignmentId=null,assignmentNo='';if(before.transaction_type!=='SALE'){assignmentNo=await nextCode(c.env.DB,'ASSIGNMENT','ASG',6);const ar=await run(c.env.DB,`INSERT INTO erp_assignments(assignment_no,assignment_type,partner_id,holder_name,start_date,expected_return_date,status,purpose,source_request_no,created_by,approved_by,approved_at) VALUES(?,?,?,?,?,?,'APPROVED',?,?,?,?,datetime('now'))`,[assignmentNo,before.transaction_type,before.customer_id,before.customer_name,before.contract_start||before.order_date,before.contract_end||'',before.transaction_type,before.sales_order_no,c.get('erpUser').email,c.get('erpUser').email]);assignmentId=ar.meta.last_row_id;for(const line of lines.filter(x=>x.serial_no))await run(c.env.DB,`INSERT INTO erp_assignment_assets(assignment_id,asset_id,serial_no,role_code) VALUES(?,?,?,?)`,[assignmentId,line.asset_id,line.serial_no,line.line_role]);}
  for(const line of lines.filter(x=>x.serial_no))await run(c.env.DB,`UPDATE erp_assets SET current_status=?,current_holder_type='CUSTOMER',current_holder_id=?,current_holder_name=?,updated_at=datetime('now') WHERE id=? AND current_status IN ('AVAILABLE','IN_STOCK') AND reconciliation_status='CLEAR'`,[before.transaction_type==='SALE'?'RESERVED_FOR_SALE':'RESERVED_FOR_ASSIGNMENT',before.customer_id,before.customer_name,line.asset_id]);
  const deliveryNo=await nextCode(c.env.DB,'DELIVERY','DLV',6);const dr=await run(c.env.DB,`INSERT INTO erp_deliveries(delivery_no,assignment_id,sales_order_id,requested_date,scheduled_date,destination,recipient_name,status,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,?,'PLANNED','SALES',?,?)`,[deliveryNo,assignmentId,id,before.order_date,before.order_date,before.delivery_address,before.customer_name,before.sales_order_no,c.get('erpUser').email]);for(const line of lines)await run(c.env.DB,`INSERT OR IGNORE INTO erp_delivery_assets(delivery_id,asset_id,serial_no,item_code,qty) VALUES(?,?,?,?,?)`,[dr.meta.last_row_id,line.asset_id,line.serial_no,line.item_code,line.qty]);
  await run(c.env.DB,`UPDATE erp_sales_orders SET status='APPROVED' WHERE id=?`,[id]);await audit(c,{action:'APPROVE',module:'SALES',recordType:'SALES_ORDER',recordId:id,recordNo:before.sales_order_no,before,after:{status:'APPROVED',assignmentNo,deliveryNo}});return ok(c,{approved:true,assignmentId,assignmentNo,deliveryId:dr.meta.last_row_id,deliveryNo});
});
