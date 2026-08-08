import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensurePartner, ensureItem, nextCode, normalizeText, normalizeSerial } from '../lib/codes.js';
import { getAsset, isAvailable } from '../lib/inventory.js';
import { decideCoreWorkflowApproval } from '../lib/specialist-engine.js';
import { saveAttachments, attachmentsFor } from '../lib/attachments.js';

export const salesRoutes = new Hono();

/* =====================================================================
 * Leases, and where the units actually are
 *
 * A lease contract is a sales order with a term on it. What makes it
 * different from a sale is that the units come back, and until they do
 * they are standing in somebody else's yard - which is the answer a
 * cycle count needs when it cannot find a serial on the shelf.
 *
 * erp_lease_contract_units says which units a contract covers.
 * erp_asset_deployments says where a unit physically is. They are
 * different questions and conflating them is how a unit ends up counted
 * as missing and leased at the same time.
 * ===================================================================== */

salesRoutes.get('/leases', requirePermission('SALES','VIEW'), async c => {
  const rows = await all(c.env.DB, `SELECT l.*, b.cb_code, b.batch_code, b.transaction_code,
      b.units_r280, b.units_r280s, b.units_d400, b.charging_kits, b.batteries,
      s.sales_order_no, p.name customer_name,
      (SELECT COUNT(*) FROM erp_asset_deployments d
        WHERE d.lease_contract_id=l.id AND d.returned_at IS NULL) units_out,
      (SELECT COUNT(*) FROM erp_attachments a
        WHERE a.record_type='SALES_ORDER' AND a.record_id=l.sales_order_id AND a.active=1) documents
    FROM erp_lease_contracts l
    LEFT JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id
    LEFT JOIN erp_sales_orders s ON s.id=l.sales_order_id
    LEFT JOIN erp_partners p ON p.id=l.customer_id
    ORDER BY (l.status='ACTIVE') DESC, l.end_of_term DESC, l.lease_no`);
  const totals = await first(c.env.DB, `SELECT COUNT(*) contracts,
      COALESCE(SUM(unit_count),0) units,
      COALESCE(SUM(CASE WHEN status='ACTIVE' THEN unit_count ELSE 0 END),0) units_on_live_contracts
    FROM erp_lease_contracts`);
  const deployed = await first(c.env.DB, `SELECT COUNT(*) n FROM erp_asset_deployments
    WHERE returned_at IS NULL`);
  return ok(c, { rows, totals: { ...totals, unitsDeployed: Number(deployed?.n || 0) } });
});

/*
 * Tag units out to a contract.
 *
 * Takes serials rather than ids, because the person doing this is reading a
 * frame number off a motorcycle or a count sheet, not an internal key. A serial
 * already out on another contract is refused by name: silently moving it would
 * lose the fact that the first customer still has it on their books.
 */
salesRoutes.post('/leases/:id/deploy', requirePermission('SALES','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const user = c.get('erpUser');
  const lease = await first(c.env.DB, `SELECT l.*, p.name customer_name, b.cb_code
    FROM erp_lease_contracts l
    LEFT JOIN erp_partners p ON p.id=l.customer_id
    LEFT JOIN erp_lease_contract_batches b ON b.lease_contract_id=l.id WHERE l.id=?`, [id]);
  if (!lease) return fail(c, 'Lease contract not found.', 404);
  const b = await jsonBody(c);
  const serials = [...new Set((Array.isArray(b.serials) ? b.serials : String(b.serials || '').split(/[\s,]+/))
    .map(v => normalizeSerial(v)).filter(Boolean))];
  if (!serials.length) return fail(c, 'Scan or type at least one serial number.');

  const deployed = [];
  const refused = [];
  for (const serial of serials) {
    const open = await first(c.env.DB, `SELECT d.*, l.lease_no FROM erp_asset_deployments d
      LEFT JOIN erp_lease_contracts l ON l.id=d.lease_contract_id
      WHERE d.serial_no=? AND d.returned_at IS NULL`, [serial]);
    if (open) {
      refused.push({ serial, reason: open.lease_contract_id === id
        ? 'already out on this contract'
        : `already out with ${open.customer_name || 'another customer'} on ${open.lease_no || 'another contract'}` });
      continue;
    }
    const asset = await first(c.env.DB, `SELECT id FROM erp_assets WHERE serial_no=?`, [serial]);
    await run(c.env.DB, `INSERT INTO erp_asset_deployments(serial_no,asset_id,lease_contract_id,
      sales_order_id,cb_code,customer_id,customer_name,deployed_by,count_sheet_id,note)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [
      serial, asset?.id || null, id, lease.sales_order_id || null, lease.cb_code || null,
      lease.customer_id || null, lease.customer_name || lease.client_name,
      user.email, b.countSheetId ? Number(b.countSheetId) : null, normalizeText(b.note) || null,
    ]);
    /*
     * The unit itself says where it is. A count reads this, so leaving it
     * behind is how a deployed unit still shows up as expected on the shelf.
     */
    if (asset) {
      await run(c.env.DB, `UPDATE erp_assets SET current_status='LEASED' WHERE id=?`, [asset.id]);
      await run(c.env.DB, `INSERT OR IGNORE INTO erp_lease_contract_units(lease_contract_id,asset_id,
        serial_no,daily_rate_vat_ex,start_date,end_date,status)
        VALUES(?,?,?,?,?,?,'DEPLOYED')`, [
        id, asset.id, serial, lease.daily_rate_vat_ex || 0,
        lease.effective_date || null, lease.end_of_term || null]);
    }
    deployed.push(serial);
  }
  await audit(c, { action: 'DEPLOY', module: 'SALES', recordType: 'LEASE_CONTRACT',
    recordId: id, recordNo: lease.lease_no, after: { deployed, refused } });
  return ok(c, { leaseNo: lease.lease_no, customer: lease.customer_name || lease.client_name,
    deployed, refused });
});

// A unit that came back. Closed, never deleted: where it has been is history.
salesRoutes.post('/leases/:id/return', requirePermission('SALES','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const user = c.get('erpUser');
  const b = await jsonBody(c);
  const serials = [...new Set((Array.isArray(b.serials) ? b.serials : String(b.serials || '').split(/[\s,]+/))
    .map(v => normalizeSerial(v)).filter(Boolean))];
  if (!serials.length) return fail(c, 'Scan or type at least one serial number.');
  const reason = normalizeText(b.reason);
  const returned = [];
  for (const serial of serials) {
    const open = await first(c.env.DB, `SELECT * FROM erp_asset_deployments
      WHERE serial_no=? AND lease_contract_id=? AND returned_at IS NULL`, [serial, id]);
    if (!open) continue;
    await run(c.env.DB, `UPDATE erp_asset_deployments SET returned_at=datetime('now'),
      returned_by=?, return_reason=? WHERE id=?`, [user.email, reason || null, open.id]);
    if (open.asset_id) {
      await run(c.env.DB, `UPDATE erp_assets SET current_status='AVAILABLE' WHERE id=?`, [open.asset_id]);
      await run(c.env.DB, `UPDATE erp_lease_contract_units SET status='RETURNED'
        WHERE lease_contract_id=? AND asset_id=?`, [id, open.asset_id]);
    }
    returned.push(serial);
  }
  await audit(c, { action: 'RETURN', module: 'SALES', recordType: 'LEASE_CONTRACT',
    recordId: id, recordNo: String(id), after: { returned, reason } });
  return ok(c, { returned });
});

/*
 * Where is this serial?
 *
 * The question a count asks when a unit is not where it was expected. Answering
 * it is the difference between a variance and a note.
 */
salesRoutes.get('/units/:serial/location', requirePermission('SALES','VIEW'), async c => {
  const serial = normalizeSerial(c.req.param('serial'));
  const out = await first(c.env.DB, `SELECT d.*, l.lease_no, l.end_of_term, s.sales_order_no
    FROM erp_asset_deployments d
    LEFT JOIN erp_lease_contracts l ON l.id=d.lease_contract_id
    LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id
    WHERE d.serial_no=? AND d.returned_at IS NULL`, [serial]);
  const history = await all(c.env.DB, `SELECT d.customer_name, d.deployed_at, d.returned_at,
      l.lease_no FROM erp_asset_deployments d
    LEFT JOIN erp_lease_contracts l ON l.id=d.lease_contract_id
    WHERE d.serial_no=? ORDER BY d.deployed_at DESC LIMIT 20`, [serial]);
  return ok(c, { serial, deployed: out || null, history });
});

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

// Add-new customer card on the sales order form.
salesRoutes.post('/customers', requirePermission('SALES','CREATE'), async c => {
  const b=await jsonBody(c);
  const name=normalizeText(b.name);
  if(!name)return fail(c,'Customer name is required');
  const existing=await first(c.env.DB,`SELECT * FROM erp_partners WHERE partner_type='CUSTOMER' AND lower(name)=lower(?) AND active=1`,[name]);
  if(existing)return ok(c,{customer:existing,reused:true});
  const customer=await ensurePartner(c.env.DB,{name,type:'CUSTOMER',address:normalizeText(b.address),
    email:normalizeText(b.email),phone:normalizeText(b.contactNumber),sourceSystem:'SALES_QUICK_ADD'});
  const extra=[['contact_person',normalizeText(b.contactPerson)],['tax_id',normalizeText(b.tin)],['payment_terms',normalizeText(b.paymentTerms)]];
  for(const [col,val] of extra){
    if(!val)continue;
    try{await run(c.env.DB,`UPDATE erp_partners SET ${col}=? WHERE id=?`,[val,customer.id]);}catch(e){/* column may not exist */}
  }
  await audit(c,{action:'CREATE',module:'SALES',recordType:'CUSTOMER',recordId:customer.id,recordNo:customer.partner_code,after:{name}});
  return ok(c,{customer},201);
});

salesRoutes.get('/reports/units-by-month', requirePermission('SALES','VIEW'), async c => {
  const from=(c.req.query('from')||'').trim();const to=(c.req.query('to')||'').trim();
  const args=[];let dateWhere='';
  if(from&&to){dateWhere=' AND date(so.order_date) BETWEEN date(?) AND date(?)';args.push(from,to);}
  const rows=await all(c.env.DB,`
    SELECT strftime('%Y-%m', so.order_date) ym,
      COALESCE(v.class_name,'Other') class_name,
      COUNT(*) units,
      ROUND(SUM(COALESCE(sl.qty,1)*COALESCE(sl.unit_price,0)),2) amount
    FROM erp_sales_lines sl
    JOIN erp_sales_orders so ON so.id=sl.sales_order_id
    LEFT JOIN (SELECT DISTINCT item_id,class_code,class_name FROM vw_erp_inventory_by_item_class) v ON v.item_id=sl.item_id
    WHERE so.order_date IS NOT NULL AND upper(so.transaction_type) LIKE 'SALE%'${dateWhere}
    GROUP BY ym, class_name
    ORDER BY ym DESC, class_name`, args);
  return ok(c,{rows,from,to});
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
  const requested=(Array.isArray(b.lines)?b.lines:[]).filter(x=>normalizeText(x.serialNo||x.description||x.itemName));
  // A sales order carries its item lines. Serials are not picked here - supply
  // chain allocates those on the outbound requisition - so a line is item,
  // quantity and price, and the header total is their sum.
  const no=normalizeText(b.salesOrderNo)||await nextCode(c.env.DB,'SALES_ORDER','SO',6); let gross=0;const prepared=[];
  for(const line of requested){let asset=null; if(line.serialNo){asset=await getAsset(c.env.DB,normalizeSerial(line.serialNo));if(!asset)return fail(c,`Serial ${line.serialNo} is not registered`);if(!isAvailable(asset))return fail(c,`Serial ${asset.serial_no} is not available (${asset.current_status}/${asset.reconciliation_status})`,409);}const item=asset?await first(c.env.DB,`SELECT * FROM erp_items WHERE id=?`,[asset.item_id]):await ensureItem(c.env.DB,{itemCode:line.itemCode,itemName:line.itemName||line.description,category:line.category,serialized:!!line.serialNo,sourceSystem:'SALES',sourceKey:`${no}|${line.serialNo||line.description}`});const qty=numberValue(line.qty,1);const price=numberValue(line.unitPrice);gross+=qty*price;prepared.push({asset,item,qty,price,description:line.description||asset?.item_name||item.item_name,lineRole:line.lineRole||asset?.category||item.category});}
  const r=await run(c.env.DB,`INSERT INTO erp_sales_orders(sales_order_no,transaction_type,customer_id,order_date,contract_start,contract_end,status,gross_amount,delivery_address,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,'DRAFT',?,?,?,?,?)`,[no,tx,customer.id,b.orderDate||new Date().toISOString().slice(0,10),b.contractStart||'',b.contractEnd||'',gross,normalizeText(b.deliveryAddress||customer.address),normalizeText(b.sourceSystem||'E88_FINSYS'),normalizeText(b.sourceKey),c.get('erpUser').email]);
  let ln=0;for(const line of prepared){ln+=1;await run(c.env.DB,`INSERT INTO erp_sales_lines(sales_order_id,line_no,item_id,item_code,description,qty,unit_price,asset_id,serial_no,line_role) VALUES(?,?,?,?,?,?,?,?,?,?)`,[r.meta.last_row_id,ln,line.item.id,line.item.item_code,line.description,line.qty,line.price,line.asset?.id||null,line.asset?.serial_no||'',line.lineRole]);}
  const soId=r.meta.last_row_id;
  // Commercial terms that have no dedicated column live alongside the order.
  const terms={ratePerDay:numberValue(b.ratePerDay),rateCurrency:normalizeText(b.rateCurrency)||'PHP',
    contractStart:normalizeText(b.contractStart),contractEnd:normalizeText(b.contractEnd)};
  try{await run(c.env.DB,`INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES(?,?,datetime('now'))`,['so_terms:'+no,JSON.stringify(terms)]);}catch(e){}
  const attach=await saveAttachments(c.env,c.env.DB,{moduleCode:'SALES',recordType:'SALES_ORDER',
    recordId:soId,recordNo:no,files:b.attachments,uploadedBy:c.get('erpUser').email});
  await audit(c,{action:'CREATE',module:'SALES',recordType:'SALES_ORDER',recordId:soId,recordNo:no,after:{...b,gross}});
  return ok(c,{id:soId,salesOrderNo:no,gross,ratePerDay:terms.ratePerDay,attachments:attach.saved,attachmentErrors:attach.failed},201);
});

salesRoutes.get('/:id', requirePermission('SALES','VIEW'), async c => {
  const id=Number(c.req.param('id'));const header=await first(c.env.DB,`SELECT s.*,p.name customer_name,p.credit_status,p.hold_reason FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id WHERE s.id=?`,[id]);if(!header)return fail(c,'Sales order not found',404);const lines=await all(c.env.DB,`SELECT l.*,a.current_status,a.current_location_code,a.reconciliation_status FROM erp_sales_lines l LEFT JOIN erp_assets a ON a.id=l.asset_id WHERE l.sales_order_id=? ORDER BY l.line_no`,[id]);const assignments=await all(c.env.DB,`SELECT * FROM erp_assignments WHERE source_request_no=?`,[header.sales_order_no]);const deliveries=await all(c.env.DB,`SELECT * FROM erp_deliveries WHERE sales_order_id=? ORDER BY created_at DESC`,[id]);
  const attachments=await attachmentsFor(c.env.DB,'SALES_ORDER',id,header.sales_order_no);
  let terms={};try{const t=await first(c.env.DB,`SELECT value FROM erp_settings WHERE key=?`,['so_terms:'+header.sales_order_no]);terms=t&&t.value?JSON.parse(t.value):{};}catch(e){terms={};}
  return ok(c,{header:{...header,rate_per_day:terms.ratePerDay||0,rate_currency:terms.rateCurrency||'PHP'},lines,assignments,deliveries,attachments,terms});
});

// Draft sales orders stay editable until they are approved. Finance can override.
salesRoutes.patch('/:id', requirePermission('SALES','EDIT'), async c => {
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const header=await first(c.env.DB,`SELECT * FROM erp_sales_orders WHERE id=?`,[id]);
  if(!header)return fail(c,'Sales order not found',404);
  const role=String(c.get('erpUser').role_code||'').toUpperCase();
  if(header.status!=='DRAFT'&&role!=='FINANCE')return fail(c,'Only a draft order can be edited. Finance can override.',409);
  const tx=normalizeText(b.transactionType).toUpperCase();
  if(tx&&!['SALE','LEASE','DEMO','PILOT','EMPLOYEE_ASSIGNMENT'].includes(tx))return fail(c,'Invalid transaction type');
  await run(c.env.DB,`UPDATE erp_sales_orders SET
      transaction_type=COALESCE(NULLIF(?,''),transaction_type),
      order_date=COALESCE(NULLIF(?,''),order_date),
      contract_start=COALESCE(NULLIF(?,''),contract_start),
      contract_end=COALESCE(NULLIF(?,''),contract_end),
      delivery_address=COALESCE(NULLIF(?,''),delivery_address)
    WHERE id=?`,[tx,normalizeText(b.orderDate),normalizeText(b.contractStart),
      normalizeText(b.contractEnd),normalizeText(b.deliveryAddress),id]);
  if(b.ratePerDay!==undefined){
    let terms={};try{const t=await first(c.env.DB,`SELECT value FROM erp_settings WHERE key=?`,['so_terms:'+header.sales_order_no]);terms=t&&t.value?JSON.parse(t.value):{};}catch(e){terms={};}
    terms.ratePerDay=numberValue(b.ratePerDay);
    try{await run(c.env.DB,`INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES(?,?,datetime('now'))`,['so_terms:'+header.sales_order_no,JSON.stringify(terms)]);}catch(e){}
  }
  if(Array.isArray(b.attachments)&&b.attachments.length){
    await saveAttachments(c.env,c.env.DB,{moduleCode:'SALES',recordType:'SALES_ORDER',
      recordId:id,recordNo:header.sales_order_no,files:b.attachments,uploadedBy:c.get('erpUser').email});
  }
  const after=await first(c.env.DB,`SELECT * FROM erp_sales_orders WHERE id=?`,[id]);
  await audit(c,{action:'EDIT',module:'SALES',recordType:'SALES_ORDER',recordId:id,recordNo:header.sales_order_no,before:header,after});
  return ok(c,{salesOrder:after});
});

// Void a draft order.
salesRoutes.post('/:id/void', requirePermission('SALES','EDIT'), async c => {
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`SELECT * FROM erp_sales_orders WHERE id=?`,[id]);
  if(!header)return fail(c,'Sales order not found',404);
  const role=String(c.get('erpUser').role_code||'').toUpperCase();
  if(header.status!=='DRAFT'&&role!=='FINANCE')return fail(c,'Only a draft order can be voided. Finance can override.',409);
  await run(c.env.DB,`UPDATE erp_sales_orders SET status='CANCELLED' WHERE id=?`,[id]);
  await audit(c,{action:'VOID',module:'SALES',recordType:'SALES_ORDER',recordId:id,recordNo:header.sales_order_no,before:header});
  return ok(c,{voided:true});
});

salesRoutes.post('/:id/approve', requirePermission('SALES','APPROVE'), async c => {
  const id=Number(c.req.param('id'));const before=await first(c.env.DB,`SELECT s.*,p.name customer_name,p.credit_status,p.hold_reason FROM erp_sales_orders s JOIN erp_partners p ON p.id=s.customer_id WHERE s.id=?`,[id]);if(!before)return fail(c,'Sales order not found',404);if(before.status!=='DRAFT')return fail(c,'Only draft orders can be approved',409);if(before.credit_status==='BLOCKED')return fail(c,`Customer is blocked: ${before.hold_reason||'overdue account'}`,409);
  const body=await jsonBody(c);let approvalDecision;
  try{approvalDecision=await decideCoreWorkflowApproval(c.env.DB,'sd-order-management',{
    sourceType:'SALES_ORDER',sourceId:id,sourceNo:before.sales_order_no,recordType:before.transaction_type,
    department:'Sales & Distribution',amount:before.gross_amount,createdBy:before.created_by,
  },c.get('erpUser'),body.decision||'APPROVE',body.notes||'');}catch(error){return fail(c,error.message,409);}
  if(approvalDecision.rejected)return fail(c,'The sales order approval was rejected.',409);
  if(!approvalDecision.completed){
    await audit(c,{action:'APPROVAL_STEP',module:'SALES',recordType:'SALES_ORDER',recordId:id,recordNo:before.sales_order_no,before,after:{approvalDecision}});
    return ok(c,{approved:false,pendingApproval:true,approvalDecision});
  }
  const lines=await all(c.env.DB,`SELECT l.*,a.current_status,a.reconciliation_status FROM erp_sales_lines l LEFT JOIN erp_assets a ON a.id=l.asset_id WHERE l.sales_order_id=?`,[id]);for(const line of lines.filter(x=>x.serial_no)){if(!['AVAILABLE','IN_STOCK'].includes(line.current_status)||line.reconciliation_status!=='CLEAR')return fail(c,`Serial ${line.serial_no} is no longer available`,409);}
  let assignmentId=null,assignmentNo='';if(before.transaction_type!=='SALE'){assignmentNo=await nextCode(c.env.DB,'ASSIGNMENT','ASG',6);const ar=await run(c.env.DB,`INSERT INTO erp_assignments(assignment_no,assignment_type,partner_id,holder_name,start_date,expected_return_date,status,purpose,source_request_no,created_by,approved_by,approved_at) VALUES(?,?,?,?,?,?,'APPROVED',?,?,?,?,datetime('now'))`,[assignmentNo,before.transaction_type,before.customer_id,before.customer_name,before.contract_start||before.order_date,before.contract_end||'',before.transaction_type,before.sales_order_no,c.get('erpUser').email,c.get('erpUser').email]);assignmentId=ar.meta.last_row_id;for(const line of lines.filter(x=>x.serial_no))await run(c.env.DB,`INSERT INTO erp_assignment_assets(assignment_id,asset_id,serial_no,role_code) VALUES(?,?,?,?)`,[assignmentId,line.asset_id,line.serial_no,line.line_role]);}
  for(const line of lines.filter(x=>x.serial_no))await run(c.env.DB,`UPDATE erp_assets SET current_status=?,current_holder_type='CUSTOMER',current_holder_id=?,current_holder_name=?,updated_at=datetime('now') WHERE id=? AND current_status IN ('AVAILABLE','IN_STOCK') AND reconciliation_status='CLEAR'`,[before.transaction_type==='SALE'?'RESERVED_FOR_SALE':'RESERVED_FOR_ASSIGNMENT',before.customer_id,before.customer_name,line.asset_id]);
  const deliveryNo=await nextCode(c.env.DB,'DELIVERY','DLV',6);const dr=await run(c.env.DB,`INSERT INTO erp_deliveries(delivery_no,assignment_id,sales_order_id,requested_date,scheduled_date,destination,recipient_name,status,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,?,'PLANNED','SALES',?,?)`,[deliveryNo,assignmentId,id,before.order_date,before.order_date,before.delivery_address,before.customer_name,before.sales_order_no,c.get('erpUser').email]);for(const line of lines)await run(c.env.DB,`INSERT OR IGNORE INTO erp_delivery_assets(delivery_id,asset_id,serial_no,item_code,qty) VALUES(?,?,?,?,?)`,[dr.meta.last_row_id,line.asset_id,line.serial_no,line.item_code,line.qty]);
  await run(c.env.DB,`UPDATE erp_sales_orders SET status='APPROVED' WHERE id=?`,[id]);await audit(c,{action:'APPROVE',module:'SALES',recordType:'SALES_ORDER',recordId:id,recordNo:before.sales_order_no,before,after:{status:'APPROVED',assignmentNo,deliveryNo}});return ok(c,{approved:true,approvalDecision,assignmentId,assignmentNo,deliveryId:dr.meta.last_row_id,deliveryNo});
});
