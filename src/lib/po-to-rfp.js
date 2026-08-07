/*
 * An approved purchase order and the request to pay it are the same commitment
 * seen twice. Making somebody retype the vendor, the amount and the PO number
 * into a fresh RFP is where the two drift apart: a transposed figure, a missing
 * PO reference, a payment nobody can tie back to what was approved.
 *
 * So the moment a purchase order completes its chain, the payment request is
 * raised against it, as a DRAFT. Finance still owns it - they fill in the
 * invoice, the terms and the bank details, they sign it, and they route it.
 * What they do not have to do is copy figures from one screen to another.
 */
import { first, run } from './db.js';
import { normalizeText, nextCode } from './codes.js';
import { entityByCode } from './finance.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function rfpNumber(db, department, requestDate) {
  const name = normalizeText(department);
  let code = '';
  if (name) {
    const row = await first(db, `SELECT code FROM erp_departments
      WHERE upper(code)=upper(?) OR upper(name)=upper(?) OR upper(name) LIKE upper(?)||'%'
      ORDER BY length(name) LIMIT 1`, [name, name, name]);
    code = normalizeText(row?.code);
  }
  if (!code) {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    code = words.length > 1 ? words.map(w => w[0]).join('').slice(0, 4) : (words[0] || 'GEN').slice(0, 4);
  }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GEN';
  const year = String(requestDate || '').slice(0, 4).match(/^\d{4}$/)
    ? String(requestDate).slice(0, 4) : new Date().toISOString().slice(0, 4);
  return await nextCode(db, `PAYMENT_REQUEST_${code}${year}`, `RFP-${code}${year}`, 4);
}

/*
 * Returns { created:false, reason } when there is nothing to do, so callers can
 * report honestly instead of implying they raised something they did not. Never
 * throws: a purchase order must still finish approving even if the RFP cannot
 * be written, and the approval is the fact that matters.
 */
export async function raiseRfpForPurchaseOrder(db, po, actorEmail) {
  try {
    if (!po || !po.id) return { created: false, reason: 'no purchase order' };
    // Raised once. A second call after a re-approval must not double the money.
    const existing = await first(db,
      `SELECT request_no FROM erp_payment_requests WHERE purchase_order_id=?`, [po.id]);
    if (existing) return { created: false, reason: 'already raised', requestNo: existing.request_no };

    const entity = await entityByCode(db, 'E88');
    if (!entity) return { created: false, reason: 'no legal entity' };

    const gross = round2(po.total_amount);
    if (!(gross > 0)) return { created: false, reason: 'purchase order has no value' };
    const vat = round2(po.tax_amount);

    // The department that owns the spend, taken from the PO document if it was
    // captured there, so the RFP lands in the right approval chain.
    const doc = await first(db, `SELECT meta FROM erp_po_doc WHERE purchase_order_id=?`, [po.id]);
    let meta = {}; try { meta = doc?.meta ? JSON.parse(doc.meta) : {}; } catch { meta = {}; }
    const department = normalizeText(meta.customerDepartment) || 'Procurement';

    const requestDate = new Date().toISOString().slice(0, 10);
    const requestNo = await rfpNumber(db, department, requestDate);
    const inserted = await run(db, `INSERT INTO erp_payment_requests(
        request_no,entity_id,request_date,requestor_email,payee_partner_id,payee_name,department,
        cost_center,purpose,request_type,purchase_order_id,purchase_order_no,
        gross_amount,vat_amount,withholding_amount,net_payable,payment_method,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,'DRAFT')`, [
      requestNo, entity.id, requestDate, normalizeText(actorEmail) || normalizeText(po.created_by),
      po.vendor_id || null, normalizeText(po.vendor_name) || 'Vendor', department,
      normalizeText(meta.costCenter), `Payment for purchase order ${po.purchase_order_no}`,
      'Payment to Vendor', po.id, po.purchase_order_no,
      gross, vat, gross, normalizeText(po.payment_terms),
    ]);

    // The same side table the RFP form writes, so the drafted request opens with
    // the vendor details already on it rather than an empty form.
    const extras = {
      requestorEmail: normalizeText(actorEmail) || normalizeText(po.created_by),
      requestorName: normalizeText(meta.requestedByName),
      payeeContact: normalizeText(meta.vendorContactNumber),
      payeeEmail: normalizeText(meta.vendorEmail),
      payeeTin: normalizeText(meta.vendorTaxId),
      currency: normalizeText(po.currency) || 'PHP',
      requestType: 'Payment to Vendor',
      remarks: `Raised automatically when ${po.purchase_order_no} completed its approval chain.`,
      autoRaisedFromPo: po.purchase_order_no,
    };
    try {
      await run(db, `INSERT OR REPLACE INTO erp_rfp_settings(key,value) VALUES(?,?)`,
        ['rfp_doc:' + requestNo, JSON.stringify(extras)]);
    } catch { /* the RFP is still valid without its cover sheet */ }

    return { created: true, requestNo, id: inserted.meta.last_row_id, gross, department };
  } catch (error) {
    return { created: false, reason: String(error && error.message || error) };
  }
}
