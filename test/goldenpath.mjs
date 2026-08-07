// Blitz - ERP · golden path
//
//   node test/goldenpath.mjs
//
// Walks one request for payment from Draft to Paid through the real Hono app
// (src/index.js) and a database built from the real migrations, using the live
// configuration: MANCOM off, separation of duties on, signature mandatory,
// role gate off. Then walks a cash advance from Draft to Liquidated.
//
// Every step is performed by the person who would perform it in the office, so
// the separation-of-duties rules are genuinely exercised rather than bypassed.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, '.blitz-goldenpath.sqlite');
try { rmSync(DB_PATH, { force: true }); } catch {}
const sqlite = new DatabaseSync(DB_PATH);
for (const f of readdirSync(join(ROOT, 'migrations')).filter(f => /^0\d+.*\.sql$/.test(f)).sort()) {
  sqlite.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
}

// The people. francis/haide/ferdinand come from migration 0041; the rest match
// the live erp_users table.
sqlite.exec(`
  INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active,admin_access) VALUES
    ('mmungcal@nrdev.ph','Mark Alexis Mungcal','FINANCE','Finance and Accounting',1,1),
    ('rhonrado@nrdev.ph','Rucel Mae Honrado','FINANCE_REVIEWER','Finance and Accounting',1,0),
    ('fin2@nrdev.ph','Second Finance','FINANCE','Finance and Accounting',1,0),
    ('judy@nrdev.ph','Judy Joy Rosare','SCM_MANAGER','Supply Chain',1,0),
    ('samuel@nrdev.ph','Samuel Kniazeff','SCM_HEAD','Supply Chain',1,0),
    ('erapatan@nrdev.ph','Emmanuelle Rapatan','STAFF','Sales and Marketing',1,0);
  UPDATE erp_users SET role_code='SCM_HEAD',department='Supply Chain' WHERE email='samuel@nrdev.ph';
  UPDATE erp_users SET role_code='FINANCE_REVIEWER' WHERE email='rhonrado@nrdev.ph';
  INSERT OR IGNORE INTO erp_locations(code,name,location_type) VALUES('WH-MAIN','Main Warehouse','WAREHOUSE');
  -- The vendor master record. Finance picks the payee from this droplist rather
  -- than free-typing a name, which is what links the RFP to the subledger.
  INSERT OR IGNORE INTO erp_partners(partner_code,partner_type,name,email,active)
    VALUES('SUP-000900','SUPPLIER','Prime Logistics Services Inc.','ar@primelogistics.example',1);
`);

function d1(db) {
  const wrap = (sql) => {
    const s = { _args: [] };
    s.bind = (...a) => { s._args = a.map(v => v === undefined ? null : v); return s; };
    s.first = async () => { const r = db.prepare(sql).get(...s._args); return r === undefined ? null : r; };
    s.all = async () => ({ results: db.prepare(sql).all(...s._args) });
    s.run = async () => { const r = db.prepare(sql).run(...s._args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; };
    return s;
  };
  return { prepare: wrap, batch: async (st) => { const o = []; for (const x of st) o.push(await x.run()); return o; }, exec: async (q) => { db.exec(q); return {}; } };
}
const env = { DB: d1(sqlite), ENVIRONMENT: 'test', ALLOWED_DOMAIN: 'nrdev.ph', APP_ADMIN_EMAIL: 'mmungcal@nrdev.ph', ALLOW_DEV_AUTH: 'true' };

const cookies = new Map();
async function as(who, method, path, body) {
  const init = { method, headers: { 'content-type': 'application/json', 'X-Dev-User': who } };
  if (cookies.get(who)) init.headers.cookie = cookies.get(who);
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request('http://localhost' + path, init), env, {});
  const setc = res.headers.get('set-cookie'); if (setc) cookies.set(who, setc.split(';')[0]);
  let json = null; try { json = await res.json(); } catch {}
  return json;
}

const NAMES = {
  'judy@nrdev.ph': 'Judy Joy Rosare (Requestor, Supply Chain)',
  'samuel@nrdev.ph': 'Samuel Kniazeff (Department Head, Supply Chain)',
  'mmungcal@nrdev.ph': 'Mark Alexis Mungcal (Finance)',
  'francis@nrdev.ph': 'Francis (CEO)',
  'rhonrado@nrdev.ph': 'Rucel Mae Honrado (Finance, checker)',
  'fin2@nrdev.ph': 'Second Finance',
};
let step = 0, failed = 0;
function log(who, what, detail) {
  step += 1;
  console.log(`\n${String(step).padStart(2, '0')}. ${what}`);
  console.log(`    who    ${NAMES[who] || who}`);
  if (detail) console.log(`    result ${detail}`);
}
function boom(what, err) { failed += 1; console.log(`\n  ✗ ${what}\n    ${err}`); }

console.log('='.repeat(74));
console.log(' Blitz - ERP  ·  golden path');
console.log(' Requestor -> Dept Head -> Finance check -> Head of Finance -> CEO -> Paid');
console.log('='.repeat(74));

// ---------------------------------------------------------------- configuration
const cfg = await as('mmungcal@nrdev.ph', 'GET', '/api/finance/payment-requests');
console.log(`\n    MANCOM tier ......... ${cfg.mancomEnabled ? 'ON at PHP ' + cfg.mancomMin : 'OFF (agreed in the MANCOM meeting)'}`);
console.log(`    Role gate ........... ${cfg.roleGate ? 'ON' : 'OFF (switch on once everyone has signed in once)'}`);
console.log(`    Separation of duties. ON`);
console.log(`    Signature to approve. required`);

// ---------------------------------------------------------------- 1. raise it
const bankSeed = sqlite.prepare('SELECT b.id,b.entity_id,b.bank_name FROM erp_bank_accounts b LIMIT 1').get();
const ent = bankSeed
  ? sqlite.prepare('SELECT entity_code FROM erp_legal_entities WHERE id=?').get(bankSeed.entity_id)
  : sqlite.prepare('SELECT entity_code FROM erp_legal_entities LIMIT 1').get();
const vendor = sqlite.prepare("SELECT id FROM erp_partners WHERE partner_code='SUP-000900'").get();
const created = await as('judy@nrdev.ph', 'POST', '/api/finance/payment-requests', {
  entityCode: ent.entity_code,
  payeePartnerId: vendor.id,
  payeeName: 'Prime Logistics Services Inc.',
  department: 'Supply Chain',
  purpose: 'Freight and handling, July shipments',
  requestType: 'Payment to Vendor',
  grossAmount: 48500,
  vatAmount: 5196.43,
  withholdingAmount: 970,
  supplierInvoiceNo: 'PLS-2026-0771',
  invoiceDate: '2026-07-28',
  dueDate: '2026-08-27',
  modeOfPayment: 'Bank Transfer',
  requestorName: 'Judy Joy Rosare',
  requestorSignature: 'Judy Joy Rosare',
  signatureType: 'TYPE',
  attachments: [{ fileName: 'PLS-2026-0771.pdf', contentType: 'application/pdf', size: 240, data: 'JVBERi0x' }],
});
if (!created?.ok) { boom('raise the request', created?.error); process.exit(1); }
const id = created.id;
log('judy@nrdev.ph', 'Raise the request for payment', `${created.requestNo} · net payable PHP ${created.netPayable.toLocaleString('en-US')} · 1 document attached`);

// ---------------------------------------------------------------- 2. rules bite
const noSig = await as('samuel@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, { action: 'DEPARTMENT_APPROVE' });
log('samuel@nrdev.ph', 'Try to approve a request that has not been submitted', noSig?.ok ? '!! ALLOWED' : noSig.error);
if (noSig?.ok) failed += 1;

const submitted = await as('judy@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, { action: 'SUBMIT', signature: 'Judy Joy Rosare', signatureType: 'TYPE' });
if (!submitted?.ok) { boom('submit', submitted?.error); } else {
  log('judy@nrdev.ph', 'Submit for approval', `status ${submitted.request.status} · department head notified`);
}

const selfApprove = await as('judy@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, { action: 'DEPARTMENT_APPROVE', signature: 'Judy Joy Rosare' });
log('judy@nrdev.ph', 'Try to approve her own request', selfApprove?.ok ? '!! ALLOWED' : selfApprove.error);
if (selfApprove?.ok) failed += 1;

const unsigned = await as('samuel@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, { action: 'DEPARTMENT_APPROVE' });
log('samuel@nrdev.ph', 'Try to approve without signing', unsigned?.ok ? '!! ALLOWED' : unsigned.error);
if (unsigned?.ok) failed += 1;

// ---------------------------------------------------------------- 3. the chain
const dept = await as('samuel@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'DEPARTMENT_APPROVE', signature: 'Samuel Kniazeff', signatureType: 'TYPE', notes: 'Freight rates match the contract.' });
if (!dept?.ok) boom('department approval', dept?.error);
else log('samuel@nrdev.ph', 'Department Head approval', `status ${dept.request.status} · Finance notified`);

const twoStages = await as('samuel@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, { action: 'FINANCE_VALIDATE', signature: 'Samuel Kniazeff' });
log('samuel@nrdev.ph', 'Try to also sign the Finance stage', twoStages?.ok ? '!! ALLOWED' : twoStages.error);
if (twoStages?.ok) failed += 1;

const headEarly = await as('mmungcal@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'FINANCE_VALIDATE', signature: 'Mark Alexis Mungcal' });
log('mmungcal@nrdev.ph', 'Try to approve as head of Finance before it has been checked',
  headEarly?.ok ? '!! ALLOWED' : headEarly.error);
if (headEarly?.ok) failed += 1;

const chk = await as('rhonrado@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'FINANCE_REVIEW', signature: 'Rucel Mae Honrado', signatureType: 'TYPE',
  notes: 'Quotation, invoice and department approval all present.' });
if (!chk?.ok) boom('finance check', chk?.error);
else log('rhonrado@nrdev.ph', 'Finance checks the documents and the department approval',
  `status ${chk.request.status} · head of Finance notified`);

const checkerApproves = await as('rhonrado@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'FINANCE_VALIDATE', signature: 'Rucel Mae Honrado' });
log('rhonrado@nrdev.ph', 'Try to approve the request she just checked',
  checkerApproves?.ok ? '!! ALLOWED' : checkerApproves.error);
if (checkerApproves?.ok) failed += 1;

const fin = await as('mmungcal@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'FINANCE_VALIDATE', signature: 'Mark Alexis Mungcal', signatureType: 'TYPE', notes: 'Approved for payment.' });
if (!fin?.ok) boom('head of Finance approval', fin?.error);
else log('mmungcal@nrdev.ph', 'Head of Finance approval', `status ${fin.request.status} · CEO notified`);

const wf = await as('mmungcal@nrdev.ph', 'GET', `/api/finance/payment-requests/${id}`);
log('mmungcal@nrdev.ph', 'Check what is still outstanding', `stages ${wf.workflow.stages.join(' > ')} · next ${wf.workflow.nextStage} · attachments locked: ${!wf.workflow.attachmentsEditable}`);
if (wf.workflow.stages.includes('MANCOM')) { boom('MANCOM appeared', 'the tier should be off'); }

const lateFile = await as('judy@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/attachments`, {
  attachments: [{ fileName: 'sneaky.pdf', contentType: 'application/pdf', size: 10, data: 'AAAA' }] });
log('judy@nrdev.ph', 'Try to slip in another document after approval', lateFile?.ok ? '!! ALLOWED' : lateFile.error);
if (lateFile?.ok) failed += 1;

const ceo = await as('francis@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
  action: 'FINAL_APPROVE', accountCode: '6990', signature: 'Francis', signatureType: 'TYPE' });
if (!ceo?.ok) boom('CEO approval', ceo?.error);
else log('francis@nrdev.ph', 'CEO final approval', `status ${ceo.request.status} · supplier bill raised and posted · Finance notified`);

// ---------------------------------------------------------------- 4. the books
// FINAL_APPROVE raises the supplier bill and its journal entry. Finance still
// has to submit, approve and post that journal before money can move - the ERP
// refuses to prepare a payment against an unposted bill.
// The ledger has its own maker-checker: whoever prepared or submitted a journal
// cannot approve it. So the approver is chosen to be somebody else in Finance.
async function postJournalFor(docId, label) {
  const doc = sqlite.prepare('SELECT journal_id FROM erp_subledger_documents WHERE id=?').get(docId);
  if (!doc?.journal_id) return `no journal on ${label}`;
  const j = doc.journal_id;
  const st = () => sqlite.prepare('SELECT journal_no,status,created_by,submitted_by FROM erp_journal_headers WHERE id=?').get(j);
  // Whoever counter-signs a journal must be able to POST it. Rucel checks RFPs
  // but holds no ledger posting rights, so the second signer has to be another
  // Finance approver.
  const FIN = ['mmungcal@nrdev.ph', 'fin2@nrdev.ph'];
  const preparer = st().created_by;
  const submitter = FIN.find(u => u !== preparer) || FIN[0];
  if (st().status === 'DRAFT') await as(submitter, 'POST', `/api/finance/journals/${j}/action`, { action: 'SUBMIT' });
  const checker = FIN.find(u => u !== st().created_by && u !== st().submitted_by);
  if (!checker) return `${st().journal_no} needs a second Finance approver`;
  if (st().status !== 'POSTED') await as(checker, 'POST', `/api/finance/journals/${j}/action`, { action: 'APPROVE' });
  if (st().status !== 'POSTED') await as(checker, 'POST', `/api/finance/journals/${j}/action`, { action: 'POST' });
  const f = st();
  return `${f.journal_no} ${f.status} · prepared by ${f.created_by.split('@')[0]}, approved by ${checker.split('@')[0]}`;
}
const afterCeo = sqlite.prepare('SELECT supplier_bill_id FROM erp_payment_requests WHERE id=?').get(id);
const billState = await postJournalFor(afterCeo.supplier_bill_id, 'supplier bill');
log('mmungcal@nrdev.ph', 'Approve and post the supplier-bill journal', billState);
if (!String(billState).includes('POSTED')) failed += 1;

// ---------------------------------------------------------------- 5. pay it
const bank = bankSeed;
if (!bank) {
  console.log('\n    (no bank account configured in this database — payment steps skipped)');
} else {
  const prep = await as('mmungcal@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
    action: 'MARK_PAID', bankAccountId: bank.id, paymentReference: 'BT-2026-0810',
    bankInstructionEmail: 'treasury@bank.example', signature: 'Mark Alexis Mungcal' });
  if (!prep?.ok) boom('prepare payment', prep?.error);
  else log('mmungcal@nrdev.ph', 'Prepare payment and instruct the bank', `status ${prep.request.status} · ref BT-2026-0810 · ${bank.bank_name || 'bank'}`);

  const payDoc = sqlite.prepare('SELECT payment_document_id FROM erp_payment_requests WHERE id=?').get(id);
  const payState = await postJournalFor(payDoc.payment_document_id, 'supplier payment');
  log('mmungcal@nrdev.ph', 'Approve and post the disbursement journal', payState);
  if (!String(payState).includes('POSTED')) failed += 1;

  const paid = await as('mmungcal@nrdev.ph', 'POST', `/api/finance/payment-requests/${id}/action`, {
    action: 'CONFIRM_PAID', proofReference: 'OR-99213',
    attachments: [{ fileName: 'proof-of-payment.pdf', contentType: 'application/pdf', size: 180, data: 'JVBERi0x' }] });
  if (!paid?.ok) boom('confirm payment', paid?.error);
  else log('mmungcal@nrdev.ph', 'Confirm payment and attach the proof', `status ${paid.request.status} · requestor notified`);
}

// ---------------------------------------------------------------- 6. the trail
const finalState = await as('mmungcal@nrdev.ph', 'GET', `/api/finance/payment-requests/${id}`);
console.log('\n' + '-'.repeat(74));
console.log(' Approval trail as it will print on the form');
console.log('-'.repeat(74));
for (const s of finalState.signatures || []) {
  const mark = s.signature ? (String(s.signature).startsWith('data:image/') ? '[drawn]' : s.signature) : '—';
  console.log(`   ${String(s.stage).padEnd(12)} ${String(s.decision).padEnd(9)} ${String(s.actor_name || s.actor).padEnd(24)} ${mark}`);
}
console.log(`\n   Documents on file: ${(finalState.attachments || []).map(a => a.file_name).join(', ') || 'none'}`);
console.log(`   Final status:      ${finalState.request.status}`);

// ---------------------------------------------------------------- 7. cash advance
console.log('\n' + '='.repeat(74));
console.log(' Golden path 2  ·  cash advance and liquidation');
console.log('='.repeat(74));
step = 0;

const ca = await as('judy@nrdev.ph', 'POST', '/api/finance/payment-requests', {
  entityCode: ent.entity_code, payeeName: 'Judy Joy Rosare', department: 'Supply Chain',
  purpose: 'Cash advance - provincial delivery run', requestType: 'Cash Advance',
  grossAmount: 15000, requestorName: 'Judy Joy Rosare', requestorSignature: 'Judy Joy Rosare', signatureType: 'TYPE',
});
if (!ca?.ok) { boom('raise cash advance', ca?.error); } else {
  log('judy@nrdev.ph', 'Request a cash advance', `${ca.requestNo} · PHP ${ca.netPayable.toLocaleString('en-US')} · cashAdvance=${ca.cashAdvance}`);
}

const early = await as('judy@nrdev.ph', 'POST', '/api/finance/liquidations', { paymentRequestId: ca.id });
log('judy@nrdev.ph', 'Try to liquidate before it is approved', early?.ok ? '!! ALLOWED' : early.error);
if (early?.ok) failed += 1;

await as('judy@nrdev.ph', 'POST', `/api/finance/payment-requests/${ca.id}/action`, { action: 'SUBMIT', signature: 'Judy Joy Rosare' });
await as('samuel@nrdev.ph', 'POST', `/api/finance/payment-requests/${ca.id}/action`, { action: 'DEPARTMENT_APPROVE', signature: 'Samuel Kniazeff' });
await as('rhonrado@nrdev.ph', 'POST', `/api/finance/payment-requests/${ca.id}/action`, { action: 'FINANCE_REVIEW', signature: 'Rucel Mae Honrado' });
await as('mmungcal@nrdev.ph', 'POST', `/api/finance/payment-requests/${ca.id}/action`, { action: 'FINANCE_VALIDATE', signature: 'Mark Alexis Mungcal' });
const caCeo = await as('francis@nrdev.ph', 'POST', `/api/finance/payment-requests/${ca.id}/action`, { action: 'FINAL_APPROVE', signature: 'Francis' });
log('francis@nrdev.ph', 'Advance approved through the same chain', caCeo?.ok ? `status ${caCeo.request.status}` : caCeo.error);
if (!caCeo?.ok) failed += 1;

const liq = await as('judy@nrdev.ph', 'POST', '/api/finance/liquidations', { paymentRequestId: ca.id });
if (!liq?.ok) boom('open liquidation', liq?.error);
else log('judy@nrdev.ph', 'Open the liquidation', liq.liquidationNo);

if (liq?.ok) {
  const lines = await as('judy@nrdev.ph', 'POST', `/api/finance/liquidations/${liq.id}/lines`, { lines: [
    { expenseDate: '2026-08-02', particulars: 'Diesel, Batangas run', amount: 4200, receiptNo: 'OR-4471' },
    { expenseDate: '2026-08-02', particulars: 'Toll and parking', amount: 860, receiptNo: 'OR-4472' },
    { expenseDate: '2026-08-03', particulars: 'Driver meals and lodging', amount: 3150, receiptNo: 'OR-4473' },
  ] });
  if (!lines?.ok) boom('liquidation lines', lines?.error);
  else log('judy@nrdev.ph', 'Enter the receipts', `spent PHP ${lines.spent.toLocaleString('en-US')} of PHP ${lines.advance.toLocaleString('en-US')} · PHP ${lines.variance.toLocaleString('en-US')} to return`);

  const sub = await as('judy@nrdev.ph', 'POST', `/api/finance/liquidations/${liq.id}/submit`, {});
  log('judy@nrdev.ph', 'Submit the liquidation', sub?.ok ? `status ${sub.status}` : sub.error);
  const rev = await as('mmungcal@nrdev.ph', 'POST', `/api/finance/liquidations/${liq.id}/review`, { decision: 'APPROVE', remarks: 'Receipts complete.' });
  log('mmungcal@nrdev.ph', 'Finance reviews and closes it', rev?.ok ? `status ${rev.status}` : rev.error);
  if (!rev?.ok) failed += 1;
}

console.log('\n' + '='.repeat(74));
console.log(failed === 0
  ? ' GOLDEN PATH CLEAN — every step behaved, every rule held.'
  : ` ${failed} step(s) did not behave as expected — see the ✗ marks above.`);
console.log('='.repeat(74) + '\n');
try { rmSync(DB_PATH, { force: true }); } catch {}
process.exit(failed === 0 ? 0 : 1);
