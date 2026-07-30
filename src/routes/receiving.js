import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensureItem, ensureLocation, nextCode, normalizeSerial } from '../lib/codes.js';
import { createAssetFromReceipt } from '../lib/inventory.js';
import { classifyReceivingLines, getReceivingWorkbench, receivingAssetControl } from '../lib/receiving.js';

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
    SELECT * FROM vw_erp_shipment_receiving_summary
    WHERE status NOT IN ('CLOSED','CANCELLED')
      AND (remaining_qty>0 OR open_variances>0 OR status IN ('MANIFESTED','IN_TRANSIT','ARRIVED','RECEIVING','PARTIALLY_RECEIVED','RECEIVED_WITH_EXCEPTIONS'))
    ORDER BY COALESCE((SELECT eta FROM erp_shipments x WHERE x.id=shipment_id),'9999-12-31'),shipment_no`);
  return ok(c,{rows});
});

receivingRoutes.get('/shipment/:id', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const data=await getReceivingWorkbench(c.env.DB,Number(c.req.param('id')));
  if(!data)return fail(c,'Shipment not found',404);
  return ok(c,data);
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

  const location=await ensureLocation(c.env.DB,b.locationName||'E88 Asgard Warehouse',b.locationType||'WAREHOUSE',b.locationCode||'');
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
      const created=await createAssetFromReceipt(c.env.DB,{
        serialNo:row.actualSerialNo,serialType:row.serialType||'OTHER',itemId:actualItemId,itemCode:actualItemCode,itemName:actualItemName,category,
        secondarySerial:row.secondarySerial,motorNo:row.motorNo,batchCode:shipment.batch_code,shipmentId:shipment.id,receiptId,
        locationId:location.id,locationCode:location.code,status:control.status,unitCost:row.unitCost,
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
  await audit(c,{action:'POST_RECEIPT',module:'RECEIVING',recordType:'RECEIPT',recordId:receiptId,recordNo:receiptNo,after:{shipmentNo:shipment.shipment_no,summary,results}});
  return ok(c,{receiptId,receiptNo,shipmentStatus:status,results,summary},201);
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
