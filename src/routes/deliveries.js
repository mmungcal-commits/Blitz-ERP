import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { postMovement } from '../lib/inventory.js';
import { nextCode, normalizeText } from '../lib/codes.js';
import { captureFinanceEvent } from '../lib/finance.js';

export const deliveryRoutes = new Hono();

deliveryRoutes.get('/', requirePermission('DELIVERIES','VIEW'), async c => {
  const {page,size,offset}=pageParams(c);const q=`%${normalizeText(c.req.query('q'))}%`;const status=normalizeText(c.req.query('status'));const where=[];const args=[];if(q!=='%%'){where.push('(d.delivery_no LIKE ? OR d.destination LIKE ? OR d.recipient_name LIKE ?)');args.push(q,q,q);}if(status){where.push('d.status=?');args.push(status);}const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=await all(c.env.DB,`SELECT d.*,s.sales_order_no,r.requisition_no,a.assignment_no,(SELECT COUNT(*) FROM erp_delivery_assets da WHERE da.delivery_id=d.id) asset_count FROM erp_deliveries d LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id LEFT JOIN erp_requisitions r ON r.id=d.requisition_id LEFT JOIN erp_assignments a ON a.id=d.assignment_id ${w} ORDER BY COALESCE(d.scheduled_date,d.requested_date,d.created_at) DESC LIMIT ? OFFSET ?`,[...args,size,offset]);const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_deliveries d ${w}`,args);return ok(c,{rows,page,size,total:total?.n||0});
});

deliveryRoutes.post('/', requirePermission('DELIVERIES','CREATE'), async c => {
  const b=await jsonBody(c);const no=normalizeText(b.deliveryNo)||await nextCode(c.env.DB,'DELIVERY','DLV',6);const r=await run(c.env.DB,`INSERT INTO erp_deliveries(delivery_no,assignment_id,sales_order_id,requisition_id,requested_date,scheduled_date,origin_location_id,destination,recipient_name,recipient_phone,status,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,'PLANNED',?,?,?)`,[no,b.assignmentId||null,b.salesOrderId||null,b.requisitionId||null,b.requestedDate||new Date().toISOString().slice(0,10),b.scheduledDate||'',b.originLocationId||null,normalizeText(b.destination),normalizeText(b.recipientName),normalizeText(b.recipientPhone),normalizeText(b.sourceSystem||'E88_FINSYS'),normalizeText(b.sourceKey),c.get('erpUser').email]);for(const asset of (b.assets||[])){await run(c.env.DB,`INSERT OR IGNORE INTO erp_delivery_assets(delivery_id,asset_id,serial_no,item_code,qty) SELECT ?,id,serial_no,item_code,1 FROM erp_assets WHERE serial_no=?`,[r.meta.last_row_id,normalizeText(asset.serialNo||asset)]);}await audit(c,{action:'CREATE',module:'DELIVERIES',recordType:'DELIVERY',recordId:r.meta.last_row_id,recordNo:no,after:b});return ok(c,{id:r.meta.last_row_id,deliveryNo:no},201);
});

deliveryRoutes.get('/:id', requirePermission('DELIVERIES','VIEW'), async c => {
  const id=Number(c.req.param('id'));const header=await first(c.env.DB,`SELECT d.*,s.sales_order_no,s.transaction_type,r.requisition_no,a.assignment_no,l.code origin_location_code,l.name origin_location_name FROM erp_deliveries d LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id LEFT JOIN erp_requisitions r ON r.id=d.requisition_id LEFT JOIN erp_assignments a ON a.id=d.assignment_id LEFT JOIN erp_locations l ON l.id=d.origin_location_id WHERE d.id=?`,[id]);if(!header)return fail(c,'Delivery not found',404);const assets=await all(c.env.DB,`SELECT da.*,a.category,a.item_name,a.current_status,a.current_location_code,a.reconciliation_status FROM erp_delivery_assets da LEFT JOIN erp_assets a ON a.id=da.asset_id WHERE da.delivery_id=? ORDER BY da.id`,[id]);const checks=await all(c.env.DB,`SELECT * FROM erp_pre_release_checks WHERE serial_no IN (SELECT serial_no FROM erp_delivery_assets WHERE delivery_id=?) ORDER BY check_date DESC`,[id]);return ok(c,{header,assets,checks});
});

deliveryRoutes.post('/:id/release', requirePermission('DELIVERIES','POST'), async c => {
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const header=await first(c.env.DB,`SELECT d.*,s.transaction_type,s.customer_id,s.sales_order_no,s.gross_amount,p.name customer_name,
    a.assignment_type,a.partner_id assignment_partner_id,a.holder_name assignment_holder_name,
    rc.holder_type requisition_holder_type,rc.holder_name requisition_holder_name
    FROM erp_deliveries d
    LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id
    LEFT JOIN erp_partners p ON p.id=s.customer_id
    LEFT JOIN erp_assignments a ON a.id=d.assignment_id
    LEFT JOIN erp_requisition_context rc ON rc.requisition_id=d.requisition_id
    WHERE d.id=?`,[id]);
  if(!header)return fail(c,'Delivery not found',404);
  if(!['PLANNED','READY'].includes(header.status))return fail(c,'Delivery is not ready for release',409);
  const assets=await all(c.env.DB,`SELECT da.*,a.* FROM erp_delivery_assets da JOIN erp_assets a ON a.id=da.asset_id WHERE da.delivery_id=?`,[id]);
  const quantityLines=await all(c.env.DB,`SELECT * FROM erp_delivery_assets WHERE delivery_id=? AND asset_id IS NULL`,[id]);
  if(!assets.length&&!quantityLines.length)return fail(c,'No assets or consumable quantities are attached to this delivery');
  const holderType=header.requisition_holder_type||header.assignment_type||'CUSTOMER';
  const holderId=header.assignment_partner_id||header.customer_id||null;
  const holderName=header.requisition_holder_name||header.assignment_holder_name||header.customer_name||header.recipient_name;
  for(const asset of assets){
    if(asset.reconciliation_status!=='CLEAR')return fail(c,`Serial ${asset.serial_no} has an unresolved reconciliation case`,409);
    const check=await first(c.env.DB,`SELECT * FROM erp_pre_release_checks WHERE serial_no=? ORDER BY id DESC LIMIT 1`,[asset.serial_no]);
    if(asset.category==='MC'&&(!check||check.result!=='PASSED'))return fail(c,`Serial ${asset.serial_no} requires a passed pre-release checklist`,409);
    try{
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no,movementType:'GOODS_ISSUANCE',movementDate:b.releaseDate||new Date().toISOString(),
        toLocationId:null,toLocationCode:normalizeText(header.destination),toStatus:'OUT_FOR_DELIVERY',
        holderType,holderId,holderName,sourceDocType:'DELIVERY',sourceDocId:id,sourceDocNo:header.delivery_no,
        reasonCode:header.transaction_type||header.assignment_type||'REQUISITION',notes:normalizeText(b.notes),
      },c.get('erpUser').email);
    }catch(e){return fail(c,e.message,409);}
  }
  await run(c.env.DB,`UPDATE erp_deliveries SET status='RELEASED',actual_release_date=? WHERE id=?`,[b.releaseDate||new Date().toISOString(),id]);
  if(header.requisition_id){
    await run(c.env.DB,`UPDATE erp_requisitions SET status='ISSUED' WHERE id=?`,[header.requisition_id]);
    await run(c.env.DB,`UPDATE erp_requisition_allocations SET allocation_status='ISSUED' WHERE requisition_id=?`,[header.requisition_id]);
  }
  await audit(c,{action:'RELEASE',module:'DELIVERIES',recordType:'DELIVERY',recordId:id,recordNo:header.delivery_no,
    after:{holderType,holderName,assets:assets.map(x=>x.serial_no),quantityLines}});
  return ok(c,{released:assets.length,quantityLines:quantityLines.length,holderType,holderName});
});

deliveryRoutes.post('/:id/complete', requirePermission('DELIVERIES','POST'), async c => {
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const header=await first(c.env.DB,`SELECT d.*,s.transaction_type,s.customer_id,p.name customer_name,
    a.assignment_type,a.partner_id assignment_partner_id,a.holder_name assignment_holder_name,
    rc.holder_type requisition_holder_type,rc.holder_name requisition_holder_name
    FROM erp_deliveries d
    LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id
    LEFT JOIN erp_partners p ON p.id=s.customer_id
    LEFT JOIN erp_assignments a ON a.id=d.assignment_id
    LEFT JOIN erp_requisition_context rc ON rc.requisition_id=d.requisition_id
    WHERE d.id=?`,[id]);
  if(!header)return fail(c,'Delivery not found',404);
  if(header.status!=='RELEASED')return fail(c,'Only released deliveries can be completed',409);
  const assets=await all(c.env.DB,`SELECT da.*,a.category,a.unit_cost FROM erp_delivery_assets da LEFT JOIN erp_assets a ON a.id=da.asset_id WHERE da.delivery_id=?`,[id]);
  const tx=header.transaction_type||header.assignment_type||header.requisition_holder_type;
  const target=tx==='SALE'?'SOLD':tx==='DEMO'?'DEMO':tx==='PILOT'?'PILOT_TEST':
    tx==='EMPLOYEE_USE'||header.requisition_holder_type==='EMPLOYEE'?'EMPLOYEE_ASSIGNED':
    tx==='INTERNAL_USE'||header.requisition_holder_type==='DEPARTMENT'?'INTERNAL_ASSIGNED':
    tx==='PROJECT_DEPLOYMENT'||header.requisition_holder_type==='PROJECT_SITE'?'PROJECT_ASSIGNED':'LEASED';
  const holderType=header.requisition_holder_type||header.assignment_type||'CUSTOMER';
  const holderId=header.assignment_partner_id||header.customer_id||null;
  const holderName=header.requisition_holder_name||header.assignment_holder_name||header.customer_name||header.recipient_name;
  for(const asset of assets.filter(x=>x.serial_no)){
    try{
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no,movementType:'DELIVERED',movementDate:b.deliveryDate||new Date().toISOString(),
        toLocationId:null,toLocationCode:normalizeText(header.destination),toStatus:target,
        holderType,holderId,holderName,sourceDocType:'DELIVERY',sourceDocId:id,sourceDocNo:header.delivery_no,
        reasonCode:tx||'DELIVERY',notes:normalizeText(b.notes),
      },c.get('erpUser').email);
    }catch(e){return fail(c,e.message,409);}
  }
  await run(c.env.DB,`UPDATE erp_deliveries SET status='DELIVERED',actual_delivery_date=?,
    proof_document_url=COALESCE(?,proof_document_url) WHERE id=?`,[
    b.deliveryDate||new Date().toISOString(),b.proofDocumentUrl||null,id,
  ]);
  if(header.sales_order_id)await run(c.env.DB,`UPDATE erp_sales_orders SET status='POSTED',posted_by=?,posted_at=datetime('now') WHERE id=?`,[c.get('erpUser').email,header.sales_order_id]);
  if(header.assignment_id)await run(c.env.DB,`UPDATE erp_assignments SET status='ACTIVE' WHERE id=?`,[header.assignment_id]);
  if(header.requisition_id){
    await run(c.env.DB,`UPDATE erp_requisitions SET status='FULFILLED' WHERE id=?`,[header.requisition_id]);
    await run(c.env.DB,`UPDATE erp_requisition_allocations SET allocation_status='DEPLOYED' WHERE requisition_id=?`,[header.requisition_id]);
  }
  const user=c.get('erpUser').email;
  const eventDate=(b.deliveryDate||new Date().toISOString()).slice(0,10);
  const totalCost=assets.reduce((sum,row)=>sum+Number(row.unit_cost||0)*Number(row.qty||1),0);
  if(tx==='SALE'){
    const gross=Number(header.gross_amount||0);
    const net=Math.round((gross/1.12)*100)/100;
    const tax=Math.round((gross-net)*100)/100;
    await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_REVENUE:${id}`,eventType:'CUSTOMER_INVOICE',sourceModule:'SALES',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,
      partnerId:header.customer_id,amount:gross,taxAmount:tax,businessLine:'SALE',
      description:`Delivered sale ${header.sales_order_no||header.delivery_no}`,
      payload:{grossAmount:gross,netAmount:net,taxAmount:tax,businessLine:'SALE'},
    },user);
    await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_COGS:${id}`,eventType:'SALE_COGS',sourceModule:'INVENTORY',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,
      partnerId:header.customer_id,amount:totalCost,businessLine:'SALE',
      description:`Cost of delivered sale ${header.sales_order_no||header.delivery_no}`,
      payload:{costAmount:totalCost,businessLine:'SALE'},
    },user);
  }else{
    await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_CUSTODY:${id}`,eventType:'INVENTORY_CUSTODY',sourceModule:'INVENTORY',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,
      partnerId:holderId,amount:totalCost,businessLine:tx||'INTERNAL',financialEffect:'NONE',
      description:`Custody movement ${header.delivery_no} - no immediate accounting effect`,
    },user);
  }
  await audit(c,{action:'COMPLETE',module:'DELIVERIES',recordType:'DELIVERY',recordId:id,recordNo:header.delivery_no,
    after:{status:'DELIVERED',target,holderType,holderName}});
  return ok(c,{delivered:assets.length,status:target,holderType,holderName});
});
