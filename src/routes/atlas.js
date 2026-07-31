import { Hono } from 'hono';
import { all, first, run, batchChunks } from '../lib/db.js';
import { ok, fail } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nextCode, ensurePartner, ensureItem, ensureLocation } from '../lib/codes.js';
import { parseAtlasFile, groupAtlasRows, itemIdentity } from '../lib/atlas.js';

export const atlasRoutes = new Hono();

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

atlasRoutes.post('/preview', requirePermission('SHIPMENTS','CREATE'), async (c) => {
  const form = await c.req.raw.formData();
  const file = form.get('file');
  const purchaseOrderId = Number(form.get('purchaseOrderId'));
  if (!purchaseOrderId) return fail(c, 'Select the approved purchase order for this ATLAS expected shipment.');
  const purchaseOrder = await first(c.env.DB,
    `SELECT * FROM erp_purchase_orders WHERE id=?`, [purchaseOrderId]);
  if (!purchaseOrder) return fail(c, 'Purchase order not found.', 404);
  if (!['APPROVED','PARTIALLY_RECEIVED'].includes(purchaseOrder.status)) {
    return fail(c, `Purchase order ${purchaseOrder.purchase_order_no} must be approved before an ATLAS upload.`, 409);
  }
  if (!(file instanceof File)) return fail(c, 'Upload an ATLAS Excel file.');
  if (!/\.xlsx?$/i.test(file.name)) return fail(c, 'ATLAS upload must be an Excel .xlsx file.');

  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const duplicateBatch = await first(c.env.DB, `SELECT import_no,status FROM erp_import_batches WHERE source_hash=? AND import_type='ATLAS' ORDER BY id DESC LIMIT 1`, [hash]);
  if (duplicateBatch && duplicateBatch.status === 'POSTED') return fail(c, `This exact ATLAS file was already posted under ${duplicateBatch.import_no}.`, 409);

  const parsed = await parseAtlasFile(buffer);
  if (!parsed.rows.length) return fail(c, 'No MOTORCYCLE, BATTERY, or LOCKER serial records were found.');

  const importNo = await nextCode(c.env.DB, 'IMPORT', 'IMP', 6);
  let objectKey = '';
  if (c.env.DOCS) {
    objectKey = `imports/atlas/${new Date().toISOString().slice(0,10)}/${importNo}-${file.name}`;
    await c.env.DOCS.put(objectKey, buffer, { httpMetadata: { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  }
  const insert = await run(c.env.DB,
    `INSERT INTO erp_import_batches(import_no,import_type,source_file_name,source_hash,source_document_url,status,total_rows,valid_rows,exception_rows,created_by)
     VALUES(?,?,?,?,?,'PREVIEW',?,?,?,?)`,
    [importNo,'ATLAS',file.name,hash,objectKey,parsed.summary.total,parsed.summary.valid,parsed.summary.exceptions,c.get('erpUser').email]);
  const importId = insert.meta.last_row_id;
  await run(c.env.DB,
    `INSERT INTO erp_atlas_po_links(import_id,purchase_order_id,purchase_order_no,linked_by)
     VALUES(?,?,?,?)`,
    [importId,purchaseOrder.id,purchaseOrder.purchase_order_no,c.get('erpUser').email]);

  const statements = parsed.rows.map(row => c.env.DB.prepare(
    `INSERT INTO erp_import_rows(import_id,source_sheet,source_row,record_type,external_key,payload_json,validation_status,validation_message)
     VALUES(?,?,?,?,?,?,?,?)`)
    .bind(importId,row.sourceSheet,row.sourceRow,row.recordType,row.serialNo,JSON.stringify(row),row.validationStatus,row.validationMessage));
  await batchChunks(c.env.DB, statements, 50);

  await audit(c,{action:'ATLAS_PREVIEW',module:'SHIPMENTS',recordType:'IMPORT',recordId:importId,recordNo:importNo,
    after:{...parsed.summary,purchaseOrderNo:purchaseOrder.purchase_order_no}});
  return ok(c,{importId,importNo,fileName:file.name,
    purchaseOrder:{id:purchaseOrder.id,purchaseOrderNo:purchaseOrder.purchase_order_no,vendorName:purchaseOrder.vendor_name},
    sheets:parsed.sheets,summary:parsed.summary,
    sampleRows:parsed.rows.slice(0,20),exceptions:parsed.rows.filter(x=>x.validationStatus!=='VALID').slice(0,100)});
});

atlasRoutes.get('/:id', requirePermission('SHIPMENTS','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`
    SELECT b.*,l.purchase_order_id,l.purchase_order_no,p.vendor_name purchase_order_vendor,
      p.status purchase_order_status
    FROM erp_import_batches b
    LEFT JOIN erp_atlas_po_links l ON l.import_id=b.id
    LEFT JOIN erp_purchase_orders p ON p.id=l.purchase_order_id
    WHERE b.id=?`,[id]);
  if(!header)return fail(c,'Import batch not found',404);
  const rows=await all(c.env.DB,`SELECT id,source_sheet,source_row,record_type,external_key,validation_status,validation_message,posted_record_type,posted_record_id,payload_json FROM erp_import_rows WHERE import_id=? ORDER BY source_sheet,source_row LIMIT 2500`,[id]);
  return ok(c,{header,rows:rows.map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')}))});
});

atlasRoutes.post('/:id/commit', requirePermission('SHIPMENTS','POST'), async(c)=>{
  const importId=Number(c.req.param('id'));
  const header=await first(c.env.DB,`SELECT * FROM erp_import_batches WHERE id=?`,[importId]);
  if(!header)return fail(c,'Import batch not found',404);
  if(header.status==='POSTED')return fail(c,'ATLAS import is already posted',409);
  const poLink=await first(c.env.DB,`
    SELECT l.*,p.vendor_name,p.status purchase_order_status
    FROM erp_atlas_po_links l
    JOIN erp_purchase_orders p ON p.id=l.purchase_order_id
    WHERE l.import_id=?`,[importId]);
  if(!poLink)return fail(c,'ATLAS import is not linked to a purchase order.',409);
  if(!['APPROVED','PARTIALLY_RECEIVED'].includes(poLink.purchase_order_status)) {
    return fail(c,`Purchase order ${poLink.purchase_order_no} is not approved.`,409);
  }
  const importRows=await all(c.env.DB,`SELECT * FROM erp_import_rows WHERE import_id=? ORDER BY source_sheet,source_row`,[importId]);
  const rows=importRows.map(r=>({...JSON.parse(r.payload_json||'{}'),importRowId:r.id,validationStatus:r.validation_status}));
  const batches=groupAtlasRows(rows);
  const results=[];

  for(const batch of batches){
    const vendor=await ensurePartner(c.env.DB,{name:batch.supplierName,type:'VENDOR',sourceSystem:'ATLAS',sourceKey:batch.supplierName});
    let shipment=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE batch_code=? LIMIT 1`,[batch.batchCode]);
    if(shipment?.purchase_order_ref && shipment.purchase_order_ref!==poLink.purchase_order_no) {
      return fail(c,`Batch ${batch.batchCode} is already linked to purchase order ${shipment.purchase_order_ref}.`,409);
    }
    if(!shipment){
      const shipmentNo=await nextCode(c.env.DB,'SHIPMENT','SHP',6);
      const r=await run(c.env.DB,
        `INSERT INTO erp_shipments(shipment_no,batch_code,supplier_id,supplier_name,purchase_order_ref,status,atlas_import_id,source_system,source_key,created_by)
         VALUES(?,?,?,?,?,'MANIFESTED',?,'ATLAS',?,?)`,
        [shipmentNo,batch.batchCode,vendor.id,vendor.name,poLink.purchase_order_no,importId,batch.batchCode,c.get('erpUser').email]);
      shipment={id:r.meta.last_row_id,shipment_no:shipmentNo,batch_code:batch.batchCode};
    } else {
      await run(c.env.DB,`
        UPDATE erp_shipments
        SET atlas_import_id=?,purchase_order_ref=?,
          status=CASE WHEN status='DRAFT' THEN 'MANIFESTED' ELSE status END,
          updated_at=datetime('now')
        WHERE id=?`,[importId,poLink.purchase_order_no,shipment.id]);
    }
    await run(c.env.DB,`
      INSERT INTO erp_shipment_po_links(shipment_id,purchase_order_id,purchase_order_no,atlas_import_id,linked_by)
      VALUES(?,?,?,?,?)
      ON CONFLICT(shipment_id) DO UPDATE SET
        purchase_order_id=excluded.purchase_order_id,
        purchase_order_no=excluded.purchase_order_no,
        atlas_import_id=excluded.atlas_import_id,
        linked_by=excluded.linked_by,
        linked_at=datetime('now')`,
      [shipment.id,poLink.purchase_order_id,poLink.purchase_order_no,importId,c.get('erpUser').email]);

    const itemGroups=new Map();
    for(const row of batch.rows){
      const identity=itemIdentity(row);
      const groupKey=JSON.stringify(identity);
      if(!itemGroups.has(groupKey))itemGroups.set(groupKey,{identity,rows:[]});
      itemGroups.get(groupKey).rows.push(row);
    }

    let lineNo=0;
    for(const group of itemGroups.values()){
      lineNo+=1;
      const item=await ensureItem(c.env.DB,group.identity);
      let line=await first(c.env.DB,`SELECT * FROM erp_shipment_lines WHERE shipment_id=? AND item_id=? LIMIT 1`,[shipment.id,item.id]);
      if(!line){
        const lr=await run(c.env.DB,
          `INSERT INTO erp_shipment_lines(shipment_id,line_no,item_id,item_code,description,category,expected_qty,status,source_sheet)
           VALUES(?,?,?,?,?,?,?,'OPEN',?)`,
          [shipment.id,lineNo,item.id,item.item_code,item.item_name,item.category,group.rows.length,group.rows[0].sourceSheet]);
        line={id:lr.meta.last_row_id};
      }else{
        await run(c.env.DB,`UPDATE erp_shipment_lines SET expected_qty=? WHERE id=?`,[group.rows.length,line.id]);
      }

      for(const row of group.rows){
        const existingAsset=await first(c.env.DB,`SELECT id,serial_no FROM erp_assets WHERE serial_no=?`,[row.serialNo]);
        const existingExpected=await first(c.env.DB,`SELECT id FROM erp_expected_assets WHERE shipment_id=? AND serial_no=?`,[shipment.id,row.serialNo]);
        if(existingExpected)continue;
        let expectedStatus='EXPECTED';
        if(existingAsset){
          expectedStatus='EXPECTED_EXCEPTION';
          const exNo=await nextCode(c.env.DB,'EXCEPTION','EXC',6);
          await run(c.env.DB,
            `INSERT INTO erp_serial_exceptions(exception_no,serial_no,exception_type,source_system,source_sheet,source_row,canonical_asset_id,payload_json)
             VALUES(?,?,'DUPLICATE_ATLAS_SERIAL','ATLAS',?,?,?,?)`,
            [exNo,row.serialNo,row.sourceSheet,row.sourceRow,existingAsset.id,JSON.stringify({shipmentNo:shipment.shipment_no,...row})]);
          await run(c.env.DB,`UPDATE erp_import_rows SET validation_status='EXCEPTION',validation_message=? WHERE id=?`,[`Serial already exists as asset ${existingAsset.id}; retained as shipment expectation for review`,row.importRowId]);
        }
        const er=await run(c.env.DB,
          `INSERT INTO erp_expected_assets(shipment_id,shipment_line_id,serial_no,serial_type,item_id,item_code,manufacturer,model,color,secondary_serial,batch_code,expected_status,source_sheet,source_row)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [shipment.id,line.id,row.serialNo,row.serialType,item.id,item.item_code,row.manufacturer,row.model,row.color,row.secondarySerial,row.batchCode,expectedStatus,row.sourceSheet,row.sourceRow]);
        await run(c.env.DB,`UPDATE erp_import_rows SET posted_record_type='EXPECTED_ASSET',posted_record_id=? WHERE id=?`,[er.meta.last_row_id,row.importRowId]);
      }
    }
    results.push({shipmentId:shipment.id,shipmentNo:shipment.shipment_no,batchCode:batch.batchCode,
      purchaseOrderNo:poLink.purchase_order_no,expectedAssets:batch.rows.length});
  }

  await run(c.env.DB,`UPDATE erp_import_batches SET status='POSTED',posted_at=datetime('now') WHERE id=?`,[importId]);
  await audit(c,{action:'ATLAS_POST',module:'SHIPMENTS',recordType:'IMPORT',recordId:importId,recordNo:header.import_no,after:{shipments:results.length,results}});
  return ok(c,{importId,importNo:header.import_no,purchaseOrderNo:poLink.purchase_order_no,shipments:results});
});
