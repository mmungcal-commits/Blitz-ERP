/*
 * Renders the payment register and the payments card in Chromium.
 *
 * This is the screen that has to say, without being opened, that a nine million
 * peso supply order is 30% paid and the rest is still owed, and that 318 of the
 * payments loaded from the 2026 register have a cheque number and no document
 * behind them. All of that reads fine in source and comes out wrong on the
 * page: a column landing under the wrong header, a badge that says PAID in
 * green over an open balance, a button that never binds. Only painting it
 * tells.
 *
 *   node test/rfp-payments-render.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const SHOTS = fileURLToPath(new URL('./__screens__/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };

const GROUPS = [{ code:'fa', title:'Finance & Accounting', items:[
  { code:'fa-receivables-payables', label:'Payables Management', permission:'FINANCE', action:'VIEW' },
]}];
const SESSION = { ok:true,
  user:{ email:'mmungcal@nrdev.ph', displayName:'Mark Alexis Mungcal', preferredName:'Alexis',
    role:'FINANCE', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess:[{ module_code:'fa-receivables-payables', can_view:1, can_create:1, can_edit:1, can_approve:1, can_post:1 }],
  workspaceCatalog:{ groups:GROUPS, tools:[], addons:[] } };

/*
 * One of each shape: part paid, paid on a register reference with no document,
 * settled in full and evidenced, and never paid at all.
 */
const ROWS = [
  { id:101, request_no:'RFP-OPS2026-00101', request_date:'2026-07-28', payee_name:'XIAMEN AMPACE TECHNOLOGY LIMITED',
    department:'Operations', account_title:'Inventory Purchase', account_count:1, purchase_order_no:'',
    net_payable:9302256, status:'PARTIALLY_PAID', settled_amount:2790676.80, settlement_count:1,
    settlements_without_proof:1 },
  { id:102, request_no:'RFP-HRA2026-0088', request_date:'2026-04-02', payee_name:'HAIDE R GARCIA',
    department:'HR and Admin', account_title:'Office supplies', account_count:2, purchase_order_no:'',
    net_payable:10675.81, status:'PAID', settled_amount:10675.81, settlement_count:1,
    settlements_without_proof:1 },
  { id:103, request_no:'RFP-FIN2026-0004', request_date:'2026-05-11', payee_name:'MERALCO',
    department:'Finance', account_title:'Utilities', account_count:1, purchase_order_no:'PO-2026-0007',
    net_payable:88000, status:'PAID', settled_amount:88000, settlement_count:1,
    settlements_without_proof:0 },
  { id:104, request_no:'RFP-OPS2026-0100', request_date:'2026-07-31', payee_name:'Judy Joy Rosare',
    department:'Operations', account_title:'Transportation', account_count:1, purchase_order_no:'',
    net_payable:1050, status:'DRAFT', settled_amount:0, settlement_count:0, settlements_without_proof:0 },
];

const DETAIL = {
  ok:true,
  request:ROWS[0],
  attachments:[], lines:[], byAccount:[], liquidation:null, signatures:[],
  workflow:{ mancomEnabled:false, mancomMin:null, mancomRequired:false, financeReview:true,
    stages:[], nextStage:null, attachmentsEditable:false },
  settlement:{
    settlements:[
      { id:9001, request_no:'RFP-OPS2026-00101', amount:2790676.80, paid_date:null,
        payment_reference:null, payment_method:'BANK TRANSFER', bank_name:null, account_name:null,
        proof_attachment_id:null, proof_reference:null, proof_uploaded_by:null,
        recorded_by:'mmungcal@nrdev.ph', status:'SETTLED',
        notes:'30% down payment. Balance due on terms. Proof of payment to be uploaded.' },
      { id:9002, request_no:'RFP-OPS2026-00101', amount:100000, paid_date:'2026-07-30',
        payment_reference:'BT-VOIDED', payment_method:'BANK TRANSFER', bank_name:'BDO',
        proof_attachment_id:null, proof_reference:null, recorded_by:'mmungcal@nrdev.ph',
        status:'VOID', void_reason:'Recorded on the wrong request' },
    ],
    settled:2790676.80, balance:6511579.20, settledPct:30, coverage:'PART',
    withProof:0, withoutProof:1, proofComplete:false,
    banks:[{ id:1, bank_account_code:'BDO-MAIN', bank_name:'BDO', account_name:'BDO Main' },
           { id:2, bank_account_code:'MBTC-PHP', bank_name:'MBTC PHP', account_name:'Metrobank PHP' }],
    canSettle:true, evidenceFrom:'2026-07-31', proofRequired:false,
  },
};

let settlementPosted = null;
let proofPosted = null;
const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path === '/api/finance/payment-requests')
      return res.end(JSON.stringify({ ok:true, rows:ROWS, purchaseOrders:[], visibility:'ALL',
        mancomEnabled:false, mancomMin:null, financeReview:true, roleGate:false }));
    if (path === '/api/finance/master-data')
      return res.end(JSON.stringify({ ok:true, accounts:[{ account_name:'Inventory Purchase' }] }));
    if (/\/settlements\/\d+\/proof$/.test(path)){
      let body=''; for await (const chunk of req) body += chunk;
      proofPosted = JSON.parse(body||'{}');
      return res.end(JSON.stringify({ ok:true, ...DETAIL.settlement }));
    }
    if (/\/payment-requests\/\d+\/settlements$/.test(path) && req.method === 'POST'){
      let body=''; for await (const chunk of req) body += chunk;
      settlementPosted = JSON.parse(body||'{}');
      return res.end(JSON.stringify({ ok:true, settlementId:9003, ...DETAIL.settlement }));
    }
    if (/\/payment-requests\/\d+$/.test(path)) return res.end(JSON.stringify(DETAIL));
    if (path === '/api/dashboard/home')
      return res.end(JSON.stringify({ ok:true, user:{ name:'Alexis Mungcal', role:'FINANCE', email:'mmungcal@nrdev.ph' },
        sections:{}, waiting:[], activity:[], progress:{}, trends:{}, period:{ from:'2026-08-01', to:'2026-08-31' } }));
    return res.end(JSON.stringify({ ok:true, rows:[], data:[], total:0, lines:[], summary:{} }));
  }
  try{
    const name = path === '/' ? 'index.html' : path.slice(1);
    const file = await readFile(join(PUBLIC, name));
    res.setHeader('content-type', TYPES[extname(name)] || 'application/octet-stream');
    res.end(file);
  }catch{ res.statusCode = 404; res.end('not found'); }
});
await new Promise(r=>server.listen(0,r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, note='') => results.push([ok?'PASS':'FAIL', name, note]);

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport:{ width:1440, height:960 } });
const errors = [];
page.on('pageerror', e=>errors.push(String(e)));
page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });

await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('.home-hello h1', { timeout:8000 });
await page.locator('#homeModules').click();
await page.locator('[data-workspace="fa-receivables-payables"]').click();
await page.waitForSelector('.workspace-card', { timeout:8000 });
await page.locator('[data-section="approvals"]').first().dispatchEvent('click');
await page.waitForSelector('[data-rfp-pay]', { timeout:8000 });

/* ------------------------------------------------------------ the register */
const headers = await page.locator('.workspace-card table thead th').allTextContents();
check('the register carries what has been paid',
  headers.includes('Paid') && headers.includes('Net Payable'), headers.join(' | '));
const cells = await page.locator('.workspace-card table tbody tr').first().locator('td').count();
check('every row has a cell for every header', cells === headers.length,
  `${cells} cells vs ${headers.length} headers`);

const rowText = async n => (await page.locator('.workspace-card table tbody tr').nth(n).innerText()).replace(/\n/g,' ');
const ampace = await rowText(0);
check('a part paid request shows what was paid', ampace.includes('2,790,676.80'), ampace);
check('a part paid request shows what is still owed', ampace.includes('6,511,579.20 owed'), ampace);
check('a part paid request does not read as settled', ampace.includes('PARTIALLY PAID'), ampace);
check('a payment with no document says so', ampace.includes('no proof'), ampace);

const meralco = await rowText(2);
check('a fully evidenced payment says nothing about proof',
  meralco.includes('88,000.00') && !meralco.includes('no proof'), meralco);
const unpaid = await rowText(3);
check('a request with no payment shows a dash, not a zero',
  !unpaid.includes('0.00 owed'), unpaid);

/*
 * Part paid must not wear the green a settled request wears. It is the one
 * thing on this screen somebody reads at a glance and acts on.
 */
const tone = await page.locator('.workspace-card table tbody tr').first().locator('.status').getAttribute('class');
check('part paid is not badged as good', !/\bgood\b/.test(tone||''), tone||'');

const summary = await page.locator('.workspace-card header span').first().innerText();
check('the register totals what is paid and what is owed',
  summary.includes('paid') && summary.includes('owed'), summary);

await page.screenshot({ path:SHOTS+'rfp-register.png', fullPage:true });

/* ------------------------------------------------------- the payments card */
await page.locator('tr:has-text("RFP-OPS2026-00101") [data-rfp-pay]').click();
await page.waitForSelector('.pay-card', { timeout:5000 });

const figures = (await page.locator('.pay-figures').innerText()).replace(/\n/g,' ');
check('the card opens on net payable, paid and balance',
  figures.includes('9,302,256.00') && figures.includes('2,790,676.80') && figures.includes('6,511,579.20'),
  figures);
check('the balance is marked as owed',
  await page.locator('.pay-figures .pay-owed').count() === 1);

const table = await page.locator('.pay-card table').innerText();
check('the down payment is listed', table.includes('2,790,676.80'), table.slice(0,120));
check('a payment without a document says it is not uploaded', table.includes('Not uploaded'));
check('a voided payment is shown, not hidden',
  await page.locator('.pay-card tr.pay-void').count() === 1);
check('a voided payment offers no uploader',
  await page.locator('.pay-card tr.pay-void [data-pay-proof]').count() === 0);

check('the record-payment form is offered while money is owed',
  await page.locator('#paySettleForm').count() === 1);
check('the amount starts on the balance',
  await page.locator('#paySettleForm input[name="amount"]').inputValue() === '6511579.20',
  await page.locator('#paySettleForm input[name="amount"]').inputValue());
check('the form cannot ask for more than is owed',
  await page.locator('#paySettleForm input[name="amount"]').getAttribute('max') === '6511579.2',
  await page.locator('#paySettleForm input[name="amount"]').getAttribute('max'));
check('the bank accounts come from the finance registry',
  (await page.locator('#paySettleForm select[name="bankAccountId"] option').allTextContents()).includes('BDO'));
check('the card fits its window without scrolling sideways',
  await page.evaluate(()=>{ const m=document.querySelector('.pay-card');
    return m.scrollWidth <= m.clientWidth + 1; }));

await page.screenshot({ path:SHOTS+'rfp-payments.png', fullPage:true });

/* ------------------------------------------------------ the proof uploader */
await page.locator('.pay-card [data-pay-proof]').first().click();
await page.waitForSelector('#proofForm', { timeout:5000 });
check('the uploader takes a file', await page.locator('#proofForm #proofFile').count() === 1);
check('the uploader takes a reference instead',
  await page.locator('#proofForm input[name="proofReference"]').count() === 1);

// Empty is refused on the page, before it ever reaches the server.
await page.locator('#proofForm button[type="submit"]').click();
await page.waitForTimeout(300);
check('an empty upload is refused without a round trip', proofPosted === null,
  JSON.stringify(proofPosted));

await page.locator('#proofForm input[name="proofReference"]').fill('BDO advice 2026-0730');
await page.locator('#proofForm button[type="submit"]').click();
await page.waitForTimeout(500);
check('the reference is sent as typed',
  proofPosted && proofPosted.proofReference === 'BDO advice 2026-0730',
  JSON.stringify(proofPosted));

await page.screenshot({ path:SHOTS+'rfp-proof.png', fullPage:true });

/* --------------------------------------------------------- recording money */
// The uploader hands back to the payments card, so close it before going round
// again from the register.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await page.locator('#payClose').count()) await page.locator('#payClose').click();
await page.waitForTimeout(300);
await page.locator('tr:has-text("RFP-OPS2026-00101") [data-rfp-pay]').click();
await page.waitForSelector('#paySettleForm', { timeout:5000 });
await page.locator('#paySettleForm input[name="amount"]').fill('1000000');
await page.locator('#paySettleForm input[name="paymentReference"]').fill('BT-2026-0810');
await page.locator('#paySettleForm select[name="bankAccountId"]').selectOption({ label:'BDO' });
await page.locator('#paySettleForm button[type="submit"]').click();
await page.waitForTimeout(600);
check('the payment is sent exactly as typed',
  settlementPosted && settlementPosted.amount === 1000000
  && settlementPosted.paymentReference === 'BT-2026-0810'
  && String(settlementPosted.bankAccountId) === '1',
  JSON.stringify(settlementPosted));

check('no script errors', errors.length === 0, errors.slice(0,3).join(' | ') || 'clean');

await browser.close();
server.close();

console.log('\n=== Payment register and payments card ===');
for (const [s,n,note] of results) console.log(`${s}  ${n}${note ? '  ·  ' + note : ''}`);
const failed = results.filter(r=>r[0]==='FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
