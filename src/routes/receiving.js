import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensureItem, nextCode, normalizeText } from '../lib/codes.js';
import { createAssetFromReceipt } from '../lib/inventory.js';
import { classifyReceivingLines, getReceivingWorkbench, receivingAssetControl } from '../lib/receiving.js';
import { captureFinanceEvent } from '../lib/finance.js';

export const receivingRoutes = new Hono();

receivingRoutes.get('/', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c);
  const rows=await all(c.env.DB,
    `SELECT r.*,s.shipment_no,s.batch_code,s.supplier_name,l.code location_code,l.name location_name,
      (SELECT COUNT(*) FROM erp_receipt_lines x WHERE x.receipt_id=r.id) line_count,
      (SELECT COUNT(*) FROM erp_receipt_lines x WHERE x.receipt_id=r.id AND x.acceptance_status!='MATCHED') exception_count
     FROM erp_receipts r JOIN erp_shipments s ON s.id=r.shipment_id LEFT JOIN erp_locations l ON l.id=r.location_id
     ORDER BY r.received_at DESC LIMIT ? OFFSET ?`,[size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_receipts`);
  return ok(c,{rows,page,size,total:total?.n||0});
});

receivingRoutes.get('/open-shipments', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT v.*,s.purchase_order_ref,s.eta
    FROM vw_erp_shipment_receiving_summary v
    JOIN erp_shipments s ON s.id=v.shipment_id
    WHERE v.status NOT IN ('CLOSED','CANCELLED')
      AND (v.remaining_qty>0 OR v.open_variances>0 OR v.status IN ('MANIFESTED','IN_TRANSIT','ARRIVED','RECEIVING','PARTIALLY_RECEIVED','RECEIVED_WITH_EXCEPTIONS'))
    ORDER BY COALESCE(s.eta,'9999-12-31'),v.shipment_no`);
  return ok(c,{rows});
});

receivingRoutes.get('/shipment/:id', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const data=await getReceivingWorkbench(c.env.DB,Number(c.req.param('id')));
  if(!data)return fail(c,'Shipment not found',404);
  return ok(c,data);
});

receivingRoutes.get('/reports/reconciliation', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const status=String(c.req.query('status')||'').trim().toUpperCase();
  const args=[]; const where=[];
  if(status){where.push('reconciliation_status=?');args.push(status);}
  const rows=await all(c.env.DB,`
    SELECT * FROM vw_erp_inbound_shipment_report
    ${where.length?`WHERE ${where.join(' AND ')}`:''}
    ORDER BY COALESCE(eta,expected_delivery_date,order_date) DESC,shipment_no DESC`,args);
  const totals=rows.reduce((out,row)=>{
    out.shipments+=1;
    out.expected+=Number(row.expected_qty||0);
    out.received+=Number(row.received_qty||0);
    out.openVariances+=Number(row.open_variances||0);
    if(row.reconciliation_status==='MATCHED')out.matched+=1;
    else out.withDiscrepancies+=1;
    return out;
  },{shipments:0,expected:0,received:0,openVariances:0,matched:0,withDiscrepancies:0});
  return ok(c,{rows,totals});
});

receivingRoutes.get('/reports/discrepancies', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const status=String(c.req.query('status')||'OPEN').trim().toUpperCase();
  const rows=await all(c.env.DB,`
    SELECT * FROM vw_erp_inbound_serial_discrepancies
    WHERE (?='' OR status=?)
    ORDER BY created_at DESC,variance_no DESC`,[status,status]);
  return ok(c,{rows,total:rows.length});
});

/*
 * A receiving discrepancy is a money question, so Finance clears it and the
 * department head acknowledges - two people, in that order. Anyone with
 * generic receiving rights used to be able to close it on their own.
 */
const FINANCE_ROLES=['FINANCE','FINANCE_MANAGER','CONTROLLER','ACCOUNTING'];
const DEPT_HEAD_ROLES=['DEPTHEAD','DEPT_HEAD','DEPARTMENT_HEAD','DEPT_MANAGER',
  'DEPARTMENT_MANAGER','SCM_HEAD','SCM_MANAGER'];

receivingRoutes.post('/variances/:id/resolve', requirePermission('RECEIVING','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const b=await jsonBody(c);
  const user=c.get('erpUser');
  const role=String(user.role_code||user.role||'').toUpperCase();
  if(!FINANCE_ROLES.includes(role))
    return fail(c,'Only Finance can clear a receiving discrepancy.',403);
  const before=await first(c.env.DB,`SELECT * FROM erp_receiving_variances WHERE id=?`,[id]);
  if(!before)return fail(c,'Receiving variance not found',404);
  if(before.status!=='OPEN')return fail(c,'Only an open discrepancy can be resolved',409);
  if(!String(b.resolution||'').trim())return fail(c,'Resolution is required');
  await run(c.env.DB,`
    UPDATE erp_receiving_variances
    SET status='RESOLVED',resolution=?,approved_by=?,approved_at=datetime('now')
    WHERE id=?`,[String(b.resolution).trim(),user.email,id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_receiving_variances WHERE id=?`,[id]);
  await audit(c,{action:'RESOLVE_VARIANCE',module:'RECEIVING',recordType:'RECEIVING_VARIANCE',
    recordId:id,recordNo:after.variance_no,before,after});
  return ok(c,{variance:after,awaitingAcknowledgement:true});
});

// The department head signs off on what Finance decided. Until this happens the
// discrepancy is resolved but not closed, so it still shows on the register.
receivingRoutes.post('/variances/:id/acknowledge', requirePermission('RECEIVING','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const b=await jsonBody(c).catch(()=>({}));
  const user=c.get('erpUser');
  const role=String(user.role_code||user.role||'').toUpperCase();
  if(!DEPT_HEAD_ROLES.includes(role))
    return fail(c,'Only a department head can acknowledge a resolved discrepancy.',403);
  const before=await first(c.env.DB,`SELECT * FROM erp_receiving_variances WHERE id=?`,[id]);
  if(!before)return fail(c,'Receiving variance not found',404);
  if(before.status!=='RESOLVED')
    return fail(c,'Finance must clear this discrepancy before it can be acknowledged.',409);
  if(String(before.approved_by||'').toLowerCase()===String(user.email).toLowerCase())
    return fail(c,'The person who cleared a discrepancy cannot also acknowledge it.',409);
  await run(c.env.DB,`INSERT OR REPLACE INTO erp_receiving_variance_acks(variance_id,acknowledged_by,acknowledged_at,note)
    VALUES(?,?,datetime('now'),?)`,[id,user.email,String(b.note||'').trim()]);
  await run(c.env.DB,`UPDATE erp_receiving_variances SET status='CLOSED' WHERE id=?`,[id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_receiving_variances WHERE id=?`,[id]);
  await audit(c,{action:'ACKNOWLEDGE_VARIANCE',module:'RECEIVING',recordType:'RECEIVING_VARIANCE',
    recordId:id,recordNo:after.variance_no,before,after});
  return ok(c,{variance:after});
});

receivingRoutes.post('/validate', requirePermission('RECEIVING','CREATE'), async(c)=>{
  const b=await jsonBody(c);
  const shipment=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[Number(b.shipmentId)]);
  if(!shipment)return fail(c,'Shipment not found',404);
  if(['CLOSED','CANCELLED'].includes(shipment.status))return fail(c,`Shipment is ${shipment.status}`);
  const lines=Array.isArray(b.lines)?b.lines:(Array.isArray(b.serials)?b.serials.map(x=>typeof x==='string'?{actualSerialNo:x}:x):[]);
  if(!lines.length)return fail(c,'Add at least one actual receiving line.');
  const results=await classifyReceivingLines(c.env.DB,shipment,lines);
  return ok(c,{shipment,results,summary:summarize(results)});
});

function summarize(results){
  return {
    total:results.length,
    matched:results.filter(x=>x.acceptance==='MATCHED').length,
    substituted:results.filter(x=>x.acceptance==='SERIAL_SUBSTITUTED').length,
    unplanned:results.filter(x=>x.acceptance==='UNPLANNED_SERIAL').length,
    over:results.filter(x=>x.acceptance==='OVER_RECEIPT').length,
    duplicates:results.filter(x=>String(x.acceptance).includes('DUPLICATE')||x.acceptance==='EXPECTED_ALREADY_CLOSED').length,
    exceptions:results.filter(x=>x.acceptance!=='MATCHED').length,
  };
}

receivingRoutes.post('/', requirePermission('RECEIVING','POST'), async(c)=>{
  const b=await jsonBody(c);
  if(!b.shipmentId)return fail(c,'Shipment is required');
  const shipment=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[Number(b.shipmentId)]);
  if(!shipment)return fail(c,'Shipment not found',404);
  if(['CLOSED','CANCELLED'].includes(shipment.status))return fail(c,`Shipment is ${shipment.status}`);

  const rawLines=Array.isArray(b.lines)?b.lines:(Array.isArray(b.serials)?b.serials.map(x=>typeof x==='string'?{actualSerialNo:x}:x):[]);
  if(!rawLines.length)return fail(c,'Add at least one actual receiving line.');
  const classified=await classifyReceivingLines(c.env.DB,shipment,rawLines);
  if(classified.some(x=>x.acceptance==='INVALID'))return fail(c,'One or more actual serials are blank or invalid.');

  if(!b.locationId)return fail(c,'Select the warehouse or retail receiving location.');
  const location=await first(c.env.DB,`
    SELECT * FROM erp_locations WHERE id=? AND active=1`,[Number(b.locationId)]);
  if(!location)return fail(c,'The selected receiving location is not active.',409);
  const receiptNo=await nextCode(c.env.DB,'RECEIPT','RCV',6);
  const user=c.get('erpUser').email;
  const receivedAt=b.receivedAt||new Date().toISOString();
  const rr=await run(c.env.DB,
    `INSERT INTO erp_receipts(receipt_no,shipment_id,location_id,received_at,receiving_status,document_ref,document_url,notes,received_by,posted_by,posted_at)
     VALUES(?,?,?,?, 'POSTED',?,?,?,?,?,datetime('now'))`,
    [receiptNo,shipment.id,location.id,receivedAt,b.documentRef||'',b.documentUrl||'',b.notes||'',user,user]);
  const receiptId=rr.meta.last_row_id;
  const results=[];

  for(const row of classified){
    let actualItemId=row.actualItemId;
    let actualItemCode=row.actualItemCode;
    let actualItemName=row.expectedItemName||row.itemName||'Received item';
    let category=row.category||'OTH';
    if(!actualItemId){
      const item=await ensureItem(c.env.DB,{
        itemCode:row.actualItemCode||row.itemCode||'',itemName:row.itemName||row.expectedItemName||`${category} Received Item`,
        category,manufacturer:row.manufacturer||'',model:row.model||'',color:row.color||'',serialized:true,
        autoCreated:true,sourceSystem:'RECEIVING',sourceKey:`${shipment.shipment_no}:${row.actualSerialNo}`
      });
      actualItemId=item.id; actualItemCode=item.item_code; actualItemName=item.item_name; category=item.category;
    } else {
      const item=await first(c.env.DB,`SELECT * FROM erp_items WHERE id=?`,[actualItemId]);
      if(item){actualItemCode=item.item_code;actualItemName=item.item_name;category=item.category;}
    }

    const lineResult=await run(c.env.DB,
      `INSERT INTO erp_receipt_lines(receipt_id,shipment_line_id,expected_asset_id,serial_no,item_id,item_code,qty,condition_code,acceptance_status,exception_message,source_method,qr_payload)
       VALUES(?,?,?,?,?,?,1,?,?,?,?,?)`,
      [receiptId,row.shipmentLineId||null,row.expectedAssetId||null,row.actualSerialNo,actualItemId,actualItemCode||'',row.conditionCode||'GOOD',row.acceptance,row.message,row.sourceMethod||'MANUAL',row.qrPayload||row.actualSerialNo]);
    const receiptLineId=lineResult.meta.last_row_id;

    let asset=null;
    if(!row.existingAsset){
      const control=receivingAssetControl(row.acceptance);
      // Value the received unit at its class landed cost (falls back to any
      // cost already supplied on the line). Drives the GOODS_RECEIPT GL posting.
      let landedUnitCost=Number(row.unitCost||0);
      if(landedUnitCost<=0){
        let modelForRate=normalizeText(row.model||'');
        if(!modelForRate && actualItemId){
          const it=await first(c.env.DB,`SELECT model FROM erp_items WHERE id=?`,[actualItemId]);
          modelForRate=normalizeText(it?.model||'');
        }
        const rate=await first(c.env.DB,
          `SELECT landed_unit_cost FROM erp_landed_cost_rates
             WHERE active=1 AND category=? AND (UPPER(COALESCE(model,''))=UPPER(?) OR model IS NULL OR model='')
             ORDER BY (CASE WHEN UPPER(COALESCE(model,''))=UPPER(?) THEN 0 ELSE 1 END) LIMIT 1`,
          [category,modelForRate,modelForRate]);
        landedUnitCost=Number(rate?.landed_unit_cost||0);
      }
      const created=await createAssetFromReceipt(c.env.DB,{
        serialNo:row.actualSerialNo,serialType:row.serialType||'OTHER',itemId:actualItemId,itemCode:actualItemCode,itemName:actualItemName,category,
        secondarySerial:row.secondarySerial,motorNo:row.motorNo,batchCode:shipment.batch_code,shipmentId:shipment.id,receiptId,
        locationId:location.id,locationCode:location.code,status:control.status,unitCost:landedUnitCost,
        conditionCode:row.conditionCode||'GOOD',reconciliationStatus:control.reconciliation,sourceSystem:'RECEIVING',sourceKey:`${receiptNo}:${row.actualSerialNo}`
      });
      asset=created.asset;
      await run(c.env.DB,
        `INSERT INTO erp_stock_ledger(movement_no,movement_date,movement_type,asset_id,serial_no,item_id,item_code,qty,to_location_id,to_location_code,to_status,source_doc_type,source_doc_id,source_doc_no,reason_code,notes,posted_by)
         VALUES(?,?,?,?,?,?,?,1,?,?,?,'RECEIPT',?,?,?,?,?)`,
        [await nextCode(c.env.DB,'MOVEMENT','MV',8),receivedAt,row.acceptance==='MATCHED'?'RECEIPT':'RECEIPT_EXCEPTION',asset.id,row.actualSerialNo,actualItemId,actualItemCode||'',location.id,location.code,control.status,receiptId,receiptNo,row.acceptance,row.message,user]);
    }

    if(row.expectedAssetId){
      const expectedStatus=row.acceptance==='MATCHED'?'RECEIVED':'SUBSTITUTED';
      await run(c.env.DB,`UPDATE erp_expected_assets SET expected_status=? WHERE id=?`,[expectedStatus,row.expectedAssetId]);
    }
    if(row.shipmentLineId && !['DUPLICATE_SERIAL','DUPLICATE_IN_RECEIPT','EXPECTED_ALREADY_CLOSED','DIFFERENT_ITEM'].includes(row.acceptance)){
      await run(c.env.DB,`
        UPDATE erp_shipment_lines SET received_qty=received_qty+1,
          status=CASE WHEN received_qty+1>expected_qty THEN 'OVER_RECEIVED' WHEN received_qty+1=expected_qty THEN 'RECEIVED' ELSE 'PARTIAL' END
        WHERE id=?`,[row.shipmentLineId]);
    }

    await run(c.env.DB,`
      INSERT INTO erp_expected_receipt_matches(shipment_id,shipment_line_id,expected_asset_id,receipt_id,receipt_line_id,expected_serial_no,actual_serial_no,expected_item_id,actual_item_id,match_status,variance_reason,matched_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [shipment.id,row.shipmentLineId||null,row.expectedAssetId||null,receiptId,receiptLineId,row.expectedSerialNo||'',row.actualSerialNo,row.expectedItemId||null,actualItemId,row.acceptance,row.message,user]);

    if(row.acceptance!=='MATCHED'){
      const varianceNo=await nextCode(c.env.DB,'RECEIVING_VARIANCE','RV',7);
      await run(c.env.DB,`
        INSERT INTO erp_receiving_variances(variance_no,shipment_id,receipt_id,receipt_line_id,variance_type,expected_serial_no,actual_serial_no,expected_item_id,actual_item_id,reason,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [varianceNo,shipment.id,receiptId,receiptLineId,row.acceptance,row.expectedSerialNo||'',row.actualSerialNo,row.expectedItemId||null,actualItemId,row.varianceReason||row.message,user]);
      const exNo=await nextCode(c.env.DB,'EXCEPTION','EXC',6);
      await run(c.env.DB,`
        INSERT INTO erp_serial_exceptions(exception_no,serial_no,exception_type,source_system,source_sheet,source_row,canonical_asset_id,payload_json)
        VALUES(?,?,?,'RECEIVING','',NULL,?,?)`,
        [exNo,row.actualSerialNo,row.acceptance,asset?.id||row.existingAsset?.id||null,JSON.stringify({shipmentNo:shipment.shipment_no,receiptNo,expectedSerialNo:row.expectedSerialNo,actualSerialNo:row.actualSerialNo,message:row.message})]);
    }

    results.push({
      expectedSerialNo:row.expectedSerialNo||'',actualSerialNo:row.actualSerialNo,acceptance:row.acceptance,message:row.message,
      assetId:asset?.id||row.existingAsset?.id||null,receiptLineId
    });
  }

  const summary=summarize(results);
  const lineTotals=await first(c.env.DB,`
    SELECT COALESCE(SUM(expected_qty),0) expected_qty,COALESCE(SUM(received_qty),0) received_qty
    FROM erp_shipment_lines WHERE shipment_id=?`,[shipment.id]);
  const openVariance=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_receiving_variances WHERE shipment_id=? AND status='OPEN'`,[shipment.id]);
  let status='PARTIALLY_RECEIVED';
  if(Number(lineTotals?.received_qty||0)>=Number(lineTotals?.expected_qty||0)) status=(openVariance?.n||0)>0?'RECEIVED_WITH_EXCEPTIONS':'RECEIVED';
  await run(c.env.DB,`UPDATE erp_shipments SET status=?,warehouse_arrival=COALESCE(warehouse_arrival,?),updated_at=datetime('now') WHERE id=?`,[status,receivedAt,shipment.id]);
  if(shipment.purchase_order_ref){
    const purchaseOrder=await first(c.env.DB,`
      SELECT * FROM erp_purchase_orders WHERE purchase_order_no=?`,[shipment.purchase_order_ref]);
    if(purchaseOrder){
      await run(c.env.DB,`
        UPDATE erp_purchase_order_lines
        SET received_qty=(
          SELECT COUNT(*)
          FROM erp_receipt_lines rl
          JOIN erp_receipts r ON r.id=rl.receipt_id
          JOIN erp_shipments s ON s.id=r.shipment_id
          WHERE s.purchase_order_ref=?
            AND rl.item_id=erp_purchase_order_lines.item_id
            AND rl.acceptance_status NOT IN ('DUPLICATE_SERIAL','DUPLICATE_IN_RECEIPT','EXPECTED_ALREADY_CLOSED','DIFFERENT_ITEM')
        ),
        status=CASE
          WHEN ordered_qty<=(
            SELECT COUNT(*)
            FROM erp_receipt_lines rl
            JOIN erp_receipts r ON r.id=rl.receipt_id
            JOIN erp_shipments s ON s.id=r.shipment_id
            WHERE s.purchase_order_ref=?
              AND rl.item_id=erp_purchase_order_lines.item_id
              AND rl.acceptance_status NOT IN ('DUPLICATE_SERIAL','DUPLICATE_IN_RECEIPT','EXPECTED_ALREADY_CLOSED','DIFFERENT_ITEM')
          ) THEN 'RECEIVED' ELSE 'OPEN' END
        WHERE purchase_order_id=?`,[shipment.purchase_order_ref,shipment.purchase_order_ref,purchaseOrder.id]);
      const poTotals=await first(c.env.DB,`
        SELECT COALESCE(SUM(ordered_qty),0) ordered_qty,COALESCE(SUM(received_qty),0) received_qty
        FROM erp_purchase_order_lines WHERE purchase_order_id=?`,[purchaseOrder.id]);
      const poStatus=Number(poTotals?.received_qty||0)>=Number(poTotals?.ordered_qty||0)?'RECEIVED':'PARTIALLY_RECEIVED';
      await run(c.env.DB,`
        UPDATE erp_purchase_orders SET status=?,updated_at=datetime('now') WHERE id=?`,
        [poStatus,purchaseOrder.id]);
    }
  }
  const receiptValues=await all(c.env.DB,`
    SELECT COALESCE(NULLIF(a.category,''),'OTH') category,COALESCE(SUM(a.unit_cost),0) amount,COUNT(*) units
    FROM erp_assets a WHERE a.receipt_id=?
    GROUP BY COALESCE(NULLIF(a.category,''),'OTH')`,[receiptId]);
  const purchaseOrder=shipment.purchase_order_ref?await first(c.env.DB,`
    SELECT * FROM erp_purchase_orders WHERE purchase_order_no=?`,[shipment.purchase_order_ref]):null;
  for(const receiptValue of receiptValues){
    const amount=Number(receiptValue.amount||0);
    if(amount<=0)continue;
    await captureFinanceEvent(c.env.DB,{
      eventKey:`RECEIPT:${receiptId}:${receiptValue.category}`,
      eventType:'GOODS_RECEIPT',
      sourceModule:'RECEIVING',
      sourceType:'RECEIPT',
      sourceId:receiptId,
      sourceNo:receiptNo,
      eventDate:receivedAt,
      partnerId:purchaseOrder?.vendor_id||null,
      amount,
      currency:purchaseOrder?.currency||'PHP',
      description:`Goods receipt ${receiptNo} · ${receiptValue.category} · ${receiptValue.units} unit(s) against ${shipment.purchase_order_ref||'unlinked PO'}`,
      payload:{netAmount:amount,category:receiptValue.category,unitCount:Number(receiptValue.units||0)},
    },user);
  }
  await audit(c,{action:'POST_RECEIPT',module:'RECEIVING',recordType:'RECEIPT',recordId:receiptId,recordNo:receiptNo,after:{shipmentNo:shipment.shipment_no,summary,results}});
  return ok(c,{receiptId,receiptNo,shipmentStatus:status,
    location:{id:location.id,code:location.code,name:location.name,type:location.location_type},
    results,summary},201);
});

receivingRoutes.get('/:id', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`SELECT r.*,s.shipment_no,s.batch_code,s.supplier_name,l.code location_code,l.name location_name FROM erp_receipts r JOIN erp_shipments s ON s.id=r.shipment_id LEFT JOIN erp_locations l ON l.id=r.location_id WHERE r.id=?`,[id]);
  if(!header)return fail(c,'Receipt not found',404);
  const lines=await all(c.env.DB,`
    SELECT rl.*,m.expected_serial_no,m.actual_serial_no,m.match_status,m.variance_reason,
      a.asset_no,a.current_status,a.reconciliation_status,i.item_name
    FROM erp_receipt_lines rl
    LEFT JOIN erp_expected_receipt_matches m ON m.receipt_line_id=rl.id
    LEFT JOIN erp_assets a ON a.serial_no=rl.serial_no
    LEFT JOIN erp_items i ON i.id=rl.item_id
    WHERE rl.receipt_id=? ORDER BY rl.id`,[id]);
  return ok(c,{header,lines});
});
