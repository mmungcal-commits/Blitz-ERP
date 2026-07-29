import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensureLocation, nextCode, normalizeSerial } from '../lib/codes.js';
import { createAssetFromReceipt } from '../lib/inventory.js';

export const receivingRoutes = new Hono();

receivingRoutes.get('/', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c);
  const rows=await all(c.env.DB,
    `SELECT r.*,s.shipment_no,s.batch_code,l.code location_code,l.name location_name,
      (SELECT COUNT(*) FROM erp_receipt_lines x WHERE x.receipt_id=r.id) line_count,
      (SELECT COUNT(*) FROM erp_receipt_lines x WHERE x.receipt_id=r.id AND x.acceptance_status!='MATCHED') exception_count
     FROM erp_receipts r JOIN erp_shipments s ON s.id=r.shipment_id LEFT JOIN erp_locations l ON l.id=r.location_id
     ORDER BY r.received_at DESC LIMIT ? OFFSET ?`,[size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_receipts`);
  return ok(c,{rows,page,size,total:total?.n||0});
});

receivingRoutes.post('/', requirePermission('RECEIVING','POST'), async(c)=>{
  const b=await jsonBody(c);
  if(!b.shipmentId)return fail(c,'Shipment is required');
  const serials=(Array.isArray(b.serials)?b.serials:[]).map(x=>typeof x==='string'?{serialNo:x}:x).map(x=>({...x,serialNo:normalizeSerial(x.serialNo)})).filter(x=>x.serialNo);
  if(!serials.length)return fail(c,'Scan or enter at least one serial number');
  const shipment=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[Number(b.shipmentId)]);
  if(!shipment)return fail(c,'Shipment not found',404);
  if(['CLOSED','CANCELLED'].includes(shipment.status))return fail(c,`Shipment is ${shipment.status}`);
  const location=await ensureLocation(c.env.DB,b.locationName||'E88 Asgard Warehouse',b.locationType||'WAREHOUSE',b.locationCode||'');
  const receiptNo=await nextCode(c.env.DB,'RECEIPT','RCV',6);
  const rr=await run(c.env.DB,
    `INSERT INTO erp_receipts(receipt_no,shipment_id,location_id,received_at,receiving_status,document_ref,document_url,notes,received_by)
     VALUES(?,?,?,?, 'POSTED',?,?,?,?)`,
    [receiptNo,shipment.id,location.id,b.receivedAt||new Date().toISOString(),b.documentRef||'',b.documentUrl||'',b.notes||'',c.get('erpUser').email]);
  const receiptId=rr.meta.last_row_id;
  const results=[];

  for(const input of serials){
    const expected=await first(c.env.DB,`SELECT e.*,l.unit_cost,i.item_name,i.category FROM erp_expected_assets e
      LEFT JOIN erp_shipment_lines l ON l.id=e.shipment_line_id LEFT JOIN erp_items i ON i.id=e.item_id
      WHERE e.shipment_id=? AND e.serial_no=?`,[shipment.id,input.serialNo]);
    const existing=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[input.serialNo]);
    let acceptance='MATCHED',message='';
    if(existing){acceptance='DUPLICATE';message=`Already registered as ${existing.asset_no}`;}
    else if(!expected){acceptance='UNPLANNED';message='Serial is not listed in the ATLAS manifest for this shipment';}

    const lineResult=await run(c.env.DB,
      `INSERT INTO erp_receipt_lines(receipt_id,shipment_line_id,expected_asset_id,serial_no,item_id,item_code,qty,condition_code,acceptance_status,exception_message,source_method,qr_payload)
       VALUES(?,?,?,?,?,?,1,?,?,?,?,?)`,
      [receiptId,expected?.shipment_line_id||input.shipmentLineId||null,expected?.id||null,input.serialNo,expected?.item_id||input.itemId||null,expected?.item_code||input.itemCode||'',input.conditionCode||'GOOD',acceptance,message,input.sourceMethod||'QR',input.qrPayload||input.serialNo]);

    let asset=null;
    if(!existing){
      const created=await createAssetFromReceipt(c.env.DB,{
        serialNo:input.serialNo,serialType:expected?.serial_type||input.serialType||'OTHER',itemId:expected?.item_id||input.itemId,
        itemCode:expected?.item_code||input.itemCode,itemName:expected?.item_name||input.itemName||'Unplanned received item',category:expected?.category||input.category||'OTH',
        secondarySerial:expected?.secondary_serial||input.secondarySerial,motorNo:input.motorNo,batchCode:shipment.batch_code,shipmentId:shipment.id,receiptId,
        locationId:location.id,locationCode:location.code,status:acceptance==='MATCHED'?'AVAILABLE':'QUARANTINE',unitCost:expected?.unit_cost||input.unitCost,
        conditionCode:input.conditionCode||'GOOD',reconciliationStatus:acceptance==='MATCHED'?'CLEAR':'UNRECONCILED',sourceSystem:'RECEIVING',sourceKey:`${receiptNo}:${input.serialNo}`
      });
      asset=created.asset;
      await run(c.env.DB,
        `INSERT INTO erp_stock_ledger(movement_no,movement_date,movement_type,asset_id,serial_no,item_id,item_code,qty,to_location_id,to_location_code,to_status,source_doc_type,source_doc_id,source_doc_no,reason_code,notes,posted_by)
         VALUES(?,?,?,?,?,?,?,1,?,?,?,'RECEIPT',?,?,?, ?,?)`,
        [await nextCode(c.env.DB,'MOVEMENT','MV',8),b.receivedAt||new Date().toISOString(),acceptance==='MATCHED'?'RECEIPT':'RECEIPT_EXCEPTION',asset.id,input.serialNo,expected?.item_id||input.itemId||null,expected?.item_code||input.itemCode||'',location.id,location.code,acceptance==='MATCHED'?'AVAILABLE':'QUARANTINE',receiptId,receiptNo,acceptance,message,c.get('erpUser').email]);
      if(expected){
        await run(c.env.DB,`UPDATE erp_expected_assets SET expected_status='RECEIVED' WHERE id=?`,[expected.id]);
        await run(c.env.DB,`UPDATE erp_shipment_lines SET received_qty=received_qty+1,status=CASE WHEN received_qty+1>=expected_qty THEN 'RECEIVED' ELSE 'PARTIAL' END WHERE id=?`,[expected.shipment_line_id]);
      }
      if(acceptance!=='MATCHED'){
        const exNo=await nextCode(c.env.DB,'EXCEPTION','EXC',6);
        await run(c.env.DB,`INSERT INTO erp_serial_exceptions(exception_no,serial_no,exception_type,source_system,source_sheet,source_row,canonical_asset_id,payload_json) VALUES(?,?,?,'RECEIVING','',NULL,?,?)`,[exNo,input.serialNo,acceptance,asset.id,JSON.stringify({shipmentNo:shipment.shipment_no,receiptNo,input,message})]);
      }
    }
    results.push({serialNo:input.serialNo,acceptance,message,assetId:asset?.id||existing?.id,receiptLineId:lineResult.meta.last_row_id});
  }

  const remaining=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_expected_assets WHERE shipment_id=? AND expected_status!='RECEIVED'`,[shipment.id]);
  const status=(remaining?.n||0)===0?'RECEIVED':'PARTIALLY_RECEIVED';
  await run(c.env.DB,`UPDATE erp_shipments SET status=?,warehouse_arrival=COALESCE(warehouse_arrival,?),updated_at=datetime('now') WHERE id=?`,[status,b.receivedAt||new Date().toISOString(),shipment.id]);
  await audit(c,{action:'POST_RECEIPT',module:'RECEIVING',recordType:'RECEIPT',recordId:receiptId,recordNo:receiptNo,after:{shipmentNo:shipment.shipment_no,results}});
  return ok(c,{receiptId,receiptNo,shipmentStatus:status,results,summary:{received:results.length,matched:results.filter(x=>x.acceptance==='MATCHED').length,exceptions:results.filter(x=>x.acceptance!=='MATCHED').length}},201);
});

receivingRoutes.get('/:id', requirePermission('RECEIVING','VIEW'), async(c)=>{
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT r.*,s.shipment_no,s.batch_code,l.code location_code,l.name location_name FROM erp_receipts r JOIN erp_shipments s ON s.id=r.shipment_id LEFT JOIN erp_locations l ON l.id=r.location_id WHERE r.id=?`,[id]);
  if(!header)return fail(c,'Receipt not found',404);
  const lines=await all(c.env.DB,`SELECT rl.*,a.asset_no,a.current_status,a.reconciliation_status FROM erp_receipt_lines rl LEFT JOIN erp_assets a ON a.serial_no=rl.serial_no WHERE rl.receipt_id=? ORDER BY rl.id`,[id]);
  return ok(c,{header,lines});
});
