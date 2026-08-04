import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensurePartner, ensureItem, nextCode, normalizeText } from '../lib/codes.js';
import { captureFinanceEvent, entityByCode, ensureAccountingPeriod } from '../lib/finance.js';
import { decideCoreWorkflowApproval } from '../lib/specialist-engine.js';

export const procurementRoutes = new Hono();

procurementRoutes.get('/purchase-orders', requirePermission('PROCUREMENT','VIEW'), async c => {
  const {page,size,offset}=pageParams(c); const q=`%${normalizeText(c.req.query('q'))}%`; const status=normalizeText(c.req.query('status'));
  const where=[]; const args=[];
  if(q!=='%%'){where.push('(p.purchase_order_no LIKE ? OR p.vendor_name LIKE ?)');args.push(q,q);}
  if(status){where.push('p.status=?');args.push(status);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=await all(c.env.DB,`SELECT p.*,(SELECT COUNT(*) FROM erp_purchase_order_lines l WHERE l.purchase_order_id=p.id) line_count FROM erp_purchase_orders p ${w} ORDER BY COALESCE(p.order_date,p.created_at) DESC LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_purchase_orders p ${w}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

procurementRoutes.post('/purchase-orders', requirePermission('PROCUREMENT','CREATE'), async c => {
  const b=await jsonBody(c); if(!b.vendorName)return fail(c,'Vendor is required');
  const lines=(Array.isArray(b.lines)?b.lines:[]).filter(x=>normalizeText(x.description||x.itemName||x.itemCode)&&numberValue(x.qty)>0);
  if(!lines.length)return fail(c,'At least one purchase-order line is required');
  const vendor=await ensurePartner(c.env.DB,{name:b.vendorName,type:'VENDOR',address:b.vendorAddress||'',sourceSystem:'E88_FINSYS'});
  const no=normalizeText(b.purchaseOrderNo)||await nextCode(c.env.DB,'PURCHASE_ORDER','PO',6);
  const subtotal=lines.reduce((s,x)=>s+numberValue(x.qty)*numberValue(x.unitCost),0); const tax=numberValue(b.taxAmount); const total=subtotal+tax;
  const r=await run(c.env.DB,`INSERT INTO erp_purchase_orders(purchase_order_no,vendor_id,vendor_name,order_date,expected_delivery_date,currency,exchange_rate,incoterm,payment_terms,status,subtotal,tax_amount,total_amount,source_system,source_key,created_by) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?)`,[no,vendor.id,vendor.name,b.orderDate||'',b.expectedDeliveryDate||'',b.currency||'PHP',numberValue(b.exchangeRate,1),normalizeText(b.incoterm),normalizeText(b.paymentTerms),subtotal,tax,total,normalizeText(b.sourceSystem||'E88_FINSYS'),normalizeText(b.sourceKey),c.get('erpUser').email]);
  let lineNo=0;
  for(const line of lines){lineNo+=1;const item=await ensureItem(c.env.DB,{itemCode:line.itemCode,itemName:line.itemName||line.description,category:line.category,manufacturer:line.manufacturer,model:line.model,color:line.color,serialized:!!line.serialized,standardCost:numberValue(line.unitCost),sourceSystem:'PO',sourceKey:`${no}|${lineNo}`});const qty=numberValue(line.qty);const cost=numberValue(line.unitCost);await run(c.env.DB,`INSERT INTO erp_purchase_order_lines(purchase_order_id,line_no,item_id,item_code,description,category,ordered_qty,unit_cost,line_amount) VALUES(?,?,?,?,?,?,?,?,?)`,[r.meta.last_row_id,lineNo,item.id,item.item_code,line.description||item.item_name,item.category,qty,cost,qty*cost]);}
  // Optional approval chain with creator e-signature and no-login token links
  let firstToken=null, chainBuilt=false;
  const approvers=Array.isArray(b.approvers)?b.approvers.filter(a=>normalizeText(a&&a.email)):[];
  if(approvers.length && normalizeText(b.creatorSignature)){
    const poId=r.meta.last_row_id;
    await run(c.env.DB,`INSERT INTO erp_po_approvals(purchase_order_id,purchase_order_no,step_no,role,approver_name,approver_email,token,status,signature,signature_type,decided_at) VALUES(?,?,?,?,?,?,?, 'APPROVED', ?, ?, datetime('now'))`,
      [poId,no,0,'CREATOR',normalizeText(b.creatorName)||c.get('erpUser').email,c.get('erpUser').email,null,normalizeText(b.creatorSignature),(normalizeText(b.creatorSignatureType)||'TYPE')]);
    let step=0;
    for(const a of approvers){
      step+=1;
      const token=(crypto.randomUUID?crypto.randomUUID():('t'+Date.now()+Math.random().toString(36).slice(2)))+'-'+step;
      if(!firstToken)firstToken=token;
      await run(c.env.DB,`INSERT INTO erp_po_approvals(purchase_order_id,purchase_order_no,step_no,role,approver_name,approver_email,token,status) VALUES(?,?,?,?,?,?,?,'PENDING')`,
        [poId,no,step,normalizeText(a.role)||('STEP_'+step),normalizeText(a.name),normalizeText(a.email),token]);
    }
    await run(c.env.DB,`UPDATE erp_purchase_orders SET status='FOR_APPROVAL', updated_at=datetime('now') WHERE id=?`,[poId]);
    chainBuilt=true;
  }
  const __docMeta={vendorContactPerson:normalizeText(b.vendorContactPerson),vendorContactNumber:normalizeText(b.vendorContactNumber),vendorEmail:normalizeText(b.vendorEmail),vendorAddress:normalizeText(b.vendorAddress),vendorTaxId:normalizeText(b.vendorTaxId),activityPurpose:normalizeText(b.activityPurpose),invoiceNumber:normalizeText(b.invoiceNumber),paymentTerms:normalizeText(b.paymentTerms),deliveryTerms:normalizeText(b.deliveryTerms),otherRemarks:normalizeText(b.otherRemarks),customerDepartment:normalizeText(b.customerDepartment),requestedByName:normalizeText(b.requestedByName)||normalizeText(b.creatorName),requestedByTitle:normalizeText(b.requestedByTitle)||'Requestor',deptHeadName:(approvers.find(x=>(x.role||'').toUpperCase()==='DEPT_HEAD')||{}).name||'',financeName:(approvers.find(x=>(x.role||'').toUpperCase()==='FINANCE')||{}).name||'Mark Alexis Mungcal',ceoName:(approvers.find(x=>(x.role||'').toUpperCase()==='CEO')||{}).name||'',lineMeta:lines.map((x,i)=>({no:i+1,unit:normalizeText(x.unit)||'pcs',remarks:normalizeText(x.remarks)}))};
  try{await run(c.env.DB,`INSERT INTO erp_po_doc(purchase_order_id,meta) VALUES(?,?)`,[r.meta.last_row_id,JSON.stringify(__docMeta)]);}catch(e){}
  await audit(c,{action:'CREATE',module:'PROCUREMENT',recordType:'PURCHASE_ORDER',recordId:r.meta.last_row_id,recordNo:no,after:{...b,total}});
  return ok(c,{id:r.meta.last_row_id,purchaseOrderNo:no,total,chainBuilt,firstToken},201);
});

procurementRoutes.get('/purchase-orders/:id', requirePermission('PROCUREMENT','VIEW'), async c => {
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT * FROM erp_purchase_orders WHERE id=?`,[id]); if(!header)return fail(c,'Purchase order not found',404);
  const lines=await all(c.env.DB,`SELECT * FROM erp_purchase_order_lines WHERE purchase_order_id=? ORDER BY line_no`,[id]);
  const shipments=await all(c.env.DB,`SELECT * FROM erp_shipments WHERE purchase_order_ref=? ORDER BY created_at DESC`,[header.purchase_order_no]);
  const __d=await first(c.env.DB,`SELECT meta FROM erp_po_doc WHERE purchase_order_id=?`,[id]);
  let doc={};try{doc=(__d&&__d.meta)?JSON.parse(__d.meta):{};}catch(e){doc={};}
  const __lm={};(doc.lineMeta||[]).forEach(m=>{__lm[m.no]=m;});
  const linesX=lines.map(l=>({...l,unit:(__lm[l.line_no]||{}).unit||'pcs',remarks:(__lm[l.line_no]||{}).remarks||''}));
  return ok(c,{header:{...header,doc},lines:linesX,shipments});
});

procurementRoutes.post('/purchase-orders/:id/approve', requirePermission('PROCUREMENT','APPROVE'), async c => {
  const id=Number(c.req.param('id')); const before=await first(c.env.DB,`SELECT * FROM erp_purchase_orders WHERE id=?`,[id]); if(!before)return fail(c,'Purchase order not found',404); if(before.status!=='DRAFT')return fail(c,'Only draft purchase orders can be approved',409);
  const body=await jsonBody(c);let approvalDecision;
  try{approvalDecision=await decideCoreWorkflowApproval(c.env.DB,'ip-sourcing-purchasing',{
    sourceType:'PURCHASE_ORDER',sourceId:id,sourceNo:before.purchase_order_no,recordType:'Purchase Order',
    department:'Supply Chain',amount:before.total_amount,createdBy:before.created_by,
  },c.get('erpUser'),body.decision||'APPROVE',body.notes||'');}catch(error){return fail(c,error.message,409);}
  if(approvalDecision.rejected)return fail(c,'The purchase order approval was rejected.',409);
  if(!approvalDecision.completed){
    await audit(c,{action:'APPROVAL_STEP',module:'PROCUREMENT',recordType:'PURCHASE_ORDER',recordId:id,recordNo:before.purchase_order_no,before,after:{approvalDecision}});
    return ok(c,{approved:false,pendingApproval:true,approvalDecision});
  }
  await run(c.env.DB,`UPDATE erp_purchase_orders SET status='APPROVED',approved_by=?,approved_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[c.get('erpUser').email,id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_purchase_orders WHERE id=?`,[id]); await audit(c,{action:'APPROVE',module:'PROCUREMENT',recordType:'PURCHASE_ORDER',recordId:id,recordNo:after.purchase_order_no,before,after}); return ok(c,{purchaseOrder:after,approved:true,approvalDecision});
});

procurementRoutes.get('/landed-cost', requirePermission('PROCUREMENT','VIEW'), async c => {
  const rows=await all(c.env.DB,`SELECT h.*,s.shipment_no,p.purchase_order_no,(SELECT COUNT(*) FROM erp_landed_cost_lines l WHERE l.landed_cost_id=h.id) cost_lines FROM erp_landed_cost_headers h LEFT JOIN erp_shipments s ON s.id=h.shipment_id LEFT JOIN erp_purchase_orders p ON p.id=h.purchase_order_id ORDER BY h.created_at DESC LIMIT 500`);
  return ok(c,{rows});
});

procurementRoutes.post('/landed-cost', requirePermission('PROCUREMENT','CREATE'), async c => {
  const b=await jsonBody(c); if(!b.shipmentId&&!b.purchaseOrderId)return fail(c,'Shipment or purchase order is required');
  const costs=(Array.isArray(b.costs)?b.costs:[]).filter(x=>normalizeText(x.costType)&&numberValue(x.amount)!==0); if(!costs.length)return fail(c,'At least one landed-cost line is required');
  const no=await nextCode(c.env.DB,'LANDED_COST','LC',6);
  const capitalizableTotal=costs.reduce((s,x)=>s+numberValue(x.amount),0);
  const inputVatTotal=costs.reduce((s,x)=>s+(x.taxRecoverable===false?0:numberValue(x.taxAmount)),0);
  const nonRecoverableTax=costs.reduce((s,x)=>s+(x.taxRecoverable===false?numberValue(x.taxAmount):0),0);
  const total=capitalizableTotal+nonRecoverableTax;
  const invoiceTotal=total+inputVatTotal;
  const r=await run(c.env.DB,`INSERT INTO erp_landed_cost_headers(
    landed_cost_no,shipment_id,purchase_order_id,allocation_method,currency,exchange_rate,
    total_cost,input_vat_amount,invoice_total,notes,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[
    no,b.shipmentId||null,b.purchaseOrderId||null,b.allocationMethod||'VALUE',b.currency||'PHP',
    numberValue(b.exchangeRate,1),total,inputVatTotal,invoiceTotal,normalizeText(b.notes),c.get('erpUser').email,
  ]);
  for(const line of costs)await run(c.env.DB,`INSERT INTO erp_landed_cost_lines(
    landed_cost_id,cost_type,vendor_name,reference_no,amount,tax_amount,tax_recoverable,notes
  ) VALUES(?,?,?,?,?,?,?,?)`,[
    r.meta.last_row_id,normalizeText(line.costType),normalizeText(line.vendorName),normalizeText(line.referenceNo),
    numberValue(line.amount),numberValue(line.taxAmount),line.taxRecoverable===false?0:1,normalizeText(line.notes),
  ]);
  await audit(c,{action:'CREATE',module:'PROCUREMENT',recordType:'LANDED_COST',recordId:r.meta.last_row_id,
    recordNo:no,after:{...b,capitalizableTotal:total,inputVatTotal,invoiceTotal}});
  return ok(c,{id:r.meta.last_row_id,landedCostNo:no,capitalizableTotal:total,inputVatTotal,invoiceTotal},201);
});

procurementRoutes.post('/landed-cost/:id/post', requirePermission('PROCUREMENT','POST'), async c => {
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT * FROM erp_landed_cost_headers WHERE id=?`,[id]); if(!header)return fail(c,'Landed cost not found',404); if(header.status==='POSTED')return fail(c,'Landed cost is already posted',409);
  const eventDate=(normalizeText(header.posting_date)||new Date().toISOString()).slice(0,10);
  const entity=await entityByCode(c.env.DB,'E88');
  if(!entity)return fail(c,'Accounting entity E88 is not configured.',409);
  const period=await ensureAccountingPeriod(c.env.DB,entity.id,eventDate);
  if(period.status==='CLOSED')return fail(c,`Accounting period ${period.period_name} is closed. Reopen it before posting landed cost.`,409);
  const assets=await all(c.env.DB,`SELECT * FROM erp_assets WHERE (? IS NOT NULL AND shipment_id=?) OR (? IS NOT NULL AND shipment_id IN (SELECT id FROM erp_shipments WHERE purchase_order_ref=(SELECT purchase_order_no FROM erp_purchase_orders WHERE id=?)))`,[header.shipment_id,header.shipment_id,header.purchase_order_id,header.purchase_order_id]); if(!assets.length)return fail(c,'No received assets are available for allocation');
  const basis=assets.map(a=>header.allocation_method==='VALUE'?Math.max(numberValue(a.unit_cost),1):1);
  const totalBasis=basis.reduce((s,x)=>s+x,0);let allocated=0;const allocatedByClass=new Map();
  for(let i=0;i<assets.length;i++){
    const amount=i===assets.length-1?Number(header.total_cost)-allocated:Math.round((Number(header.total_cost)*basis[i]/totalBasis)*100)/100;
    allocated+=amount;
    const category=normalizeText(assets[i].category||'OTH').toUpperCase()||'OTH';
    allocatedByClass.set(category,Math.round(((allocatedByClass.get(category)||0)+amount)*100)/100);
    await run(c.env.DB,`INSERT INTO erp_landed_cost_allocations(landed_cost_id,asset_id,serial_no,item_id,allocation_basis,allocated_amount) VALUES(?,?,?,?,?,?)`,[id,assets[i].id,assets[i].serial_no,assets[i].item_id,basis[i],amount]);
    await run(c.env.DB,`UPDATE erp_assets SET landed_cost=landed_cost+?,unit_cost=unit_cost+?,updated_at=datetime('now') WHERE id=?`,[amount,amount,assets[i].id]);
  }
  const user=c.get('erpUser').email;
  await run(c.env.DB,`UPDATE erp_landed_cost_headers SET status='POSTED',posted_by=?,posted_at=datetime('now') WHERE id=?`,[user,id]);
  for(const [category,amount] of allocatedByClass){
    if(amount<=0)continue;
    await captureFinanceEvent(c.env.DB,{
      eventKey:`LANDED_COST:${id}:${category}`,eventType:'LANDED_COST',sourceModule:'PROCUREMENT',
      sourceType:'LANDED_COST',sourceId:id,sourceNo:header.landed_cost_no,
      eventDate,amount,
      currency:header.currency||'PHP',description:`Landed cost allocation ${header.landed_cost_no} · ${category}`,
      payload:{grossAmount:amount,netAmount:amount,capitalizableAmount:amount,category,accrualAccountCode:'2060'},
    },user);
  }
  await audit(c,{action:'POST',module:'PROCUREMENT',recordType:'LANDED_COST',recordId:id,recordNo:header.landed_cost_no,after:{assets:assets.length,total:header.total_cost}}); return ok(c,{allocatedAssets:assets.length,totalAllocated:allocated});
});
