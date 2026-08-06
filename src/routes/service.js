// Blitz - ERP · Service Management (after-sales).
//
// Flow: raise a job -> build the assembly card from real inventory (the parts
// leave stock the moment they are picked) -> the system prices the job from
// material + labour + overhead plus a markup, which is the revenue -> print the
// Job Order -> complete the job on the parts actually used -> push the excess
// back into inventory so it becomes available again.

import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, numberValue, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nextCode, normalizeText, normalizeSerial, ensurePartner, ensureLocation } from '../lib/codes.js';
import { postMovement } from '../lib/inventory.js';
import { saveAttachments, attachmentsFor } from '../lib/attachments.js';

export const serviceRoutes = new Hono();

const round2 = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

async function setting(db, key, fallback) {
  const row = await first(db, `SELECT value FROM erp_settings WHERE key=?`, [key]);
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : fallback;
}

// Recompute every money field on the job from its parts and labour.
async function reprice(db, jobId) {
  const job = await first(db, `SELECT * FROM erp_service_jobs WHERE id=?`, [jobId]);
  if (!job) return null;
  const parts = await all(db, `SELECT * FROM erp_service_job_parts WHERE job_id=?`, [jobId]);
  const labor = await all(db, `SELECT * FROM erp_service_job_labor WHERE job_id=?`, [jobId]);

  const material = round2(parts.reduce((s, p) => s + Number(p.line_cost || 0), 0));
  const laborCost = round2(labor.reduce((s, l) => s + Number(l.amount || 0), 0));
  const overheadPct = await setting(db, 'SERVICE_OVERHEAD_PCT', 5);
  const overhead = round2((material + laborCost) * (overheadPct / 100));
  const markup = Number(job.markup_pct || 0);

  const estimatedCost = round2(material + laborCost + overhead);
  const estimatedPrice = round2(estimatedCost * (1 + markup / 100));

  // Final numbers only count what was actually consumed.
  const consumed = parts.filter(p => p.state === 'CONSUMED');
  const finalMaterial = round2(consumed.reduce((s, p) => s + Number(p.unit_cost || 0) * Number(p.qty_used || 0), 0));
  const finalCost = round2(finalMaterial + laborCost + round2((finalMaterial + laborCost) * (overheadPct / 100)));
  const finalPrice = round2(finalCost * (1 + markup / 100));

  await run(db, `UPDATE erp_service_jobs SET material_cost=?,labor_cost=?,overhead_cost=?,
      estimated_cost=?,estimated_price=?,final_material_cost=?,final_cost=?,final_price=?,
      gross_margin=?,updated_at=datetime('now') WHERE id=?`,
    [material, laborCost, overhead, estimatedCost, estimatedPrice,
     finalMaterial, finalCost, finalPrice, round2(finalPrice - finalCost), jobId]);

  return { material, laborCost, overhead, estimatedCost, estimatedPrice, finalMaterial, finalCost, finalPrice };
}

/* ------------------------------------------------------------------ lookups */
serviceRoutes.get('/lookups', requirePermission('CUSTOMERS','VIEW'), async c => {
  const [customers, items, spareAssets, units, locations] = await Promise.all([
    all(c.env.DB, `SELECT id,partner_code,name FROM erp_partners WHERE partner_type IN ('CUSTOMER','EMPLOYEE') AND active=1 ORDER BY name`),
    all(c.env.DB, `SELECT id,item_code,item_name,category,serialized,standard_cost FROM erp_items WHERE active=1 ORDER BY category,item_name`),
    // Only clear, available stock can be pulled onto an assembly card.
    all(c.env.DB, `SELECT a.id,a.serial_no,a.item_id,a.item_code,a.item_name,a.category,a.unit_cost,a.current_location_code
       FROM erp_assets a
      WHERE a.active=1 AND a.reconciliation_status='CLEAR'
        AND a.current_status IN ('AVAILABLE','IN_STOCK','AVAILABLE_FOR_SALE','AVAILABLE_FOR_LEASE')
      ORDER BY a.category,a.item_name,a.serial_no LIMIT 3000`),
    all(c.env.DB, `SELECT serial_no,item_code,item_name,category,current_status FROM erp_assets
      WHERE active=1 ORDER BY item_name,serial_no LIMIT 3000`),
    all(c.env.DB, `SELECT id,code,name,location_type FROM erp_locations WHERE active=1 ORDER BY code`),
  ]);
  return ok(c, {
    customers, items, spareAssets, units, locations,
    laborRate: await setting(c.env.DB, 'SERVICE_LABOR_RATE', 450),
    defaultMarkup: await setting(c.env.DB, 'SERVICE_DEFAULT_MARKUP', 20),
    overheadPct: await setting(c.env.DB, 'SERVICE_OVERHEAD_PCT', 5),
  });
});

/* ------------------------------------------------------------------- jobs */
serviceRoutes.get('/jobs', requirePermission('CUSTOMERS','VIEW'), async c => {
  const { page, size, offset } = pageParams(c);
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const rows = await all(c.env.DB, `SELECT j.*,
      (SELECT COUNT(*) FROM erp_service_job_parts p WHERE p.job_id=j.id) part_count,
      (SELECT COUNT(*) FROM erp_attachments a WHERE a.record_type='SERVICE_JOB' AND a.record_id=j.id AND a.active=1) attachment_count
    FROM erp_service_jobs j WHERE (?='' OR j.status=?)
    ORDER BY j.id DESC LIMIT ? OFFSET ?`, [status, status, size, offset]);
  const total = await first(c.env.DB, `SELECT COUNT(*) n FROM erp_service_jobs WHERE (?='' OR status=?)`, [status, status]);
  return ok(c, { rows, page, size, total: total?.n || 0 });
});

serviceRoutes.get('/jobs/:id', requirePermission('CUSTOMERS','VIEW'), async c => {
  const id = Number(c.req.param('id'));
  const header = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!header) return fail(c, 'Service job not found', 404);
  const [parts, labor, returns, attachments] = await Promise.all([
    all(c.env.DB, `SELECT * FROM erp_service_job_parts WHERE job_id=? ORDER BY line_no`, [id]),
    all(c.env.DB, `SELECT * FROM erp_service_job_labor WHERE job_id=? ORDER BY line_no`, [id]),
    all(c.env.DB, `SELECT * FROM erp_service_part_returns WHERE job_id=? ORDER BY id`, [id]),
    attachmentsFor(c.env.DB, 'SERVICE_JOB', id, header.job_no),
  ]);
  return ok(c, { header, parts, labor, returns, attachments });
});

serviceRoutes.post('/jobs', requirePermission('CUSTOMERS','CREATE'), async c => {
  const b = await jsonBody(c);
  if (!normalizeText(b.complaint)) return fail(c, 'Describe the complaint or work requested.');
  let customer = b.customerId ? await first(c.env.DB, `SELECT * FROM erp_partners WHERE id=?`, [Number(b.customerId)]) : null;
  if (!customer && normalizeText(b.customerName)) {
    customer = await ensurePartner(c.env.DB, { name: b.customerName, type: 'CUSTOMER', sourceSystem: 'SERVICE' });
  }
  const unitSerial = normalizeSerial(b.unitSerialNo);
  const unit = unitSerial ? await first(c.env.DB, `SELECT * FROM erp_assets WHERE serial_no=?`, [unitSerial]) : null;
  const no = await nextCode(c.env.DB, 'SERVICE_JOB', 'JO', 6);
  const markup = b.markupPct === undefined ? await setting(c.env.DB, 'SERVICE_DEFAULT_MARKUP', 20) : numberValue(b.markupPct);

  const inserted = await run(c.env.DB, `INSERT INTO erp_service_jobs(job_no,job_type,customer_id,customer_name,
      contact_person,contact_number,unit_serial_no,unit_item_code,unit_item_name,odometer,
      location_id,location_code,complaint,diagnosis,priority,promised_date,markup_pct,status,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT',?)`,
    [no, normalizeText(b.jobType).toUpperCase() || 'REPAIR', customer?.id || null, customer?.name || normalizeText(b.customerName),
     normalizeText(b.contactPerson), normalizeText(b.contactNumber), unitSerial,
     unit?.item_code || normalizeText(b.unitItemCode), unit?.item_name || normalizeText(b.unitItemName),
     normalizeText(b.odometer), b.locationId ? Number(b.locationId) : null, normalizeText(b.locationCode),
     normalizeText(b.complaint), normalizeText(b.diagnosis), normalizeText(b.priority) || 'NORMAL',
     normalizeText(b.promisedDate), markup, c.get('erpUser').email]);
  const jobId = inserted.meta.last_row_id;

  const attach = await saveAttachments(c.env, c.env.DB, { moduleCode: 'SERVICE', recordType: 'SERVICE_JOB',
    recordId: jobId, recordNo: no, files: b.attachments, uploadedBy: c.get('erpUser').email });

  await audit(c, { action: 'CREATE', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: jobId, recordNo: no, after: { unitSerial, markup } });
  return ok(c, { id: jobId, jobNo: no, attachments: attach.saved, attachmentErrors: attach.failed }, 201);
});

serviceRoutes.patch('/jobs/:id', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (['CLOSED','CANCELLED'].includes(job.status)) return fail(c, `A ${job.status.toLowerCase()} job cannot be edited.`, 409);
  await run(c.env.DB, `UPDATE erp_service_jobs SET
      diagnosis=COALESCE(NULLIF(?,''),diagnosis),
      work_performed=COALESCE(NULLIF(?,''),work_performed),
      complaint=COALESCE(NULLIF(?,''),complaint),
      promised_date=COALESCE(NULLIF(?,''),promised_date),
      remarks=COALESCE(NULLIF(?,''),remarks),
      markup_pct=CASE WHEN ? < 0 THEN markup_pct ELSE ? END,
      updated_at=datetime('now') WHERE id=?`,
    [normalizeText(b.diagnosis), normalizeText(b.workPerformed), normalizeText(b.complaint),
     normalizeText(b.promisedDate), normalizeText(b.remarks),
     b.markupPct === undefined ? -1 : numberValue(b.markupPct), numberValue(b.markupPct), id]);
  if (Array.isArray(b.attachments) && b.attachments.length) {
    await saveAttachments(c.env, c.env.DB, { moduleCode: 'SERVICE', recordType: 'SERVICE_JOB',
      recordId: id, recordNo: job.job_no, files: b.attachments, uploadedBy: c.get('erpUser').email });
  }
  const totals = await reprice(c.env.DB, id);
  return ok(c, { totals });
});

/* ------------------------------------------------- assembly card (parts) */
// Picking a part takes it out of inventory immediately.
serviceRoutes.post('/jobs/:id/parts', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (['COMPLETED','CLOSED','CANCELLED'].includes(job.status)) return fail(c, `A ${job.status.toLowerCase()} job cannot take new parts.`, 409);

  const requested = (Array.isArray(b.parts) ? b.parts : [b]).filter(p => p && (p.serialNo || p.itemId || p.itemCode));
  if (!requested.length) return fail(c, 'Select at least one part.');
  const maxLine = await first(c.env.DB, `SELECT COALESCE(MAX(line_no),0) m FROM erp_service_job_parts WHERE job_id=?`, [id]);
  let lineNo = Number(maxLine?.m || 0);
  const added = [];

  for (const part of requested) {
    const serial = normalizeSerial(part.serialNo);
    let asset = null, priorStatus = null, unitCost = numberValue(part.unitCost);
    let itemId = part.itemId ? Number(part.itemId) : null;
    let itemCode = normalizeText(part.itemCode), itemName = normalizeText(part.itemName);

    if (serial) {
      asset = await first(c.env.DB, `SELECT * FROM erp_assets WHERE serial_no=? AND active=1`, [serial]);
      if (!asset) return fail(c, `Serial ${serial} is not registered.`, 404);
      if (!['AVAILABLE','IN_STOCK','AVAILABLE_FOR_SALE','AVAILABLE_FOR_LEASE'].includes(asset.current_status)) {
        return fail(c, `Serial ${serial} is not available (${asset.current_status}).`, 409);
      }
      const already = await first(c.env.DB,
        `SELECT p.id FROM erp_service_job_parts p WHERE p.serial_no=? AND p.state='RESERVED'`, [serial]);
      if (already) return fail(c, `Serial ${serial} is already reserved on another job.`, 409);
      priorStatus = asset.current_status;
      itemId = asset.item_id; itemCode = asset.item_code; itemName = asset.item_name;
      if (!unitCost) unitCost = Number(asset.unit_cost || 0);
      // Take it out of stock through the ledger so the movement is auditable.
      await postMovement(c.env.DB, {
        serialNo: serial, movementType: 'SERVICE_ISSUE', toStatus: 'IN_SERVICE',
        reasonCode: 'SERVICE_JOB', sourceDocType: 'SERVICE_JOB', sourceDocId: id, sourceDocNo: job.job_no,
        notes: `Reserved for service job ${job.job_no}`,
      }, c.get('erpUser').email);
    } else if (itemId && !itemCode) {
      const item = await first(c.env.DB, `SELECT * FROM erp_items WHERE id=?`, [itemId]);
      itemCode = item?.item_code || ''; itemName = item?.item_name || '';
      if (!unitCost) unitCost = Number(item?.standard_cost || 0);
    }

    const qty = serial ? 1 : Math.max(numberValue(part.qty, 1), 0.01);
    lineNo += 1;
    const inserted = await run(c.env.DB, `INSERT INTO erp_service_job_parts(job_id,line_no,item_id,item_code,item_name,
        serial_no,asset_id,prior_status,qty,unit_cost,line_cost,state,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?, 'RESERVED',?)`,
      [id, lineNo, itemId, itemCode, itemName, serial, asset?.id || null, priorStatus,
       qty, round2(unitCost), round2(qty * unitCost), normalizeText(part.notes)]);
    added.push({ id: inserted.meta.last_row_id, serial, itemCode, qty, unitCost: round2(unitCost) });
  }

  const totals = await reprice(c.env.DB, id);
  await audit(c, { action: 'ADD_PARTS', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no, after: { added: added.length } });
  return ok(c, { added, totals }, 201);
});

// Remove a reserved part before completion: the serial goes straight back to stock.
serviceRoutes.delete('/jobs/:id/parts/:partId', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const partId = Number(c.req.param('partId'));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  const part = await first(c.env.DB, `SELECT * FROM erp_service_job_parts WHERE id=? AND job_id=?`, [partId, id]);
  if (!job || !part) return fail(c, 'Part not found on this job', 404);
  if (part.state !== 'RESERVED') return fail(c, 'Only a reserved part can be removed. Use the return-to-inventory action instead.', 409);
  if (part.serial_no) {
    await postMovement(c.env.DB, {
      serialNo: part.serial_no, movementType: 'SERVICE_RETURN', toStatus: part.prior_status || 'AVAILABLE',
      reasonCode: 'SERVICE_PART_UNPICKED', sourceDocType: 'SERVICE_JOB', sourceDocId: id, sourceDocNo: job.job_no,
      notes: `Removed from service job ${job.job_no} before completion`,
    }, c.get('erpUser').email);
  }
  await run(c.env.DB, `DELETE FROM erp_service_job_parts WHERE id=?`, [partId]);
  const totals = await reprice(c.env.DB, id);
  return ok(c, { removed: partId, totals });
});

/* -------------------------------------------------------------- labour */
serviceRoutes.post('/jobs/:id/labor', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  const lines = (Array.isArray(b.labor) ? b.labor : [b]).filter(l => l && (numberValue(l.hours) > 0 || numberValue(l.amount) > 0));
  await run(c.env.DB, `DELETE FROM erp_service_job_labor WHERE job_id=?`, [id]);
  const defaultRate = await setting(c.env.DB, 'SERVICE_LABOR_RATE', 450);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    const hours = numberValue(line.hours);
    const rate = numberValue(line.rate, defaultRate);
    const amount = numberValue(line.amount) || round2(hours * rate);
    await run(c.env.DB, `INSERT INTO erp_service_job_labor(job_id,line_no,description,technician,hours,rate,amount)
      VALUES(?,?,?,?,?,?,?)`, [id, lineNo, normalizeText(line.description), normalizeText(line.technician), hours, rate, amount]);
  }
  const totals = await reprice(c.env.DB, id);
  return ok(c, { lines: lineNo, totals });
});

/* ------------------------------------------------------------ estimate */
serviceRoutes.post('/jobs/:id/estimate', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c).catch(() => ({}));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (b.markupPct !== undefined) {
    await run(c.env.DB, `UPDATE erp_service_jobs SET markup_pct=? WHERE id=?`, [numberValue(b.markupPct), id]);
  }
  const totals = await reprice(c.env.DB, id);
  await run(c.env.DB, `UPDATE erp_service_jobs SET status=CASE WHEN status='DRAFT' THEN 'ESTIMATED' ELSE status END,
    estimated_at=datetime('now'),updated_at=datetime('now') WHERE id=?`, [id]);
  await audit(c, { action: 'ESTIMATE', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no, after: totals });
  return ok(c, { totals });
});

serviceRoutes.post('/jobs/:id/approve', requirePermission('CUSTOMERS','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (!['DRAFT','ESTIMATED'].includes(job.status)) return fail(c, `This job is ${job.status}.`, 409);
  await run(c.env.DB, `UPDATE erp_service_jobs SET status='IN_PROGRESS',approved_by=?,approved_at=datetime('now'),
    updated_at=datetime('now') WHERE id=?`, [c.get('erpUser').email, id]);
  await audit(c, { action: 'APPROVE', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no });
  return ok(c, { status: 'IN_PROGRESS' });
});

/* ------------------------------------------------------------ complete */
// body: { workPerformed, used:[{partId, qtyUsed}] } — anything not used stays
// reserved and can be returned to inventory.
serviceRoutes.post('/jobs/:id/complete', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c).catch(() => ({}));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (['COMPLETED','CLOSED','CANCELLED'].includes(job.status)) return fail(c, `This job is already ${job.status}.`, 409);

  const parts = await all(c.env.DB, `SELECT * FROM erp_service_job_parts WHERE job_id=? AND state='RESERVED'`, [id]);
  const usedMap = new Map((Array.isArray(b.used) ? b.used : []).map(u => [Number(u.partId), numberValue(u.qtyUsed)]));
  const user = c.get('erpUser').email;
  let consumed = 0, leftReserved = 0;

  for (const part of parts) {
    // Default: a serialised part picked for the job is treated as used.
    const qtyUsed = usedMap.has(part.id) ? usedMap.get(part.id) : Number(part.qty || 0);
    if (qtyUsed <= 0) { leftReserved += 1; continue; }
    if (part.serial_no) {
      await postMovement(c.env.DB, {
        serialNo: part.serial_no, movementType: 'SERVICE_CONSUMPTION', toStatus: 'CONSUMED_IN_SERVICE',
        reasonCode: 'SERVICE_JOB_CONSUMED', sourceDocType: 'SERVICE_JOB', sourceDocId: id, sourceDocNo: job.job_no,
        notes: `Consumed on service job ${job.job_no}`,
      }, user);
    }
    await run(c.env.DB, `UPDATE erp_service_job_parts SET state='CONSUMED',qty_used=? WHERE id=?`,
      [Math.min(qtyUsed, Number(part.qty || qtyUsed)), part.id]);
    consumed += 1;
    if (qtyUsed < Number(part.qty || 0)) leftReserved += 1;
  }

  await run(c.env.DB, `UPDATE erp_service_jobs SET status='COMPLETED',work_performed=COALESCE(NULLIF(?,''),work_performed),
    completed_by=?,completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,
    [normalizeText(b.workPerformed), user, id]);
  const totals = await reprice(c.env.DB, id);
  await audit(c, { action: 'COMPLETE', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no, after: { consumed, totals } });
  return ok(c, { status: 'COMPLETED', consumed, pendingReturn: leftReserved, totals });
});

/* --------------------------------------------- excess parts back to stock */
serviceRoutes.post('/jobs/:id/return-parts', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c).catch(() => ({}));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  const requested = Array.isArray(b.returns) ? b.returns : [];
  if (!requested.length) return fail(c, 'Select the excess parts to return to inventory.');

  let location = null;
  if (b.locationId || b.locationCode) {
    location = await ensureLocation(c.env.DB, normalizeText(b.locationName || b.locationCode), normalizeText(b.locationType) || 'WAREHOUSE', normalizeText(b.locationCode));
  }
  const returnNo = await nextCode(c.env.DB, 'SERVICE_RETURN', 'SRT', 6);
  const user = c.get('erpUser').email;
  const restored = [];

  for (const entry of requested) {
    const part = await first(c.env.DB, `SELECT * FROM erp_service_job_parts WHERE id=? AND job_id=?`, [Number(entry.partId), id]);
    if (!part) continue;
    if (part.state === 'RETURNED') continue;
    const qty = numberValue(entry.qty, Number(part.qty || 0) - Number(part.qty_used || 0));
    if (qty <= 0) continue;

    if (part.serial_no) {
      await postMovement(c.env.DB, {
        serialNo: part.serial_no, movementType: 'SERVICE_RETURN',
        toStatus: normalizeText(entry.conditionCode) === 'DAMAGED' ? 'QUARANTINE' : (part.prior_status || 'AVAILABLE'),
        toLocationId: location?.id, toLocationCode: location?.code,
        reasonCode: 'SERVICE_EXCESS_RETURN', sourceDocType: 'SERVICE_JOB', sourceDocId: id, sourceDocNo: job.job_no,
        notes: `Excess part returned to inventory from service job ${job.job_no}`,
      }, user);
    }
    await run(c.env.DB, `INSERT INTO erp_service_part_returns(return_no,job_id,part_id,serial_no,item_code,qty,
        unit_cost,location_id,location_code,condition_code,returned_by,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [returnNo, id, part.id, part.serial_no, part.item_code, qty, part.unit_cost,
       location?.id || null, location?.code || '', normalizeText(entry.conditionCode) || 'GOOD', user, normalizeText(entry.notes)]);
    await run(c.env.DB, `UPDATE erp_service_job_parts SET qty_returned=qty_returned+?,
        state=CASE WHEN qty_used<=0 THEN 'RETURNED' ELSE state END WHERE id=?`, [qty, part.id]);
    restored.push({ partId: part.id, serial: part.serial_no, qty });
  }

  const totals = await reprice(c.env.DB, id);
  await audit(c, { action: 'RETURN_PARTS', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no, after: { returnNo, restored: restored.length } });
  return ok(c, { returnNo, restored, totals });
});

serviceRoutes.post('/jobs/:id/close', requirePermission('CUSTOMERS','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (job.status !== 'COMPLETED') return fail(c, 'Only a completed job can be closed.', 409);
  const stillReserved = await first(c.env.DB,
    `SELECT COUNT(*) n FROM erp_service_job_parts WHERE job_id=? AND state='RESERVED'`, [id]);
  if (Number(stillReserved?.n || 0)) {
    return fail(c, 'Return the unused parts to inventory before closing this job.', 409);
  }
  await run(c.env.DB, `UPDATE erp_service_jobs SET status='CLOSED',closed_by=?,closed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,
    [c.get('erpUser').email, id]);
  await audit(c, { action: 'CLOSE', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no });
  return ok(c, { status: 'CLOSED' });
});

serviceRoutes.post('/jobs/:id/cancel', requirePermission('CUSTOMERS','EDIT'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c).catch(() => ({}));
  const job = await first(c.env.DB, `SELECT * FROM erp_service_jobs WHERE id=?`, [id]);
  if (!job) return fail(c, 'Service job not found', 404);
  if (['CLOSED','CANCELLED'].includes(job.status)) return fail(c, `This job is already ${job.status}.`, 409);
  const parts = await all(c.env.DB, `SELECT * FROM erp_service_job_parts WHERE job_id=? AND state='RESERVED'`, [id]);
  const user = c.get('erpUser').email;
  for (const part of parts) {
    if (part.serial_no) {
      await postMovement(c.env.DB, {
        serialNo: part.serial_no, movementType: 'SERVICE_RETURN', toStatus: part.prior_status || 'AVAILABLE',
        reasonCode: 'SERVICE_JOB_CANCELLED', sourceDocType: 'SERVICE_JOB', sourceDocId: id, sourceDocNo: job.job_no,
        notes: `Service job ${job.job_no} cancelled; part returned to stock`,
      }, user);
    }
    await run(c.env.DB, `UPDATE erp_service_job_parts SET state='RETURNED',qty_returned=qty WHERE id=?`, [part.id]);
  }
  await run(c.env.DB, `UPDATE erp_service_jobs SET status='CANCELLED',cancelled_by=?,cancelled_at=datetime('now'),
    cancel_reason=?,updated_at=datetime('now') WHERE id=?`, [user, normalizeText(b.reason), id]);
  await audit(c, { action: 'CANCEL', module: 'CUSTOMERS', recordType: 'SERVICE_JOB', recordId: id, recordNo: job.job_no, after: { restored: parts.length } });
  return ok(c, { status: 'CANCELLED', restored: parts.length });
});

/* --------------------------------------------------------------- setup */
serviceRoutes.get('/settings', requirePermission('CUSTOMERS','VIEW'), async c => ok(c, {
  laborRate: await setting(c.env.DB, 'SERVICE_LABOR_RATE', 450),
  defaultMarkup: await setting(c.env.DB, 'SERVICE_DEFAULT_MARKUP', 20),
  overheadPct: await setting(c.env.DB, 'SERVICE_OVERHEAD_PCT', 5),
}));

serviceRoutes.post('/settings', requirePermission('CUSTOMERS','MANAGE'), async c => {
  const b = await jsonBody(c);
  const allowed = ['SERVICE_LABOR_RATE','SERVICE_DEFAULT_MARKUP','SERVICE_OVERHEAD_PCT'];
  const saved = [];
  for (const key of allowed) {
    if (b[key] === undefined) continue;
    await run(c.env.DB, `INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES(?,?,datetime('now'))`,
      [key, String(numberValue(b[key]))]);
    saved.push(key);
  }
  await audit(c, { action: 'UPDATE_SETTINGS', module: 'CUSTOMERS', recordType: 'SERVICE_SETTINGS', recordNo: 'SERVICE', after: b });
  return ok(c, { saved });
});

/* ------------------------------------------------------------- analytics */
serviceRoutes.get('/summary', requirePermission('CUSTOMERS','VIEW'), async c => {
  const rows = await all(c.env.DB, `SELECT status,COUNT(*) n,
      ROUND(SUM(COALESCE(final_price,estimated_price)),2) value
    FROM erp_service_jobs GROUP BY status`);
  const revenue = await first(c.env.DB, `SELECT ROUND(SUM(final_price),2) revenue,ROUND(SUM(final_cost),2) cost,
    ROUND(SUM(gross_margin),2) margin FROM erp_service_jobs WHERE status IN ('COMPLETED','CLOSED')`);
  const partsOut = await first(c.env.DB, `SELECT COUNT(*) n FROM erp_service_job_parts WHERE state='RESERVED'`);
  return ok(c, { byStatus: rows, revenue: revenue || {}, partsReserved: Number(partsOut?.n || 0) });
});
