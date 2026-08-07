import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nextCode, normalizeText } from '../lib/codes.js';

export const receivableRoutes = new Hono();

/*
 * Receivables Management.
 *
 * Everything on the revenue side in one register: who was billed, what came in,
 * how it was paid and whether it cleared. The shape follows E88's own sales
 * monitoring workbook - five streams, one row per receipt, VAT split out - so
 * the people who keep that spreadsheet recognise the screen.
 *
 * A collection is editable while it is DRAFT and frozen once posted. Posting is
 * the moment a record becomes money, so it is Finance's alone and it is not
 * reversible by editing - a posted row is voided, with a reason, and the void
 * stays on the register.
 */

const STREAMS = {
  MC_SOLD:'Motorcycle sold', MC_LEASED:'Motorcycle leased', BATTERY_SWAP:'Battery swapping',
  AFTERSALES:'After-sales', WAREHOUSE_SERVICE:'Warehouse service',
};
const FINANCE_ROLES = ['FINANCE','FINANCE_MANAGER','CONTROLLER','ACCOUNTING'];
const isFinance = c => FINANCE_ROLES.includes(
  String(c.get('erpUser').role_code || c.get('erpUser').role || '').toUpperCase());

// VAT is derived, never typed twice: gross and rate decide net and output VAT,
// so the register can never hold a row whose parts do not add up.
function vatSplit(gross, vatType, vatRate) {
  const g = numberValue(gross);
  const rate = String(vatType) === 'VATable' ? (numberValue(vatRate) || 0.12) : 0;
  const net = rate ? g / (1 + rate) : g;
  return { gross: round2(g), rate, net: round2(net), vat: round2(g - net) };
}
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// What has actually been received against a register row. Voided receipts are
// excluded, so reversing a receipt puts the balance back where it was.
const COLLECTED = `COALESCE((SELECT SUM(r.amount) FROM erp_ar_receipts r
  WHERE r.collection_id=c.id AND r.status='ACTIVE'),0)`;

receivableRoutes.get('/lists', requirePermission('RECEIVABLES','VIEW'), async c => {
  const rows = await all(c.env.DB, `SELECT list_type,value FROM erp_ar_lists WHERE active=1
    ORDER BY list_type,sort_order,value`);
  const lists = {};
  rows.forEach(r => { (lists[r.list_type] = lists[r.list_type] || []).push(r.value); });
  const customers = await all(c.env.DB, `SELECT id,partner_code,name FROM erp_partners
    WHERE partner_type IN ('CUSTOMER','EMPLOYEE') ORDER BY name LIMIT 500`);
  return ok(c, { lists, streams: STREAMS, customers });
});

/* ------------------------------------------------------------- register */
receivableRoutes.get('/collections', requirePermission('RECEIVABLES','VIEW'), async c => {
  const { page, size, offset } = pageParams(c);
  const stream = normalizeText(c.req.query('stream'));
  const status = normalizeText(c.req.query('status'));
  const from = normalizeText(c.req.query('from'));
  const to = normalizeText(c.req.query('to'));
  const q = `%${normalizeText(c.req.query('q'))}%`;
  const where = []; const args = [];
  if (stream) { where.push('stream=?'); args.push(stream); }
  if (status) { where.push('status=?'); args.push(status); }
  if (from) { where.push('txn_date>=?'); args.push(from); }
  if (to) { where.push('txn_date<=?'); args.push(to); }
  if (q !== '%%') { where.push('(customer_name LIKE ? OR entry_no LIKE ? OR document_no LIKE ? OR description LIKE ?)');
    args.push(q, q, q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Collected comes from the receipts table rather than a stored column, so the
  // register can never drift from the receipts that back it.
  const rows = await all(c.env.DB, `SELECT c.*, ${COLLECTED} collected,
      c.gross_amount - ${COLLECTED} balance
    FROM erp_ar_collections c ${w}
    ORDER BY c.txn_date DESC, c.id DESC LIMIT ? OFFSET ?`, [...args, size, offset]);
  const totals = await first(c.env.DB, `SELECT COUNT(*) n,
      COALESCE(SUM(gross_amount),0) gross, COALESCE(SUM(net_amount),0) net,
      COALESCE(SUM(output_vat),0) vat,
      COALESCE(SUM(CASE WHEN status='POSTED' THEN gross_amount END),0) posted,
      COALESCE(SUM(CASE WHEN status='DRAFT'  THEN gross_amount END),0) draft,
      COALESCE(SUM(CASE WHEN cleared_status='CLEARED' THEN gross_amount END),0) cleared
    FROM erp_ar_collections ${w}`, args);
  const byStream = await all(c.env.DB, `SELECT stream label, COALESCE(SUM(gross_amount),0) value,
    COUNT(*) n FROM erp_ar_collections ${w} GROUP BY stream ORDER BY value DESC`, args);
  const byMethod = await all(c.env.DB, `SELECT COALESCE(NULLIF(payment_method,''),'Unspecified') label,
    COALESCE(SUM(gross_amount),0) value FROM erp_ar_collections ${w} GROUP BY label ORDER BY value DESC`, args);
  return ok(c, { rows, page, size, total: Number(totals?.n || 0), totals, byStream, byMethod, streams: STREAMS });
});

receivableRoutes.post('/collections', requirePermission('RECEIVABLES','CREATE'), async c => {
  const b = await jsonBody(c);
  if (!normalizeText(b.customerName)) return fail(c, 'Customer is required');
  if (!normalizeText(b.txnDate)) return fail(c, 'Transaction date is required');
  const stream = normalizeText(b.stream).toUpperCase();
  if (!STREAMS[stream]) return fail(c, 'Pick a revenue stream');
  const v = vatSplit(b.grossAmount, normalizeText(b.vatType) || 'VATable', b.vatRate);
  const no = normalizeText(b.entryNo) || await nextCode(c.env.DB, 'AR_COLLECTION', 'AR-2026', 5);
  const r = await run(c.env.DB, `INSERT INTO erp_ar_collections(entry_no,stream,txn_date,sales_type,
      document_no,customer_id,customer_name,contract_ref,unit_count,department,cost_center,account_title,
      description,gross_amount,vat_type,vat_rate,net_amount,output_vat,payment_method,bank_wallet,
      bank_ref,other_ref,settlement_date,cleared_status,sales_order_id,sales_order_no,status,
      prepared_by,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?)`,
    [no, stream, normalizeText(b.txnDate), normalizeText(b.salesType), normalizeText(b.documentNo),
     b.customerId ? Number(b.customerId) : null, normalizeText(b.customerName), normalizeText(b.contractRef),
     numberValue(b.unitCount), normalizeText(b.department), normalizeText(b.costCenter),
     normalizeText(b.accountTitle), normalizeText(b.description), v.gross,
     normalizeText(b.vatType) || 'VATable', v.rate, v.net, v.vat, normalizeText(b.paymentMethod),
     normalizeText(b.bankWallet), normalizeText(b.bankRef), normalizeText(b.otherRef),
     normalizeText(b.settlementDate), normalizeText(b.clearedStatus) || 'PENDING',
     b.salesOrderId ? Number(b.salesOrderId) : null, normalizeText(b.salesOrderNo),
     normalizeText(b.preparedBy) || c.get('erpUser').email, normalizeText(b.notes), c.get('erpUser').email]);
  await audit(c, { action:'CREATE', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:r.meta.last_row_id, recordNo:no, after:{ stream, gross:v.gross } });
  return ok(c, { id: r.meta.last_row_id, entryNo: no, ...v }, 201);
});

// Editable while draft. A posted row is history, and history is not edited.
receivableRoutes.patch('/collections/:id', requirePermission('RECEIVABLES','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const before = await first(c.env.DB, `SELECT * FROM erp_ar_collections WHERE id=?`, [id]);
  if (!before) return fail(c, 'Collection not found', 404);
  if (before.status !== 'DRAFT')
    return fail(c, `This entry is ${before.status.toLowerCase()} and can no longer be edited. Void it instead.`, 409);

  const pick = (k, fallback) => b[k] === undefined ? fallback : normalizeText(b[k]);
  const gross = b.grossAmount === undefined ? before.gross_amount : numberValue(b.grossAmount);
  const vatType = pick('vatType', before.vat_type) || 'VATable';
  const v = vatSplit(gross, vatType, b.vatRate === undefined ? before.vat_rate : b.vatRate);
  await run(c.env.DB, `UPDATE erp_ar_collections SET stream=?,txn_date=?,sales_type=?,document_no=?,
      customer_id=?,customer_name=?,contract_ref=?,unit_count=?,department=?,cost_center=?,account_title=?,
      description=?,gross_amount=?,vat_type=?,vat_rate=?,net_amount=?,output_vat=?,payment_method=?,
      bank_wallet=?,bank_ref=?,other_ref=?,settlement_date=?,cleared_status=?,notes=?,
      updated_at=datetime('now') WHERE id=?`,
    [pick('stream', before.stream).toUpperCase(), pick('txnDate', before.txn_date),
     pick('salesType', before.sales_type), pick('documentNo', before.document_no),
     b.customerId === undefined ? before.customer_id : (b.customerId ? Number(b.customerId) : null),
     pick('customerName', before.customer_name), pick('contractRef', before.contract_ref),
     b.unitCount === undefined ? before.unit_count : numberValue(b.unitCount),
     pick('department', before.department), pick('costCenter', before.cost_center),
     pick('accountTitle', before.account_title), pick('description', before.description),
     v.gross, vatType, v.rate, v.net, v.vat,
     pick('paymentMethod', before.payment_method), pick('bankWallet', before.bank_wallet),
     pick('bankRef', before.bank_ref), pick('otherRef', before.other_ref),
     pick('settlementDate', before.settlement_date), pick('clearedStatus', before.cleared_status) || 'PENDING',
     pick('notes', before.notes), id]);
  const after = await first(c.env.DB, `SELECT * FROM erp_ar_collections WHERE id=?`, [id]);
  await audit(c, { action:'EDIT', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:id, recordNo:after.entry_no, before, after });
  return ok(c, { collection: after });
});

receivableRoutes.delete('/collections/:id', requirePermission('RECEIVABLES','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const row = await first(c.env.DB, `SELECT * FROM erp_ar_collections WHERE id=?`, [id]);
  if (!row) return fail(c, 'Collection not found', 404);
  if (row.status !== 'DRAFT') return fail(c, 'Only a draft entry can be removed. Void a posted entry instead.', 409);
  await run(c.env.DB, `DELETE FROM erp_ar_collections WHERE id=?`, [id]);
  await audit(c, { action:'DELETE', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:id, recordNo:row.entry_no, before:row });
  return ok(c, { removed: row.entry_no });
});

/* ---------------------------------------------------------------- post */
/*
 * Posting is what makes a record money, so Finance does it and a posted row
 * stops being editable. Posting in bulk is the normal case - a month of
 * receipts is reviewed together - so this takes one id or many.
 */
receivableRoutes.post('/collections/post', requirePermission('RECEIVABLES','POST'), async c => {
  if (!isFinance(c)) return fail(c, 'Only Finance can post a collection.', 403);
  const b = await jsonBody(c);
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean);
  if (!ids.length) return fail(c, 'Select at least one entry to post.');
  const user = c.get('erpUser').email;
  const posted = []; const skipped = [];
  for (const id of ids) {
    const row = await first(c.env.DB, `SELECT * FROM erp_ar_collections WHERE id=?`, [id]);
    if (!row) { skipped.push({ id, reason:'not found' }); continue; }
    if (row.status !== 'DRAFT') { skipped.push({ id, entryNo:row.entry_no, reason:`already ${row.status.toLowerCase()}` }); continue; }
    if (!(Number(row.gross_amount) > 0)) { skipped.push({ id, entryNo:row.entry_no, reason:'no amount' }); continue; }
    await run(c.env.DB, `UPDATE erp_ar_collections SET status='POSTED',posted_by=?,posted_at=datetime('now'),
      updated_at=datetime('now') WHERE id=?`, [user, id]);
    posted.push(row.entry_no);
  }
  await audit(c, { action:'POST', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:ids[0], recordNo:posted[0] || '', after:{ posted:posted.length, skipped:skipped.length } });
  return ok(c, { posted, skipped });
});

// A posted entry is corrected by voiding it with a reason, never by editing.
receivableRoutes.post('/collections/:id/void', requirePermission('RECEIVABLES','POST'), async c => {
  if (!isFinance(c)) return fail(c, 'Only Finance can void a posted collection.', 403);
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const reason = normalizeText(b.reason);
  if (!reason) return fail(c, 'A void needs a reason.');
  const row = await first(c.env.DB, `SELECT * FROM erp_ar_collections WHERE id=?`, [id]);
  if (!row) return fail(c, 'Collection not found', 404);
  if (row.status !== 'POSTED') return fail(c, 'Only a posted entry can be voided.', 409);
  await run(c.env.DB, `UPDATE erp_ar_collections SET status='VOID',void_reason=?,updated_at=datetime('now')
    WHERE id=?`, [reason, id]);
  await audit(c, { action:'VOID', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:id, recordNo:row.entry_no, before:row, after:{ reason } });
  return ok(c, { voided: row.entry_no, reason });
});

/* ---------------------------------------------------------- collections */
/*
 * A posted entry is what the customer owes. Collection is what they paid, and
 * the two are deliberately separate records: a bill is one event on one date,
 * payment can be several on other dates, and either can be reversed without
 * disturbing the other. So the Collection action only exists once an entry is
 * posted - there is nothing to collect against a draft.
 */
receivableRoutes.get('/collections/:id/receipts', requirePermission('RECEIVABLES','VIEW'), async c => {
  const id = Number(c.req.param('id'));
  const row = await first(c.env.DB, `SELECT c.*, ${COLLECTED} collected,
      c.gross_amount - ${COLLECTED} balance FROM erp_ar_collections c WHERE c.id=?`, [id]);
  if (!row) return fail(c, 'Entry not found', 404);
  const receipts = await all(c.env.DB, `SELECT * FROM erp_ar_receipts WHERE collection_id=?
    ORDER BY receipt_date DESC, id DESC`, [id]);
  return ok(c, { collection: row, receipts });
});

receivableRoutes.post('/collections/:id/collect', requirePermission('RECEIVABLES','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const row = await first(c.env.DB, `SELECT c.*, ${COLLECTED} collected FROM erp_ar_collections c
    WHERE c.id=?`, [id]);
  if (!row) return fail(c, 'Entry not found', 404);
  if (row.status !== 'POSTED')
    return fail(c, 'Post the entry first. A collection is recorded against a posted receivable.', 409);

  const amount = round2(numberValue(b.amount));
  if (!(amount > 0)) return fail(c, 'Enter the amount received.');
  const balance = round2(Number(row.gross_amount || 0) - Number(row.collected || 0));
  // Overpayment is a different transaction with different accounting. It is
  // refused here rather than silently absorbed into the receivable.
  if (amount > balance + 0.005)
    return fail(c, `That is more than the ${balance.toFixed(2)} still outstanding on ${row.entry_no}.`, 409);
  if (!normalizeText(b.receiptDate)) return fail(c, 'Collection date is required');

  const no = await nextCode(c.env.DB, 'AR_RECEIPT', 'OR-2026', 5);
  const r = await run(c.env.DB, `INSERT INTO erp_ar_receipts(receipt_no,collection_id,entry_no,receipt_date,
      amount,payment_method,bank_wallet,bank_ref,or_no,settlement_date,cleared_status,remarks,
      received_by,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no, id, row.entry_no, normalizeText(b.receiptDate), amount,
     normalizeText(b.paymentMethod) || row.payment_method, normalizeText(b.bankWallet) || row.bank_wallet,
     normalizeText(b.bankRef), normalizeText(b.orNo), normalizeText(b.settlementDate),
     normalizeText(b.clearedStatus) || 'PENDING', normalizeText(b.remarks),
     normalizeText(b.receivedBy) || c.get('erpUser').email, c.get('erpUser').email]);

  // The register row carries the settlement state of its latest collection, so
  // the list can be read without opening every entry.
  const after = round2(Number(row.collected || 0) + amount);
  await run(c.env.DB, `UPDATE erp_ar_collections SET cleared_status=?,settlement_date=?,
      updated_at=datetime('now') WHERE id=?`,
    [normalizeText(b.clearedStatus) || 'PENDING',
     normalizeText(b.settlementDate) || row.settlement_date, id]);
  await audit(c, { action:'COLLECT', module:'FINANCE', recordType:'AR_RECEIPT',
    recordId:r.meta.last_row_id, recordNo:no,
    after:{ entryNo:row.entry_no, amount, collected:after, balance: round2(Number(row.gross_amount||0) - after) } });
  return ok(c, { id:r.meta.last_row_id, receiptNo:no, amount,
    collected:after, balance: round2(Number(row.gross_amount || 0) - after) }, 201);
});

receivableRoutes.post('/receipts/:id/void', requirePermission('RECEIVABLES','POST'), async c => {
  if (!isFinance(c)) return fail(c, 'Only Finance can reverse a collection.', 403);
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const reason = normalizeText(b.reason);
  if (!reason) return fail(c, 'A reversal needs a reason.');
  const row = await first(c.env.DB, `SELECT * FROM erp_ar_receipts WHERE id=?`, [id]);
  if (!row) return fail(c, 'Collection not found', 404);
  if (row.status !== 'ACTIVE') return fail(c, 'This collection is already reversed.', 409);
  await run(c.env.DB, `UPDATE erp_ar_receipts SET status='VOID',void_reason=?,updated_at=datetime('now')
    WHERE id=?`, [reason, id]);
  await audit(c, { action:'VOID', module:'FINANCE', recordType:'AR_RECEIPT',
    recordId:id, recordNo:row.receipt_no, before:row, after:{ reason } });
  return ok(c, { voided: row.receipt_no, reason });
});

/* ------------------------------------------------- from an order to cash */
/*
 * The link the client asked for: a sales order becomes a receivable here, so
 * the order is where the deal is agreed and this is where it is settled.
 */
receivableRoutes.post('/from-sales-order/:id', requirePermission('RECEIVABLES','CREATE'), async c => {
  const soId = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const so = await first(c.env.DB, `SELECT s.*,p.name customer_name FROM erp_sales_orders s
    LEFT JOIN erp_partners p ON p.id=s.customer_id WHERE s.id=?`, [soId]);
  if (!so) return fail(c, 'Sales order not found', 404);
  const existing = await first(c.env.DB, `SELECT id,entry_no FROM erp_ar_collections WHERE sales_order_id=?`, [soId]);
  if (existing) return fail(c, `${so.sales_order_no} is already on the receivables register as ${existing.entry_no}.`, 409);

  const streamByType = { SALE:'MC_SOLD', LEASE:'MC_LEASED', DEMO:'AFTERSALES',
    PILOT:'AFTERSALES', EMPLOYEE_ASSIGNMENT:'AFTERSALES' };
  const stream = normalizeText(b.stream).toUpperCase() || streamByType[so.transaction_type] || 'MC_SOLD';
  const gross = b.grossAmount === undefined ? Number(so.gross_amount || 0) : numberValue(b.grossAmount);
  const v = vatSplit(gross, normalizeText(b.vatType) || 'VATable', b.vatRate);
  const no = await nextCode(c.env.DB, 'AR_COLLECTION', 'AR-2026', 5);
  const r = await run(c.env.DB, `INSERT INTO erp_ar_collections(entry_no,stream,txn_date,sales_type,
      document_no,customer_id,customer_name,contract_ref,gross_amount,vat_type,vat_rate,net_amount,
      output_vat,payment_method,sales_order_id,sales_order_no,status,description,prepared_by,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?)`,
    [no, stream, normalizeText(b.txnDate) || so.order_date || new Date().toISOString().slice(0,10),
     so.transaction_type === 'LEASE' ? 'Leased' : 'Sold', normalizeText(b.documentNo),
     so.customer_id, so.customer_name || 'Customer', so.sales_order_no,
     v.gross, normalizeText(b.vatType) || 'VATable', v.rate, v.net, v.vat,
     normalizeText(b.paymentMethod), soId, so.sales_order_no,
     `From sales order ${so.sales_order_no}`, c.get('erpUser').email, c.get('erpUser').email]);
  await audit(c, { action:'CREATE_FROM_SO', module:'FINANCE', recordType:'AR_COLLECTION',
    recordId:r.meta.last_row_id, recordNo:no, after:{ salesOrderNo:so.sales_order_no, gross:v.gross } });
  return ok(c, { id:r.meta.last_row_id, entryNo:no, salesOrderNo:so.sales_order_no }, 201);
});

/* --------------------------------------------------------------- summary */
receivableRoutes.get('/summary', requirePermission('RECEIVABLES','VIEW'), async c => {
  const from = normalizeText(c.req.query('from'));
  const to = normalizeText(c.req.query('to'));
  const w = []; const args = [];
  if (from) { w.push('txn_date>=?'); args.push(from); }
  if (to) { w.push('txn_date<=?'); args.push(to); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  // Billed is the posted register. Collected is what came in against it. The
  // two percentages are the same pair of numbers seen from either end, so they
  // cannot disagree with each other or with the rows underneath.
  const receiptWhere = w.length
    ? `WHERE c.id IS NOT NULL AND ${w.map(x => 'c.' + x).join(' AND ')}` : '';
  const [totals, byStream, byMonth, byCustomer, billed, received] = await Promise.all([
    first(c.env.DB, `SELECT COUNT(*) n, COALESCE(SUM(gross_amount),0) gross,
        COALESCE(SUM(net_amount),0) net, COALESCE(SUM(output_vat),0) vat,
        COALESCE(SUM(CASE WHEN status='POSTED' THEN gross_amount END),0) posted,
        COALESCE(SUM(CASE WHEN status='DRAFT' THEN gross_amount END),0) draft,
        COUNT(CASE WHEN status='DRAFT' THEN 1 END) draftCount
      FROM erp_ar_collections ${where} ${where?'AND':'WHERE'} status<>'VOID'`, args),
    all(c.env.DB, `SELECT stream label, COALESCE(SUM(gross_amount),0) value FROM erp_ar_collections
      ${where} ${where?'AND':'WHERE'} status<>'VOID' GROUP BY stream ORDER BY value DESC`, args),
    all(c.env.DB, `SELECT substr(txn_date,1,7) label, COALESCE(SUM(gross_amount),0) value
      FROM erp_ar_collections ${where} ${where?'AND':'WHERE'} status<>'VOID'
      GROUP BY label ORDER BY label`, args),
    all(c.env.DB, `SELECT customer_name label, COALESCE(SUM(gross_amount),0) value
      FROM erp_ar_collections ${where} ${where?'AND':'WHERE'} status<>'VOID'
      GROUP BY customer_name ORDER BY value DESC LIMIT 8`, args),
    first(c.env.DB, `SELECT COALESCE(SUM(gross_amount),0) v, COUNT(*) n FROM erp_ar_collections
      ${where} ${where?'AND':'WHERE'} status='POSTED'`, args),
    first(c.env.DB, `SELECT COALESCE(SUM(r.amount),0) v FROM erp_ar_receipts r
      JOIN erp_ar_collections c ON c.id=r.collection_id
      ${receiptWhere} ${receiptWhere?'AND':'WHERE'} r.status='ACTIVE' AND c.status='POSTED'`, args),
  ]);
  const billedV = Number(billed?.v || 0);
  const collectedV = Number(received?.v || 0);
  const outstandingV = round2(billedV - collectedV);
  return ok(c, { totals, byStream, byMonth, byCustomer, streams: STREAMS,
    billed: billedV, billedCount: Number(billed?.n || 0), collected: collectedV,
    outstanding: outstandingV,
    // Undefined rather than zero when nothing is posted: 0% collection on no
    // billing reads as a failure rather than as no activity.
    collectionPct: billedV > 0 ? (collectedV / billedV) * 100 : null,
    receivablesPct: billedV > 0 ? (outstandingV / billedV) * 100 : null });
});
