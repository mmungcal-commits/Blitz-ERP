import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { postMovement } from '../lib/inventory.js';
import { nextCode, normalizeText } from '../lib/codes.js';
import { captureFinanceEvent, registerPendingFixedAsset, entityByCode, ensureAccountingPeriod } from '../lib/finance.js';
import { classifyInventoryTreatment, cogsAccountForCategory, fixedAssetAccountsForCategory, inventoryAccountForCategory,
  normalizeTransactionPurpose, treatmentRequiresValuation, isDurableCategory } from '../lib/transaction-rules.js';

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
    // Pre-release is required on everything that leaves, not only motorcycles.
    // A battery or a charger going out unchecked is the same exposure.
    if(!check||check.result!=='PASSED')return fail(c,`Serial ${asset.serial_no} requires a passed pre-release checklist`,409);
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
  const id=Number(c.req.param('id'));const b=await jsonBody(c);const user=c.get('erpUser').email;
  const header=await first(c.env.DB,`SELECT d.*,s.transaction_type,s.customer_id,s.gross_amount,s.sales_order_no,
    p.name customer_name,a.assignment_type,a.partner_id assignment_partner_id,a.holder_name assignment_holder_name,
    a.expected_return_date,rc.request_type requisition_request_type,rc.holder_type requisition_holder_type,
    rc.holder_name requisition_holder_name,rc.expected_return_date requisition_return_date
    FROM erp_deliveries d
    LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id
    LEFT JOIN erp_partners p ON p.id=s.customer_id
    LEFT JOIN erp_assignments a ON a.id=d.assignment_id
    LEFT JOIN erp_requisition_context rc ON rc.requisition_id=d.requisition_id
    WHERE d.id=?`,[id]);
  if(!header)return fail(c,'Delivery not found',404);
  if(header.status!=='RELEASED')return fail(c,'Only released deliveries can be completed',409);
  const assets=await all(c.env.DB,`SELECT da.*,a.category,a.unit_cost,a.item_id,a.item_code asset_item_code,
    a.item_name,a.serial_no asset_serial_no,a.current_status,a.capitalization_status
    FROM erp_delivery_assets da JOIN erp_assets a ON a.id=da.asset_id
    WHERE da.delivery_id=? ORDER BY da.id`,[id]);
  const quantityLines=await all(c.env.DB,`SELECT da.*,i.id item_id,i.item_name,i.category,i.serialized,i.standard_cost
    FROM erp_delivery_assets da LEFT JOIN erp_items i ON i.item_code=da.item_code
    WHERE da.delivery_id=? AND da.asset_id IS NULL ORDER BY da.id`,[id]);
  const purpose=normalizeTransactionPurpose(b.purpose||header.transaction_type||header.requisition_request_type||header.assignment_type);
  const holderId=header.assignment_partner_id||header.customer_id||null;
  const holderName=header.requisition_holder_name||header.assignment_holder_name||header.customer_name||header.recipient_name;
  const defaultHolderType=header.requisition_holder_type||null;
  const assetTreatments=assets.map(asset=>({asset,treatment:classifyInventoryTreatment({
    purpose,category:asset.category,serialized:true,override:b.financialTreatment,
  })}));
  const quantityTreatments=quantityLines.map(line=>({line,treatment:classifyInventoryTreatment({
    purpose,category:line.category,serialized:false,override:b.financialTreatment,
  })}));

  const durableQuantity=quantityTreatments.find(({line})=>isDurableCategory(line.category)&&Number(line.serialized||0)===1);
  if(durableQuantity)return fail(c,`${durableQuantity.line.item_code} is serialized and cannot be completed as an unassigned quantity. Allocate the exact serial number first.`,409);
  const missing=[];
  for(const {asset,treatment} of assetTreatments){
    if(treatmentRequiresValuation(treatment)&&Number(asset.unit_cost||0)<=0){
      missing.push(asset.serial_no||asset.asset_serial_no);
      await run(c.env.DB,`INSERT OR IGNORE INTO erp_inventory_valuation_exceptions(
        asset_id,item_id,serial_no,item_code,exception_type,source_document_type,source_document_id,
        source_document_no,exception_message,requested_by)
        VALUES(?,?,?,?, 'MISSING_UNIT_COST','DELIVERY',?,?,?,?)`,[
        asset.asset_id,asset.item_id,asset.serial_no||asset.asset_serial_no,asset.asset_item_code||asset.item_code,
        id,header.delivery_no,`Financial ${treatment.financeEventType} is blocked until an approved cost is assigned.`,user,
      ]);
    }
  }
  for(const {line,treatment} of quantityTreatments){
    if(treatmentRequiresValuation(treatment)&&Number(line.standard_cost||0)<=0){
      missing.push(line.item_code||line.item_name);
      await run(c.env.DB,`INSERT INTO erp_inventory_valuation_exceptions(
        item_id,item_code,exception_type,source_document_type,source_document_id,source_document_no,
        exception_message,requested_by)
        SELECT ?,?,'MISSING_STANDARD_COST','DELIVERY',?,?,?,?
        WHERE NOT EXISTS(SELECT 1 FROM erp_inventory_valuation_exceptions
          WHERE item_id=? AND exception_type='MISSING_STANDARD_COST' AND status='OPEN')`,[
        line.item_id,line.item_code,id,header.delivery_no,
        `Financial ${treatment.financeEventType} is blocked until an approved standard cost is assigned.`,user,line.item_id,
      ]);
    }
  }
  if(missing.length)return fail(c,`Delivery is operationally ready but Finance posting is blocked for ${missing.length} unvalued item(s): ${missing.slice(0,5).join(', ')}. Resolve the Inventory Valuation worklist first.`,409);

  const eventDate=(b.deliveryDate||new Date().toISOString()).slice(0,10);
  const hasFinancialImpact=purpose==='SALE'||assetTreatments.some(x=>!!x.treatment.financeEventType)||
    quantityTreatments.some(x=>!!x.treatment.financeEventType);
  if(hasFinancialImpact){
    const entity=await entityByCode(c.env.DB,b.entityCode||'E88');
    if(!entity)return fail(c,'Accounting entity E88 is not configured.',409);
    const period=await ensureAccountingPeriod(c.env.DB,entity.id,eventDate);
    if(period.status==='CLOSED')return fail(c,`Accounting period ${period.period_name} is closed. Reopen it or use an approved delivery date.`,409);
  }
  for(const {asset,treatment} of assetTreatments){
    const holderType=defaultHolderType||treatment.holderType;
    try{
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no||asset.asset_serial_no,movementType:'DELIVERED',movementDate:b.deliveryDate||new Date().toISOString(),
        toLocationId:null,toLocationCode:normalizeText(header.destination),toStatus:treatment.targetStatus,
        holderType,holderId,holderName,sourceDocType:'DELIVERY',sourceDocId:id,sourceDocNo:header.delivery_no,
        reasonCode:purpose,notes:normalizeText(b.notes),
      },user);
    }catch(e){return fail(c,e.message,409);}
    await run(c.env.DB,`UPDATE erp_delivery_assets SET financial_treatment=?,return_required=? WHERE id=?`,[
      treatment.inventoryEffect,treatment.returnRequired?1:0,asset.id,
    ]);
    if(treatment.returnRequired){
      const obligationNo=await nextCode(c.env.DB,'RETURN_OBLIGATION','ROB',8);
      await run(c.env.DB,`INSERT OR IGNORE INTO erp_return_obligations(
        obligation_no,source_delivery_id,source_delivery_no,assignment_id,issued_asset_id,issued_serial_no,
        purpose_code,holder_type,holder_id,holder_name,due_date,created_by,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        obligationNo,id,header.delivery_no,header.assignment_id||null,asset.asset_id,asset.serial_no||asset.asset_serial_no,
        purpose,holderType,holderId,holderName,header.requisition_return_date||header.expected_return_date||'',user,
        normalizeText(b.notes),
      ]);
    }
  }

  await run(c.env.DB,`UPDATE erp_deliveries SET status='DELIVERED',actual_delivery_date=?,
    proof_document_url=COALESCE(?,proof_document_url) WHERE id=?`,[
    b.deliveryDate||new Date().toISOString(),b.proofDocumentUrl||null,id,
  ]);
  if(header.sales_order_id)await run(c.env.DB,`UPDATE erp_sales_orders SET status='POSTED',posted_by=?,posted_at=datetime('now') WHERE id=?`,[user,header.sales_order_id]);
  if(header.assignment_id)await run(c.env.DB,`UPDATE erp_assignments SET status='ACTIVE' WHERE id=?`,[header.assignment_id]);
  if(header.requisition_id){
    await run(c.env.DB,`UPDATE erp_requisitions SET status='FULFILLED' WHERE id=?`,[header.requisition_id]);
    await run(c.env.DB,`UPDATE erp_requisition_allocations SET allocation_status='DEPLOYED' WHERE requisition_id=?`,[header.requisition_id]);
  }

  if(purpose==='SALE'){
    const gross=Number(header.gross_amount||0);const net=Math.round((gross/1.12)*100)/100;const tax=Math.round((gross-net)*100)/100;
    await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_REVENUE:${id}`,eventType:'CUSTOMER_INVOICE',sourceModule:'SALES',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,
      partnerId:header.customer_id,amount:gross,taxAmount:tax,businessLine:'SALE',
      description:`Delivered sale ${header.sales_order_no||header.delivery_no}`,
      payload:{grossAmount:gross,netAmount:net,taxAmount:tax,businessLine:'SALE'},
    },user);
  }

  let financeEvents=0;let custodyEvents=0;let pendingFixedAssets=0;
  for(const {asset,treatment} of assetTreatments){
    const cost=Number(asset.unit_cost||0)*Number(asset.qty||1);
    if(!treatment.financeEventType){custodyEvents+=1;continue;}
    const fa=fixedAssetAccountsForCategory(asset.category);
    const event=await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_${treatment.financeEventType}:${id}:${asset.asset_id}`,
      eventType:treatment.financeEventType,sourceModule:treatment.financeEventType==='CAPITALIZATION'?'FIXED_ASSETS':'INVENTORY',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,
      partnerId:holderId,amount:cost,businessLine:treatment.businessLine,
      description:`${treatment.financeEventType} ${asset.serial_no||asset.asset_serial_no} from ${header.delivery_no}`,
      payload:{costAmount:cost,category:asset.category,assetId:asset.asset_id,itemId:asset.item_id,
        serialNo:asset.serial_no||asset.asset_serial_no,inventoryAccountCode:inventoryAccountForCategory(asset.category),cogsAccountCode:cogsAccountForCategory(asset.category),
        expenseAccountCode:treatment.expenseAccountCode,assetAccountCode:fa.assetAccountCode,businessLine:treatment.businessLine},
    },user);
    financeEvents+=1;
    await run(c.env.DB,`UPDATE erp_delivery_assets SET finance_event_id=? WHERE id=?`,[event.id,asset.id]);
    if(treatment.financeEventType==='CAPITALIZATION'){
      await registerPendingFixedAsset(c.env.DB,{
        assetId:asset.asset_id,entityCode:b.entityCode||'E88',assetClass:fa.assetClass,
        capitalizationDate:eventDate,acquisitionCost:cost,usefulLifeMonths:fa.usefulLifeMonths,
        assetAccountCode:fa.assetAccountCode,accumulatedDepreciationAccountCode:fa.accumulatedDepreciationAccountCode,
        depreciationExpenseAccountCode:fa.depreciationExpenseAccountCode,capitalizationEventId:event.id,
        capitalizationJournalId:event.journal_id,sourceDeliveryId:id,
      },user);
      pendingFixedAssets+=1;
    }
  }
  for(const {line,treatment} of quantityTreatments){
    if(!treatment.financeEventType){custodyEvents+=1;continue;}
    const cost=Number(line.standard_cost||0)*Number(line.qty||0);
    const event=await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_${treatment.financeEventType}:${id}:LINE:${line.id}`,
      eventType:treatment.financeEventType,sourceModule:'INVENTORY',sourceType:'DELIVERY',sourceId:id,
      sourceNo:header.delivery_no,eventDate,partnerId:holderId,amount:cost,businessLine:treatment.businessLine,
      description:`${treatment.financeEventType} ${line.item_code} x ${line.qty} from ${header.delivery_no}`,
      payload:{costAmount:cost,category:line.category,itemId:line.item_id,
        inventoryAccountCode:inventoryAccountForCategory(line.category),cogsAccountCode:cogsAccountForCategory(line.category),expenseAccountCode:treatment.expenseAccountCode,
        businessLine:treatment.businessLine},
    },user);
    financeEvents+=1;
    await run(c.env.DB,`UPDATE erp_delivery_assets SET financial_treatment=?,return_required=?,finance_event_id=? WHERE id=?`,[
      treatment.inventoryEffect,treatment.returnRequired?1:0,event.id,line.id,
    ]);
  }
  if(!financeEvents){
    await captureFinanceEvent(c.env.DB,{
      eventKey:`DELIVERY_CUSTODY:${id}`,eventType:'INVENTORY_CUSTODY',sourceModule:'INVENTORY',
      sourceType:'DELIVERY',sourceId:id,sourceNo:header.delivery_no,eventDate,partnerId:holderId,
      amount:assetTreatments.reduce((sum,{asset})=>sum+Number(asset.unit_cost||0),0),
      businessLine:purpose,financialEffect:'NONE',description:`Custody movement ${header.delivery_no} - no immediate accounting effect`,
    },user);
  }
  await audit(c,{action:'COMPLETE',module:'DELIVERIES',recordType:'DELIVERY',recordId:id,recordNo:header.delivery_no,
    after:{status:'DELIVERED',purpose,holderName,financeEvents,custodyEvents,pendingFixedAssets}});
  return ok(c,{delivered:assets.length,quantityLines:quantityLines.length,purpose,holderName,
    financeEvents,custodyEvents,pendingFixedAssets});
});
