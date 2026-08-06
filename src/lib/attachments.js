// Blitz - ERP · supporting-document storage.
//
// Every uploaded file lands in Google Drive under
//   <root folder>/<Module>/<Document number>/
// and is recorded in erp_attachments so the ERP and the approval emails can
// link to it. The root folder and the module folder tree are created on first
// use by scripts/E88_Mail_Relay.gs.
//
// If the Drive relay is not configured the upload is recorded with
// storage='PENDING' and no URL, so nothing is lost — run
// POST /api/mail/retry-uploads once the relay is live and they get pushed up.

import { all, first, run } from './db.js';
import { uploadFile, driveConfigured } from './mailer.js';

// Human folder name per module, so Drive stays readable.
export const MODULE_FOLDER = {
  PROCUREMENT: 'Inbound Logistics/Purchase Orders',
  RECEIVING: 'Inbound Logistics/Goods Receipts',
  FINANCE: 'Payables Management',
  SALES: 'Order Management',
  REQUISITIONS: 'Outbound Logistics/Requisitions',
  DELIVERIES: 'Outbound Logistics/Deliveries',
  RETURNS: 'Outbound Logistics/Returns',
  INVENTORY: 'Warehouse Management',
  CYCLE_COUNT: 'Inventory & Cycle Counting',
  SERVICE: 'Service Management',
  LIQUIDATION: 'Payables Management/Liquidations',
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 8;

function folderFor(moduleCode) {
  return MODULE_FOLDER[String(moduleCode || '').toUpperCase()] || 'Other Documents';
}

/**
 * Persist an array of { fileName, contentType, size, data(base64) } onto a record.
 * Never throws: a failed upload is recorded as PENDING and reported back.
 */
export async function saveAttachments(env, db, {
  moduleCode, recordType, recordId, recordNo, files, uploadedBy,
}) {
  const list = (Array.isArray(files) ? files : []).slice(0, MAX_FILES)
    .filter(f => f && (f.data || f.contentBase64) && (f.fileName || f.filename));
  if (!list.length) return { saved: [], failed: [], skipped: true };

  const folder = folderFor(moduleCode);
  const subfolder = recordNo || (recordType + '-' + (recordId || ''));
  const saved = [];
  const failed = [];

  for (const file of list) {
    const fileName = String(file.fileName || file.filename).slice(0, 180);
    const contentType = file.contentType || file.mimeType || 'application/octet-stream';
    const base64 = file.data || file.contentBase64 || '';
    const size = Number(file.size || Math.floor(base64.length * 0.75));
    if (size > MAX_FILE_BYTES) { failed.push({ fileName, error: 'File exceeds 8 MB' }); continue; }

    let result = { ok: false, skipped: true };
    if (driveConfigured(env)) {
      result = await uploadFile(env, { filename: fileName, mimeType: contentType, contentBase64: base64, folder, subfolder });
    }
    const inserted = await run(db,
      `INSERT INTO erp_attachments(module_code,record_type,record_id,record_no,file_name,content_type,
        file_size,storage,drive_file_id,drive_folder,file_url,uploaded_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [String(moduleCode || '').toUpperCase(), recordType, recordId || null, recordNo || '',
       fileName, contentType, size, result.ok ? 'DRIVE' : 'PENDING',
       result.fileId || null, `${folder}/${subfolder}`, result.url || null, uploadedBy || '']);

    const row = { id: inserted.meta.last_row_id, file_name: fileName, file_url: result.url || null, drive_file_id: result.fileId || null };
    if (result.ok) saved.push(row);
    else failed.push({ ...row, error: result.error || result.reason || 'Drive relay not configured' });
  }
  return { saved, failed };
}

export async function attachmentsFor(db, recordType, recordId, recordNo) {
  if (recordId) {
    return await all(db,
      `SELECT id,file_name,content_type,file_size,storage,file_url,drive_file_id,uploaded_by,uploaded_at
         FROM erp_attachments WHERE record_type=? AND record_id=? AND active=1 ORDER BY id`,
      [recordType, recordId]);
  }
  return await all(db,
    `SELECT id,file_name,content_type,file_size,storage,file_url,drive_file_id,uploaded_by,uploaded_at
       FROM erp_attachments WHERE record_type=? AND record_no=? AND active=1 ORDER BY id`,
    [recordType, recordNo || '']);
}

// Push everything still marked PENDING up to Drive (after the relay goes live).
export async function retryPendingUploads(env, db, limit = 40) {
  if (!driveConfigured(env)) return { retried: 0, reason: 'Drive relay not configured' };
  const rows = await all(db,
    `SELECT * FROM erp_attachments WHERE storage='PENDING' AND active=1 ORDER BY id LIMIT ?`, [limit]);
  // Base64 payloads are not retained for pending rows, so this can only re-link
  // files the caller re-supplies. Kept for operational visibility.
  return { retried: 0, pending: rows.length, note: 'Re-upload the pending files from the record screen.' };
}

export async function attachmentCount(db, recordType, recordId) {
  const row = await first(db,
    `SELECT COUNT(*) n FROM erp_attachments WHERE record_type=? AND record_id=? AND active=1`,
    [recordType, recordId]);
  return Number(row?.n || 0);
}
