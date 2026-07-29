import { first, run } from './db.js';
import { nextCode, normalizeSerial } from './codes.js';

export async function getAsset(db, serialOrId) {
  if (typeof serialOrId === 'number' || /^\d+$/.test(String(serialOrId))) {
    return first(db, `SELECT * FROM erp_assets WHERE id=?`, [Number(serialOrId)]);
  }
  return first(db, `SELECT * FROM erp_assets WHERE serial_no=?`, [normalizeSerial(serialOrId)]);
}

export function isAvailable(asset) {
  return asset && asset.active && asset.reconciliation_status === 'CLEAR' && ['AVAILABLE', 'IN_STOCK'].includes(asset.current_status);
}

export async function postMovement(db, payload, userEmail) {
  const serial = normalizeSerial(payload.serialNo);
  const asset = await getAsset(db, serial);
  if (!asset) throw new Error(`Serial ${serial} is not registered.`);
  if (payload.requireAvailable && !isAvailable(asset)) {
    throw new Error(`Serial ${serial} is not available. Current status: ${asset.current_status}; reconciliation: ${asset.reconciliation_status}.`);
  }

  const movementNo = payload.movementNo || await nextCode(db, 'MOVEMENT', 'MV', 8);
  const toStatus = payload.toStatus || asset.current_status;
  const toLocationCode = payload.toLocationCode ?? asset.current_location_code;
  const holderType = payload.holderType ?? null;
  const holderId = payload.holderId ?? null;
  const holderName = payload.holderName ?? null;

  const insert = db.prepare(
    `INSERT INTO erp_stock_ledger(movement_no,movement_date,movement_type,asset_id,serial_no,item_id,item_code,qty,
      from_location_id,from_location_code,to_location_id,to_location_code,from_status,to_status,holder_type,holder_id,holder_name,
      source_doc_type,source_doc_id,source_doc_no,reason_code,notes,posted_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(movementNo, payload.movementDate || new Date().toISOString(), payload.movementType, asset.id, serial,
      asset.item_id, asset.item_code, Number(payload.qty || 1), asset.current_location_id, asset.current_location_code,
      payload.toLocationId || null, toLocationCode, asset.current_status, toStatus, holderType, holderId, holderName,
      payload.sourceDocType || '', payload.sourceDocId || null, payload.sourceDocNo || '', payload.reasonCode || '',
      payload.notes || '', userEmail || 'system');

  const update = db.prepare(
    `UPDATE erp_assets SET current_location_id=?,current_location_code=?,current_status=?,current_holder_type=?,current_holder_id=?,
      current_holder_name=?,condition_code=COALESCE(?,condition_code),reconciliation_status=COALESCE(?,reconciliation_status),updated_at=datetime('now')
     WHERE id=? AND updated_at=?`)
    .bind(payload.toLocationId || null, toLocationCode, toStatus, holderType, holderId, holderName,
      payload.conditionCode || null, payload.reconciliationStatus || null, asset.id, asset.updated_at);

  const results = await db.batch([insert, update]);
  if (!results[1]?.success || results[1]?.meta?.changes !== 1) {
    throw new Error(`Serial ${serial} was updated by another user. Refresh and try again.`);
  }
  return { movementNo, assetId: asset.id, serialNo: serial, fromStatus: asset.current_status, toStatus };
}

export async function createAssetFromReceipt(db, data) {
  const serial = normalizeSerial(data.serialNo);
  const existing = await first(db, `SELECT * FROM erp_assets WHERE serial_no=?`, [serial]);
  if (existing) return { asset: existing, duplicate: true };
  const assetNo = await nextCode(db, 'ASSET', 'AST', 8);
  const r = await run(db,
    `INSERT INTO erp_assets(asset_no,serial_no,serial_type,item_id,item_code,item_name,category,secondary_serial,motor_no,batch_code,
      shipment_id,receipt_id,current_location_id,current_location_code,current_status,unit_cost,condition_code,reconciliation_status,source_system,source_key)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [assetNo, serial, data.serialType, data.itemId || null, data.itemCode || '', data.itemName || '', data.category,
     data.secondarySerial || '', data.motorNo || '', data.batchCode || '', data.shipmentId || null, data.receiptId || null,
     data.locationId || null, data.locationCode || '', data.status || 'AVAILABLE', Number(data.unitCost || 0),
     data.conditionCode || 'GOOD', data.reconciliationStatus || 'CLEAR', data.sourceSystem || '', data.sourceKey || '']);
  return { asset: { id: r.meta.last_row_id, asset_no: assetNo, serial_no: serial }, duplicate: false };
}
