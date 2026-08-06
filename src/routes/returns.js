import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensureLocation, nextCode, normalizeSerial, normalizeText } from '../lib/codes.js';
import { getAsset, postMovement } from '../lib/inventory.js';
import { captureFinanceEvent, entityByCode, ensureAccountingPeriod } from '../lib/finance.js';
import { cogsAccountForCategory, inventoryAccountForCategory } from '../lib/transaction-rules.js';

export const returnRoutes = new Hono();

returnRoutes.get('/', requirePermission('RETURNS','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c); const status=c.req.query('status')||''; const args=[]; let where='';
  if(status){where='WHERE r.status=?';args.push(status);}
  const rows=await all(c.env.DB,`SELECT r.*,a.assignment_no,p.name partner_name,l.code return_location_code,
    d.delivery_no,s.sales_order_no,(SELECT name FROM erp_partners WHERE id=s.customer_id) customer_name,
    (SELECT COUNT(*) FROM erp_return_lines x WHERE x.return_id=r.id) line_count,
    (SELECT COUNT(*) FROM erp_return_lines x WHERE x.return_id=r.id AND x.acceptance_status!='MATCHED') exception_count
    FROM erp_return_orders r
    LEFT JOIN erp_assignments a ON a.id=r.assignment_id
    LEFT JOIN erp_partners p ON p.id=r.partner_id
    LEFT JOIN erp_locations l ON l.id=r.return_location_id
    LEFT JOIN erp_deliveries d ON d.id=r.source_delivery_id
    LEFT JOIN erp_sales_orders s ON s.id=r.source_sales_order_id
    ${where} ORDER BY r.return_date DESC,r.id DESC LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_return_orders r ${where}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

returnRoutes.get('/assignments/active', requirePermission('RETURNS','VIEW'), async c=>{
  const rows=await all(c.env.DB,`SELECT a.*,p.name partner_name,r.id requisition_id,
    rc.holder_type,rc.holder_name,rc.expected_return_date,
    (SELECT COUNT(*) FROM erp_assignment_assets aa WHERE aa.assignment_id=a.id) asset_count
    FROM erp_assignments a
    LEFT JOIN erp_partners p ON p.id=a.partner_id
    LEFT JOIN erp_requisitions r ON r.requisition_no=a.source_request_no
    LEFT JOIN erp_requisition_context rc ON rc.requisition_id=r.id
    WHERE a.status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED') AND EXISTS(
      SELECT 1 FROM erp_assignment_assets aa
      WHERE aa.assignment_id=a.id
        AND NOT EXISTS(
          SELECT 1
          FROM erp_return_lines rl
          JOIN erp_return_orders ro ON ro.id=rl.return_id
          WHERE ro.assignment_id=a.id
            AND ro.status='POSTED'
            AND rl.expected_serial=aa.serial_no
        )
    )
    ORDER BY COALESCE(a.expected_return_date,a.start_date) ASC,a.id DESC`);
  const assets=await all(c.env.DB,`SELECT aa.assignment_id,aa.asset_id,aa.serial_no,aa.role_code,
    a.item_code,a.item_name,a.category,a.current_status,a.current_location_code,a.condition_code
    FROM erp_assignment_assets aa JOIN erp_assets a ON a.id=aa.asset_id
    JOIN erp_assignments h ON h.id=aa.assignment_id
    WHERE h.status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED')
      AND NOT EXISTS(
        SELECT 1
        FROM erp_return_lines rl
        JOIN erp_return_orders ro ON ro.id=rl.return_id
        WHERE ro.assignment_id=aa.assignment_id
          AND ro.status='POSTED'
          AND rl.expected_serial=aa.serial_no
      )
    ORDER BY aa.assignment_id,a.category,a.item_name,aa.serial_no`);
  return ok(c,{rows,assets});
});

returnRoutes.get('/deliveries/returnable', requirePermission('RETURNS','VIEW'), async c=>{
  const rows=await all(c.env.DB,`SELECT d.id delivery_id,d.delivery_no,d.actual_delivery_date,
    s.id sales_order_id,s.sales_order_no,s.customer_id,(SELECT name FROM erp_partners WHERE id=s.customer_id) customer_name,s.gross_amount,
    (SELECT COUNT(*) FROM erp_delivery_assets da WHERE da.delivery_id=d.id AND da.asset_id IS NOT NULL) delivered_assets,
    (SELECT COUNT(*) FROM erp_delivery_assets da WHERE da.delivery_id=d.id AND da.asset_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM erp_return_orders ro JOIN erp_return_lines rl ON rl.return_id=ro.id
        WHERE ro.source_delivery_id=d.id AND ro.status='POSTED' AND rl.expected_serial=da.serial_no)) returnable_assets
    FROM erp_deliveries d JOIN erp_sales_orders s ON s.id=d.sales_order_id
    WHERE d.status='DELIVERED' AND s.transaction_type='SALE'
      AND EXISTS(SELECT 1 FROM erp_delivery_assets da WHERE da.delivery_id=d.id AND da.asset_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM erp_return_orders ro JOIN erp_return_lines rl ON rl.return_id=ro.id
          WHERE ro.source_delivery_id=d.id AND ro.status='POSTED' AND rl.expected_serial=da.serial_no))
    ORDER BY d.actual_delivery_date DESC,d.id DESC`);
  const assets=await all(c.env.DB,`SELECT d.id delivery_id,da.asset_id,da.serial_no,a.item_code,a.item_name,
    a.category,a.unit_cost,a.current_status,a.condition_code
    FROM erp_deliveries d JOIN erp_sales_orders s ON s.id=d.sales_order_id
    JOIN erp_delivery_assets da ON da.delivery_id=d.id JOIN erp_assets a ON a.id=da.asset_id
    WHERE d.status='DELIVERED' AND s.transaction_type='SALE'
      AND NOT EXISTS(SELECT 1 FROM erp_return_orders ro JOIN erp_return_lines rl ON rl.return_id=ro.id
        WHERE ro.source_delivery_id=d.id AND ro.status='POSTED' AND rl.expected_serial=da.serial_no)
    ORDER BY d.id,a.category,a.item_name,a.serial_no`);
  return ok(c,{rows,assets});
});

returnRoutes.post('/', requirePermission('RETURNS','CREATE'), async(c)=>{
  const b=await jsonBody(c);
  const actual=(Array.isArray(b.lines)?b.lines:[]).map(x=>({...x,
    expectedSerial:normalizeSerial(x.expectedSerial),actualSerial:normalizeSerial(x.actualSerial)}));
  if(!actual.length)return fail(c,'At least one return line is required');
  const assignmentId=Number(b.assignmentId||0);const deliveryId=Number(b.deliveryId||0);
  if(!assignmentId&&!deliveryId)return fail(c,'Select an active deployment or a delivered customer sale.');
  let assignment=null;let saleDelivery=null;let available=[];let partnerId=null;let returnType='CUSTODY_RETURN';
  if(assignmentId){
    assignment=await first(c.env.DB,`SELECT * FROM erp_assignments
      WHERE id=? AND status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED')`,[assignmentId]);
    if(!assignment)return fail(c,'The selected deployment is not active or returnable.',409);
    available=await all(c.env.DB,`SELECT aa.*,a.category,a.unit_cost FROM erp_assignment_assets aa
      LEFT JOIN erp_assets a ON a.id=aa.asset_id WHERE aa.assignment_id=?
        AND NOT EXISTS(SELECT 1 FROM erp_return_lines rl JOIN erp_return_orders ro ON ro.id=rl.return_id
          WHERE ro.assignment_id=aa.assignment_id AND ro.status='POSTED' AND rl.expected_serial=aa.serial_no)`,[assignmentId]);
    partnerId=assignment.partner_id||b.partnerId||null;
  }else{
    saleDelivery=await first(c.env.DB,`SELECT d.*,s.id sales_order_id,s.sales_order_no,s.customer_id,
      (SELECT name FROM erp_partners WHERE id=s.customer_id) customer_name,s.gross_amount FROM erp_deliveries d JOIN erp_sales_orders s ON s.id=d.sales_order_id
      WHERE d.id=? AND d.status='DELIVERED' AND s.transaction_type='SALE'`,[deliveryId]);
    if(!saleDelivery)return fail(c,'The selected delivery is not a completed customer sale.',409);
    available=await all(c.env.DB,`SELECT da.asset_id,da.serial_no,a.category,a.unit_cost
      FROM erp_delivery_assets da JOIN erp_assets a ON a.id=da.asset_id WHERE da.delivery_id=?
        AND NOT EXISTS(SELECT 1 FROM erp_return_orders ro JOIN erp_return_lines rl ON rl.return_id=ro.id
          WHERE ro.source_delivery_id=? AND ro.status='POSTED' AND rl.expected_serial=da.serial_no)`,[deliveryId,deliveryId]);
    partnerId=saleDelivery.customer_id;returnType='SALES_RETURN';
  }
  const availableMap=new Map(available.map(row=>[row.serial_no,row]));
  for(const line of actual){
    if(!line.expectedSerial||!availableMap.has(line.expectedSerial)){
      return fail(c,`Expected serial ${line.expectedSerial||'(blank)'} is not available for this return.`,409);
    }
    line.itemCategory=line.itemCategory||availableMap.get(line.expectedSerial).category;
  }
  const loc=await ensureLocation(c.env.DB,b.returnLocationName||'Returns Quarantine',
    b.returnLocationType||'QUARANTINE',b.returnLocationCode||'RET-QUAR');
  const no=await nextCode(c.env.DB,'RETURN','RET',6);
  let refundGross=0;let refundTax=0;let refundNet=0;
  if(returnType==='SALES_RETURN'&&b.issueCredit!==false){
    const totalAssets=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_delivery_assets
      WHERE delivery_id=? AND asset_id IS NOT NULL`,[deliveryId]);
    const defaultGross=Number(saleDelivery.gross_amount||0)*actual.length/Math.max(1,Number(totalAssets?.n||1));
    refundGross=Math.round(numberValue(b.refundGrossAmount,defaultGross)*100)/100;
    refundTax=Math.round(numberValue(b.refundTaxAmount,refundGross-refundGross/1.12)*100)/100;
    refundNet=Math.round((refundGross-refundTax)*100)/100;
    const prior=await first(c.env.DB,`SELECT COALESCE(SUM(refund_gross_amount),0) amount FROM erp_return_orders
      WHERE source_sales_order_id=? AND status NOT IN ('CANCELLED','REJECTED','REVERSED')`,[saleDelivery.sales_order_id]);
    if(refundGross<0||refundTax<0||refundNet<0)return fail(c,'Return credit amounts cannot be negative.');
    if(Number(prior?.amount||0)+refundGross>Number(saleDelivery.gross_amount||0)+0.01){
      return fail(c,'The cumulative customer credit cannot exceed the original sales-order amount.',409);
    }
  }
  const rr=await run(c.env.DB,`INSERT INTO erp_return_orders(
    return_no,assignment_id,partner_id,return_date,return_location_id,status,reason_code,notes,created_by,
    source_delivery_id,source_sales_order_id,return_type,refund_net_amount,refund_tax_amount,refund_gross_amount)
    VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?)`,[
    no,assignmentId||null,partnerId,b.returnDate||new Date().toISOString(),loc.id,
    normalizeText(b.reasonCode),normalizeText(b.notes),c.get('erpUser').email,
    deliveryId||null,saleDelivery?.sales_order_id||null,returnType,refundNet,refundTax,refundGross,
  ]);
  const returnId=rr.meta.last_row_id;const results=[];
  for(const line of actual){
    const expectedAsset=line.expectedSerial?await getAsset(c.env.DB,line.expectedSerial):null;
    const actualAsset=line.actualSerial?await getAsset(c.env.DB,line.actualSerial):null;
    let acceptance='MATCHED';let notes=normalizeText(line.notes);
    if(!actualAsset){acceptance='UNKNOWN_SERIAL';notes=notes||'Actual returned serial is not registered';}
    else if(line.expectedSerial&&line.expectedSerial!==line.actualSerial){
      acceptance=['BAT','BATTERY'].includes(line.itemCategory)?'BATTERY_SWAP':'SERIAL_MISMATCH';
    }
    const lr=await run(c.env.DB,`INSERT INTO erp_return_lines(
      return_id,expected_asset_id,expected_serial,actual_asset_id,actual_serial,item_category,
      acceptance_status,condition_code,notes) VALUES(?,?,?,?,?,?,?,?,?)`,[
      returnId,expectedAsset?.id||null,line.expectedSerial||'',actualAsset?.id||null,line.actualSerial||'',
      line.itemCategory||actualAsset?.category||expectedAsset?.category||'',acceptance,
      normalizeText(line.conditionCode||'GOOD').toUpperCase(),notes,
    ]);
    let caseNo='';
    if(acceptance!=='MATCHED'){
      caseNo=await nextCode(c.env.DB,'RECON','REC',6);
      await run(c.env.DB,`INSERT INTO erp_reconciliation_cases(
        case_no,case_type,return_id,assignment_id,expected_serial,actual_serial,
        related_motorcycle_serial,current_location_code,status,opened_by)
        VALUES(?,?,?,?,?,?,?,?, 'UNRECONCILED',?)`,[
        caseNo,acceptance,returnId,assignmentId||null,line.expectedSerial||'',line.actualSerial||'',
        normalizeSerial(line.relatedMotorcycleSerial||''),loc.code,c.get('erpUser').email,
      ]);
    }
    results.push({returnLineId:lr.meta.last_row_id,expectedSerial:line.expectedSerial,
      actualSerial:line.actualSerial,acceptance,caseNo});
  }
  if(assignmentId){
    await run(c.env.DB,`INSERT INTO erp_document_flow_links(
      source_type,source_id,source_no,target_type,target_id,target_no,relation_type,created_by)
      VALUES('ASSIGNMENT',?,?, 'RETURN',?,?, 'RETURNED_BY',?)`,[
      assignmentId,assignment.assignment_no,returnId,no,c.get('erpUser').email,
    ]);
  }else{
    await run(c.env.DB,`INSERT INTO erp_document_flow_links(
      source_type,source_id,source_no,target_type,target_id,target_no,relation_type,created_by)
      VALUES('DELIVERY',?,?, 'RETURN',?,?, 'RETURNED_BY',?)`,[
      deliveryId,saleDelivery.delivery_no,returnId,no,c.get('erpUser').email,
    ]);
  }
  await audit(c,{action:'CREATE_RETURN',module:'RETURNS',recordType:'RETURN',recordId:returnId,
    recordNo:no,after:{returnType,deliveryId:deliveryId||null,assignmentId:assignmentId||null,
      refundGross,refundTax,refundNet,lines:results}});
  return ok(c,{returnId,returnNo:no,returnType,refundGross,refundTax,refundNet,lines:results},201);
});

returnRoutes.post('/:id/post', requirePermission('RETURNS','POST'), async(c)=>{
  const id=Number(c.req.param('id'));const user=c.get('erpUser').email;
  const header=await first(c.env.DB,`SELECT r.*,l.code location_code,l.id location_id,
    s.sales_order_no,s.customer_id,s.gross_amount original_gross_amount
    FROM erp_return_orders r LEFT JOIN erp_locations l ON l.id=r.return_location_id
    LEFT JOIN erp_sales_orders s ON s.id=r.source_sales_order_id WHERE r.id=?`,[id]);
  if(!header)return fail(c,'Return not found',404);
  if(header.status==='POSTED')return fail(c,'Return already posted',409);
  const lines=await all(c.env.DB,`SELECT rl.*,a.id returned_asset_id,a.unit_cost,a.category returned_category,
    a.item_id,a.item_code,f.id fixed_asset_book_id FROM erp_return_lines rl
    LEFT JOIN erp_assets a ON a.serial_no=rl.actual_serial
    LEFT JOIN erp_fixed_asset_books f ON f.asset_id=a.id AND f.status IN ('ACTIVE','PENDING_APPROVAL')
    WHERE rl.return_id=?`,[id]);
  if(header.return_type==='SALES_RETURN'){
    const entity=await entityByCode(c.env.DB,'E88');
    if(!entity)return fail(c,'Accounting entity E88 is not configured.',409);
    const period=await ensureAccountingPeriod(c.env.DB,entity.id,header.return_date);
    if(period.status==='CLOSED')return fail(c,`Accounting period ${period.period_name} is closed. Reopen it or use an approved return date.`,409);
    const missing=lines.filter(line=>line.acceptance_status==='MATCHED'&&
      normalizeText(line.condition_code||'GOOD').toUpperCase()==='GOOD'&&Number(line.unit_cost||0)<=0);
    if(missing.length){
      for(const line of missing)await run(c.env.DB,`INSERT OR IGNORE INTO erp_inventory_valuation_exceptions(
        asset_id,item_id,serial_no,item_code,exception_type,source_document_type,source_document_id,
        source_document_no,exception_message,requested_by)
        VALUES(?,?,?,?, 'MISSING_UNIT_COST','RETURN',?,?,?,?)`,[
        line.returned_asset_id,line.item_id,line.actual_serial,line.item_code,id,header.return_no,
        'Sales-return COGS reversal is blocked until the returned serial has an approved cost.',user,
      ]);
      return fail(c,`Sales return is blocked because ${missing.length} accepted serial(s) have no approved cost. Resolve Inventory Valuation first.`,409);
    }
  }
  const posted=[];const acceptedForFinance=[];
  for(const line of lines){
    if(!line.actual_serial)continue;
    const asset=await getAsset(c.env.DB,line.actual_serial);
    if(!asset)continue;
    const unresolved=line.acceptance_status!=='MATCHED';
    const good=normalizeText(line.condition_code||'GOOD').toUpperCase()==='GOOD';
    const toStatus=unresolved||!good?'QUARANTINE':'AVAILABLE';
    try{
      const movement=await postMovement(c.env.DB,{
        serialNo:line.actual_serial,movementType:'RETURN',movementDate:header.return_date,
        toLocationId:header.location_id,toLocationCode:header.location_code,toStatus,
        holderType:null,holderId:null,holderName:null,reasonCode:line.acceptance_status,notes:line.notes,
        conditionCode:line.condition_code,reconciliationStatus:unresolved?'UNRECONCILED':'CLEAR',
        sourceDocType:'RETURN',sourceDocId:id,sourceDocNo:header.return_no,
      },user);
      posted.push(movement);
      if(header.return_type==='SALES_RETURN'&&!unresolved&&good){acceptedForFinance.push({...line,asset});}
      await run(c.env.DB,`UPDATE erp_return_obligations SET
        status=CASE WHEN ?='MATCHED' THEN 'CLOSED' ELSE 'RECONCILIATION_REQUIRED' END,
        return_order_id=?,received_asset_id=?,received_serial_no=?,
        closed_by=CASE WHEN ?='MATCHED' THEN ? ELSE closed_by END,
        closed_at=CASE WHEN ?='MATCHED' THEN datetime('now') ELSE closed_at END
        WHERE status IN ('OPEN','OVERDUE','RECONCILIATION_REQUIRED')
          AND (issued_serial_no=? OR (assignment_id=? AND expected_return_serial_no=?))`,[
        line.acceptance_status,id,asset.id,line.actual_serial,line.acceptance_status,user,
        line.acceptance_status,line.expected_serial,header.assignment_id||null,line.expected_serial,
      ]);
    }catch(e){return fail(c,`Unable to post ${line.actual_serial}: ${e.message}`,409);}
  }
  let customerCreditEventId=null;let inventoryReturnEventId=null;let restockCost=0;
  if(header.return_type==='SALES_RETURN'){
    const eventDate=(header.return_date||new Date().toISOString()).slice(0,10);
    if(Number(header.refund_gross_amount||0)>0){
      const credit=await captureFinanceEvent(c.env.DB,{
        eventKey:`SALES_RETURN_CREDIT:${id}`,eventType:'CUSTOMER_CREDIT',sourceModule:'RETURNS',
        sourceType:'RETURN',sourceId:id,sourceNo:header.return_no,eventDate,
        partnerId:header.customer_id||header.partner_id,amount:Number(header.refund_gross_amount||0),
        taxAmount:Number(header.refund_tax_amount||0),businessLine:'SALE',
        description:`Customer credit for ${header.return_no} / ${header.sales_order_no||''}`,
        payload:{grossAmount:Number(header.refund_gross_amount||0),netAmount:Number(header.refund_net_amount||0),
          taxAmount:Number(header.refund_tax_amount||0),businessLine:'SALE'},
      },user);
      if(credit.status==='ERROR')return fail(c,credit.error_message||'Customer credit journal could not be prepared.',409);
      customerCreditEventId=credit.id;
    }
    for(const line of acceptedForFinance){
      const cost=Number(line.asset.unit_cost||0);if(cost<=0)continue;
      const event=await captureFinanceEvent(c.env.DB,{
        eventKey:`SALES_RETURN_INVENTORY:${id}:${line.asset.id}`,eventType:'SALES_RETURN_INVENTORY',
        sourceModule:'RETURNS',sourceType:'RETURN',sourceId:id,sourceNo:header.return_no,eventDate,
        partnerId:header.customer_id||header.partner_id,amount:cost,businessLine:'SALE',
        description:`Return accepted ${line.actual_serial} from ${header.return_no}`,
        payload:{costAmount:cost,category:line.asset.category,assetId:line.asset.id,
          itemId:line.asset.item_id,serialNo:line.asset.serial_no,
          inventoryAccountCode:inventoryAccountForCategory(line.asset.category),cogsAccountCode:cogsAccountForCategory(line.asset.category)},
      },user);
      if(event.status==='ERROR')return fail(c,event.error_message||`Inventory return journal failed for ${line.actual_serial}.`,409);
      inventoryReturnEventId=inventoryReturnEventId||event.id;restockCost=Math.round((restockCost+cost)*100)/100;
    }
    const delivered=(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_delivery_assets
      WHERE delivery_id=? AND asset_id IS NOT NULL`,[header.source_delivery_id]))?.n||0;
    const returned=(await first(c.env.DB,`SELECT COUNT(DISTINCT rl.expected_serial) n
      FROM erp_return_orders ro JOIN erp_return_lines rl ON rl.return_id=ro.id
      WHERE ro.source_delivery_id=? AND ro.status IN ('DRAFT','POSTED') AND rl.acceptance_status='MATCHED'`,[
      header.source_delivery_id,
    ]))?.n||0;
    await run(c.env.DB,`UPDATE erp_sales_orders SET status=? WHERE id=?`,[
      Number(returned)>=Number(delivered)?'RETURNED':'PARTIALLY_RETURNED',header.source_sales_order_id,
    ]);
  }
  await run(c.env.DB,`UPDATE erp_return_orders SET status='POSTED',posted_by=?,posted_at=datetime('now'),
    restock_cost=?,customer_credit_event_id=?,inventory_return_event_id=? WHERE id=?`,[
    user,restockCost,customerCreditEventId,inventoryReturnEventId,id,
  ]);
  if(header.assignment_id){
    const expected=(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_assignment_assets WHERE assignment_id=?`,[header.assignment_id]))?.n||0;
    const returned=(await first(c.env.DB,`SELECT COUNT(DISTINCT rl.expected_serial) n
      FROM erp_return_lines rl JOIN erp_return_orders ro ON ro.id=rl.return_id
      WHERE ro.assignment_id=? AND ro.status='POSTED'`,[header.assignment_id]))?.n||0;
    await run(c.env.DB,`UPDATE erp_assignments SET status=?,actual_return_date=CASE WHEN ?>=?
      THEN ? ELSE actual_return_date END WHERE id=?`,[
      returned>=expected?'RETURNED':'PARTIALLY_RETURNED',returned,expected,header.return_date,header.assignment_id,
    ]);
    const assignment=await first(c.env.DB,`SELECT source_request_no FROM erp_assignments WHERE id=?`,[header.assignment_id]);
    if(assignment?.source_request_no){
      await run(c.env.DB,`UPDATE erp_requisition_allocations SET allocation_status='RETURNED',released_at=datetime('now')
        WHERE serial_no IN (SELECT actual_serial FROM erp_return_lines WHERE return_id=?)
          AND requisition_id=(SELECT id FROM erp_requisitions WHERE requisition_no=?)`,[
        id,assignment.source_request_no,
      ]);
    }
  }
  await audit(c,{action:'POST_RETURN',module:'RETURNS',recordType:'RETURN',recordId:id,
    recordNo:header.return_no,after:{posted,returnType:header.return_type,restockCost,
      customerCreditEventId,inventoryReturnEventId}});
  return ok(c,{posted,returnType:header.return_type,restockCost,customerCreditEventId,inventoryReturnEventId});
});

returnRoutes.get('/obligations/open', requirePermission('RETURNS','VIEW'), async c=>{
  const rows=await all(c.env.DB,`SELECT o.*,a.item_code,a.item_name,a.category,a.current_status
    FROM erp_return_obligations o LEFT JOIN erp_assets a ON a.id=o.issued_asset_id
    WHERE o.status IN ('OPEN','OVERDUE','RECONCILIATION_REQUIRED')
    ORDER BY CASE WHEN o.due_date<>'' AND o.due_date<date('now') THEN 0 ELSE 1 END,o.due_date,o.created_at`);
  return ok(c,{rows,total:rows.length});
});

returnRoutes.get('/reconciliation/open', requirePermission('RETURNS','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE status='UNRECONCILED' ORDER BY opened_at DESC`);
  return ok(c,{rows});
});

returnRoutes.post('/reconciliation/:id/resolve', requirePermission('RETURNS','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id')); const b=await jsonBody(c); const before=await first(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE id=?`,[id]);
  if(!before)return fail(c,'Reconciliation case not found',404); if(before.status!=='UNRECONCILED')return fail(c,'Case is already resolved',409);
  await run(c.env.DB,`UPDATE erp_reconciliation_cases SET status='RESOLVED',resolution_code=?,resolution_notes=?,resolved_by=?,resolved_at=datetime('now') WHERE id=?`,[b.resolutionCode||'VERIFIED',b.resolutionNotes||'',c.get('erpUser').email,id]);
  if(b.clearActualSerial && before.actual_serial)await run(c.env.DB,`UPDATE erp_assets SET reconciliation_status='CLEAR',current_status=CASE WHEN current_status='QUARANTINE' THEN 'AVAILABLE' ELSE current_status END,updated_at=datetime('now') WHERE serial_no=?`,[before.actual_serial]);
  const after=await first(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE id=?`,[id]);
  await audit(c,{action:'RESOLVE_RECONCILIATION',module:'RETURNS',recordType:'RECONCILIATION',recordId:id,recordNo:after.case_no,before,after});
  return ok(c,{case:after});
});


/* ===================================================================
 * Draft goods returns stay editable and can be voided.
 * Once posted the stock has already moved, so only Finance may reverse it
 * and that is done through a new return, never by editing history.
 * =================================================================== */
returnRoutes.patch('/:id', requirePermission('RETURNS','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const header = await first(c.env.DB, `SELECT * FROM erp_return_orders WHERE id=?`, [id]);
  if (!header) return fail(c, 'Goods return not found', 404);
  const role = String(c.get('erpUser').role_code || '').toUpperCase();
  if (header.status !== 'DRAFT' && role !== 'FINANCE') {
    return fail(c, 'Only a draft return can be edited. Finance can override.', 409);
  }
  let location = null;
  if (normalizeText(b.returnLocationCode)) {
    location = await ensureLocation(c.env.DB, normalizeText(b.returnLocationName || b.returnLocationCode),
      normalizeText(b.returnLocationType) || 'WAREHOUSE', normalizeText(b.returnLocationCode));
  }
  await run(c.env.DB, `UPDATE erp_return_orders SET
      return_date=COALESCE(NULLIF(?,''),return_date),
      return_location_id=COALESCE(?,return_location_id),
      reason_code=COALESCE(NULLIF(?,''),reason_code),
      notes=COALESCE(NULLIF(?,''),notes)
    WHERE id=?`,
    [normalizeText(b.returnDate), location?.id || null,
     normalizeText(b.reasonCode), normalizeText(b.notes), id]);

  // Line-level condition corrections while the return is still a draft.
  const lines = Array.isArray(b.lines) ? b.lines : [];
  for (const line of lines) {
    if (!line || !line.id) continue;
    await run(c.env.DB, `UPDATE erp_return_lines SET
        condition_code=COALESCE(NULLIF(?,''),condition_code),
        actual_serial=COALESCE(NULLIF(?,''),actual_serial),
        notes=COALESCE(NULLIF(?,''),notes)
      WHERE id=? AND return_id=?`,
      [normalizeText(line.conditionCode), normalizeSerial(line.actualSerialNo || ''), normalizeText(line.notes), Number(line.id), id]);
  }
  const after = await first(c.env.DB, `SELECT * FROM erp_return_orders WHERE id=?`, [id]);
  await audit(c, { action: 'EDIT', module: 'RETURNS', recordType: 'GOODS_RETURN', recordId: id, recordNo: header.return_no, before: header, after });
  return ok(c, { goodsReturn: after });
});

returnRoutes.post('/:id/void', requirePermission('RETURNS','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const header = await first(c.env.DB, `SELECT * FROM erp_return_orders WHERE id=?`, [id]);
  if (!header) return fail(c, 'Goods return not found', 404);
  if (header.status !== 'DRAFT') {
    return fail(c, 'Only a draft return can be voided. A posted return has already moved stock; raise a correcting document instead.', 409);
  }
  await run(c.env.DB, `UPDATE erp_return_orders SET status='VOIDED',notes=COALESCE(notes,'')||' | Voided: '||? WHERE id=?`,
    [normalizeText(b.reason) || 'no reason given', id]);
  await audit(c, { action: 'VOID', module: 'RETURNS', recordType: 'GOODS_RETURN', recordId: id, recordNo: header.return_no, before: header, after: { status: 'VOIDED', reason: b.reason } });
  return ok(c, { status: 'VOIDED' });
});

returnRoutes.get('/:id/detail', requirePermission('RETURNS','VIEW'), async c => {
  const id = Number(c.req.param('id'));
  const header = await first(c.env.DB, `SELECT * FROM erp_return_orders WHERE id=?`, [id]);
  if (!header) return fail(c, 'Goods return not found', 404);
  const lines = await all(c.env.DB, `SELECT * FROM erp_return_lines WHERE return_id=? ORDER BY id`, [id]);
  return ok(c, { header, lines });
});
