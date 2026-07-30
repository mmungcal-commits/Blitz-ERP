import { first, all } from './db.js';
import { normalizeSerial } from './codes.js';

const CLOSED_EXPECTED = ['RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED'];

export function isExpectedOpen(status) {
  return !CLOSED_EXPECTED.includes(String(status || 'EXPECTED').toUpperCase());
}

export async function getReceivingWorkbench(db, shipmentId) {
  const header = await first(db, `SELECT * FROM erp_shipments WHERE id=?`, [shipmentId]);
  if (!header) return null;
  const lines = await all(db, `
    SELECT l.*,
      (SELECT COUNT(*) FROM erp_expected_assets e WHERE e.shipment_line_id=l.id) expected_serial_count,
      (SELECT COUNT(*) FROM erp_expected_assets e WHERE e.shipment_line_id=l.id AND e.expected_status IN ('RECEIVED','SUBSTITUTED')) closed_serial_count,
      MAX(l.expected_qty-l.received_qty,0) remaining_qty
    FROM erp_shipment_lines l
    WHERE l.shipment_id=?
    ORDER BY l.line_no`, [shipmentId]);
  const expectedAssets = await all(db, `
    SELECT e.*,i.item_name,i.category,l.description,l.expected_qty,l.received_qty,
      m.actual_serial_no,m.match_status,m.variance_reason,m.receipt_line_id,m.matched_at
    FROM erp_expected_assets e
    LEFT JOIN erp_items i ON i.id=e.item_id
    LEFT JOIN erp_shipment_lines l ON l.id=e.shipment_line_id
    LEFT JOIN erp_expected_receipt_matches m ON m.expected_asset_id=e.id
    WHERE e.shipment_id=?
    ORDER BY l.line_no,e.source_sheet,e.source_row,e.serial_no`, [shipmentId]);
  const receipts = await all(db, `
    SELECT r.*,
      COUNT(rl.id) line_count,
      SUM(CASE WHEN rl.acceptance_status='MATCHED' THEN 1 ELSE 0 END) matched_count,
      SUM(CASE WHEN rl.acceptance_status!='MATCHED' THEN 1 ELSE 0 END) exception_count
    FROM erp_receipts r
    LEFT JOIN erp_receipt_lines rl ON rl.receipt_id=r.id
    WHERE r.shipment_id=?
    GROUP BY r.id ORDER BY r.received_at DESC`, [shipmentId]);
  return { header, lines, expectedAssets, receipts };
}

async function findExpected(db, shipmentId, input, actualSerial) {
  if (input.expectedAssetId) {
    const row = await first(db, `SELECT e.*,l.item_id line_item_id,l.item_code line_item_code,l.description,l.expected_qty,l.received_qty,i.item_name,i.category
      FROM erp_expected_assets e JOIN erp_shipment_lines l ON l.id=e.shipment_line_id LEFT JOIN erp_items i ON i.id=e.item_id
      WHERE e.id=? AND e.shipment_id=?`, [Number(input.expectedAssetId), shipmentId]);
    if (row) return row;
  }
  if (input.expectedSerialNo) {
    const row = await first(db, `SELECT e.*,l.item_id line_item_id,l.item_code line_item_code,l.description,l.expected_qty,l.received_qty,i.item_name,i.category
      FROM erp_expected_assets e JOIN erp_shipment_lines l ON l.id=e.shipment_line_id LEFT JOIN erp_items i ON i.id=e.item_id
      WHERE e.shipment_id=? AND e.serial_no=?`, [shipmentId, normalizeSerial(input.expectedSerialNo)]);
    if (row) return row;
  }
  if (actualSerial) {
    const row = await first(db, `SELECT e.*,l.item_id line_item_id,l.item_code line_item_code,l.description,l.expected_qty,l.received_qty,i.item_name,i.category
      FROM erp_expected_assets e JOIN erp_shipment_lines l ON l.id=e.shipment_line_id LEFT JOIN erp_items i ON i.id=e.item_id
      WHERE e.shipment_id=? AND e.serial_no=?`, [shipmentId, actualSerial]);
    if (row) return row;
  }
  if (input.shipmentLineId) {
    return first(db, `SELECT e.*,l.item_id line_item_id,l.item_code line_item_code,l.description,l.expected_qty,l.received_qty,i.item_name,i.category
      FROM erp_expected_assets e JOIN erp_shipment_lines l ON l.id=e.shipment_line_id LEFT JOIN erp_items i ON i.id=e.item_id
      WHERE e.shipment_id=? AND e.shipment_line_id=? AND e.expected_status NOT IN ('RECEIVED','SUBSTITUTED','CANCELLED','SHORT_CLOSED')
      ORDER BY e.id LIMIT 1`, [shipmentId, Number(input.shipmentLineId)]);
  }
  return null;
}

export async function classifyReceivingLine(db, shipment, input) {
  const actualSerial = normalizeSerial(input.actualSerialNo || input.serialNo);
  if (!actualSerial) return { ...input, actualSerialNo:'', acceptance:'INVALID', message:'Actual serial is required.' };

  const existing = await first(db, `SELECT id,asset_no,serial_no,item_id,item_code,current_status,current_location_code FROM erp_assets WHERE serial_no=?`, [actualSerial]);
  const expected = await findExpected(db, shipment.id, input, actualSerial);
  let shipmentLine = null;
  if (expected) shipmentLine = await first(db, `SELECT * FROM erp_shipment_lines WHERE id=?`, [expected.shipment_line_id]);
  else if (input.shipmentLineId) shipmentLine = await first(db, `SELECT * FROM erp_shipment_lines WHERE id=? AND shipment_id=?`, [Number(input.shipmentLineId), shipment.id]);

  const actualItemId = Number(input.actualItemId || input.itemId || shipmentLine?.item_id || expected?.item_id || 0) || null;
  const actualItemCode = input.actualItemCode || input.itemCode || shipmentLine?.item_code || expected?.item_code || '';
  const expectedItemId = expected?.item_id || shipmentLine?.item_id || null;
  const expectedSerialNo = expected?.serial_no || normalizeSerial(input.expectedSerialNo || '');
  let acceptance = 'MATCHED';
  let message = '';

  if (existing) {
    acceptance = 'DUPLICATE_SERIAL';
    message = `Serial is already registered as ${existing.asset_no}.`;
  } else if (expected && !isExpectedOpen(expected.expected_status)) {
    acceptance = 'EXPECTED_ALREADY_CLOSED';
    message = `Expected serial is already ${expected.expected_status}.`;
  } else if (expected && expectedItemId && actualItemId && Number(expectedItemId) !== Number(actualItemId)) {
    acceptance = 'DIFFERENT_ITEM';
    message = 'Actual item differs from the selected expected item.';
  } else if (expected && actualSerial === normalizeSerial(expected.serial_no)) {
    acceptance = 'MATCHED';
    message = 'Expected item and serial matched.';
  } else if (expected) {
    acceptance = 'SERIAL_SUBSTITUTED';
    message = `Same expected item received with actual serial ${actualSerial} instead of ${expected.serial_no}.`;
  } else if (shipmentLine && Number(shipmentLine.received_qty || 0) >= Number(shipmentLine.expected_qty || 0)) {
    acceptance = 'OVER_RECEIPT';
    message = 'Expected quantity is already fully received; this is an excess receipt.';
  } else if (shipmentLine) {
    acceptance = 'UNPLANNED_SERIAL';
    message = 'Item belongs to the shipment line but this serial was not in the ATLAS manifest.';
  } else {
    acceptance = 'UNEXPECTED_ITEM';
    message = 'Actual item or serial is not linked to an expected shipment line.';
  }

  return {
    ...input,
    actualSerialNo: actualSerial,
    expectedSerialNo,
    expectedAssetId: expected?.id || null,
    shipmentLineId: expected?.shipment_line_id || shipmentLine?.id || null,
    expectedItemId,
    actualItemId,
    actualItemCode,
    expectedItemCode: expected?.item_code || shipmentLine?.item_code || '',
    expectedItemName: expected?.item_name || shipmentLine?.description || '',
    serialType: expected?.serial_type || input.serialType || 'OTHER',
    category: expected?.category || input.category || 'OTH',
    secondarySerial: expected?.secondary_serial || input.secondarySerial || '',
    unitCost: shipmentLine?.unit_cost || input.unitCost || 0,
    acceptance,
    message,
    existingAsset: existing || null,
  };
}

export async function classifyReceivingLines(db, shipment, lines) {
  const results = [];
  const seen = new Set();
  for (const input of lines) {
    const row = await classifyReceivingLine(db, shipment, input);
    if (row.actualSerialNo && seen.has(row.actualSerialNo) && row.acceptance !== 'DUPLICATE_SERIAL') {
      row.acceptance = 'DUPLICATE_IN_RECEIPT';
      row.message = 'The same actual serial appears more than once in this receipt.';
    }
    if (row.actualSerialNo) seen.add(row.actualSerialNo);
    results.push(row);
  }
  return results;
}

export function receivingAssetControl(acceptance) {
  if (acceptance === 'MATCHED') return { status:'AVAILABLE', reconciliation:'CLEAR' };
  return { status:'QUARANTINE', reconciliation:'UNRECONCILED' };
}
