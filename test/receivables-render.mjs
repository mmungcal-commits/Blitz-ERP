/*
 * Renders Receivables Management in Chromium and drives the Collection action.
 *
 * The register and the collect dialog are the two screens Finance will live in,
 * and both are the kind of thing that reads fine in source and comes out wrong
 * on the page: a button that never binds, a column that lands under the wrong
 * header, a dialog that opens with the balance missing. Only painting it tells.
 *
 *   node test/receivables-render.mjs
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
  { code:'fa-receivables-management', label:'Receivables Management', permission:'RECEIVABLES', action:'VIEW' },
]}];
const SESSION = { ok:true,
  // On record as the full legal name, called by the name they go by.
  user:{ email:'mmungcal@nrdev.ph', displayName:'Mark Alexis Mungcal', preferredName:'Alexis',
    role:'FINANCE', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess:[{ module_code:'fa-receivables-management', can_view:1, can_create:1, can_edit:1, can_approve:1, can_post:1 }],
  workspaceCatalog:{ groups:GROUPS, tools:[], addons:[] } };

// One of each state, so every branch of the row renderer is on the page at once.
const ROWS = [
  { id:1, entry_no:'AR-2026-00001', stream:'MC_LEASED', txn_date:'2026-03-04', customer_name:'JAMO BUSINESS SOLUTIONS',
    document_no:'OR-1001', description:'March lease billing', gross_amount:121706.59, net_amount:108666.60,
    output_vat:13039.99, collected:40000, balance:81706.59, payment_method:'Bank Transfer',
    cleared_status:'CLEARED', status:'POSTED' },
  { id:2, entry_no:'AR-2026-00002', stream:'MC_SOLD', txn_date:'2026-03-08', customer_name:'ANGKAS RIDERS INC',
    document_no:'SI-2201', description:'Two units D400', gross_amount:250000, net_amount:223214.29,
    output_vat:26785.71, collected:0, balance:0, payment_method:'GCash',
    cleared_status:'PENDING', status:'DRAFT' },
  { id:3, entry_no:'AR-2026-00003', stream:'BATTERY_SWAP', txn_date:'2026-03-11', customer_name:'FLEXRIDE',
    document_no:'OR-1044', description:'Swap load', gross_amount:18000, net_amount:16071.43,
    output_vat:1928.57, collected:18000, balance:0, payment_method:'Cash',
    cleared_status:'CLEARED', status:'VOID' },
];
const TOTALS = { n:3, gross:389706.59, net:347952.32, vat:41754.27, posted:121706.59, draft:250000, cleared:139706.59 };
const LISTS = { ok:true, lists:{
  SALES_TYPE:['Leased','Sold'], PAYMENT_METHOD:['Cash','Bank Transfer','GCash'],
  BANK:['BDO','MBTC PHP','GCash'], VAT_TYPE:['VATable','VAT Exempt'],
  ACCOUNT_TITLE:['Cash in Bank - BDO'], COST_CENTER:['Sales'] },
  streams:{ MC_SOLD:'Motorcycle sold', MC_LEASED:'Motorcycle leased', BATTERY_SWAP:'Battery swapping',
    AFTERSALES:'After-sales', WAREHOUSE_SERVICE:'Warehouse service' },
  customers:[{ id:1, partner_code:'CUS-000001', name:'JAMO BUSINESS SOLUTIONS' }] };

const RECEIPTS = { ok:true,
  collection:{ ...ROWS[0] },
  receipts:[{ id:11, receipt_no:'OR-2026-00001', receipt_date:'2026-03-20', amount:40000,
    payment_method:'Bank Transfer', bank_ref:'BDO-77123', cleared_status:'CLEARED', status:'ACTIVE' }] };

const SUMMARY = { ok:true, totals:TOTALS,
  byStream:[{ label:'MC_LEASED', value:121706.59 }, { label:'MC_SOLD', value:250000 }, { label:'BATTERY_SWAP', value:18000 }],
  byMonth:[{ label:'2026-03', value:389706.59 }],
  byCustomer:[{ label:'JAMO BUSINESS SOLUTIONS', value:121706.59 }, { label:'ANGKAS RIDERS INC', value:250000 }],
  billed:121706.59, billedCount:1, collected:40000, outstanding:81706.59,
  collectionPct:32.86, receivablesPct:67.14 };

// One issued statement and one draft, so both the frozen and the editable
// shapes of the dialog are on the page at least once.
const STATEMENTS = { ok:true,
  rows:[
    { id:1, statement_no:'SOA-2026-00001', period_month:'2026-03', customer_name:'JAMO BUSINESS SOLUTIONS',
      opening_balance:6000, billed_amount:121706.59, collected_amount:40000, closing_balance:87706.59, status:'DRAFT' },
    { id:2, statement_no:'SOA-2026-00002', period_month:'2026-02', customer_name:'ANGKAS RIDERS INC',
      opening_balance:0, billed_amount:250000, collected_amount:250000, closing_balance:0, status:'ISSUED' },
  ],
  months:[{ label:'2026-03' }, { label:'2026-02' }],
  customers:[{ label:'JAMO BUSINESS SOLUTIONS', n:4 }, { label:'ANGKAS RIDERS INC', n:2 }] };
const STATEMENT_ONE = { ok:true,
  statement:{ ...STATEMENTS.rows[0], notes:'' },
  lines:[
    { id:1, line_no:1, line_date:'2026-03-04', reference:'AR-2026-00001', description:'March lease billing',
      charge:121706.59, credit:0, source_type:'COLLECTION' },
    { id:2, line_no:2, line_date:'2026-03-20', reference:'OR-2026-00001', description:'Payment received (Bank Transfer)',
      charge:0, credit:40000, source_type:'RECEIPT' },
  ]};

let collectPosted = null;
const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path === '/api/receivables/lists') return res.end(JSON.stringify(LISTS));
    if (path === '/api/receivables/summary') return res.end(JSON.stringify(SUMMARY));
    if (path === '/api/receivables/collections')
      return res.end(JSON.stringify({ ok:true, rows:ROWS, page:1, size:50, total:3, totals:TOTALS,
        byStream:SUMMARY.byStream, byMethod:[], streams:LISTS.streams }));
    if (/\/collections\/\d+\/receipts$/.test(path)) return res.end(JSON.stringify(RECEIPTS));
    if (path === '/api/receivables/statements') return res.end(JSON.stringify(STATEMENTS));
    if (/\/statements\/\d+$/.test(path)) return res.end(JSON.stringify(STATEMENT_ONE));
    if (/\/collections\/\d+\/collect$/.test(path)){
      let body=''; for await (const chunk of req) body += chunk;
      collectPosted = JSON.parse(body||'{}');
      return res.end(JSON.stringify({ ok:true, id:12, receiptNo:'OR-2026-00002',
        amount:collectPosted.amount, collected:121706.59, balance:0 }));
    }
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

/*
 * The greeting uses the name the person goes by. The legal name stays for the
 * documents that have to carry it, and must not leak into the greeting.
 */
const hello = await page.locator('.home-hello h1').innerText();
check('the greeting uses the name they go by', /,\s*Alexis$/.test(hello.trim()), hello);
check('the legal first name is not used to address them', !hello.includes('Mark'), hello);
check('the badge carries the same name',
  (await page.locator('#userBadge b').innerText()).trim() === 'Alexis', await page.locator('#userBadge b').innerText());

await page.locator('#homeModules').click();
await page.locator('[data-workspace="fa-receivables-management"]').click();
await page.waitForSelector('.viz-ring, .workspace-card', { timeout:8000 });
await page.locator('[data-section-link="records"]').first().click();
await page.waitForSelector('tr[data-ar]', { timeout:8000 });

/* ---------------------------------------------------------- the register */
const headers = await page.locator('.workspace-card table thead th').allTextContents();
check('the register carries collected and balance',
  headers.includes('Collected') && headers.includes('Balance'), headers.join(' | '));
check('every row has a cell for every header',
  (await page.locator('tr[data-ar="1"] td').count()) === headers.length,
  `${await page.locator('tr[data-ar="1"] td').count()} cells vs ${headers.length} headers`);

// The action a row offers is decided by its status, and only by its status.
const actionsFor = async id => (await page.locator(`tr[data-ar="${id}"] td:last-child`).innerText()).trim();
check('a posted entry offers Collection', (await actionsFor(1)).includes('Collection'), await actionsFor(1));
check('a draft offers no Collection', !(await actionsFor(2)).includes('Collection'), await actionsFor(2));
check('a void entry offers nothing', (await actionsFor(3)) === '-', await actionsFor(3));
check('a posted entry shows what is still outstanding',
  (await page.locator('tr[data-ar="1"] td').nth(11).innerText()).includes('81,706'),
  await page.locator('tr[data-ar="1"] td').nth(11).innerText());
check('a draft shows no collection figures',
  (await page.locator('tr[data-ar="2"] td').nth(10).innerText()).trim() === '-');

await page.screenshot({ path:SHOTS+'ar-register.png', fullPage:true });

/* --------------------------------------------------------- the collection */
await page.locator('tr[data-ar="1"] [data-ar-collect]').click();
await page.waitForSelector('.ar-collect', { timeout:5000 });

const head = await page.locator('.ar-collect-head').innerText();
check('the dialog opens on the balance', head.includes('81,706.59'), head.replace(/\n/g,' / '));
check('the dialog names the customer', head.includes('JAMO BUSINESS SOLUTIONS'));
check('an earlier collection is listed, not hidden',
  (await page.locator('.ar-collect table tbody tr').count()) === 1
  && (await page.locator('.ar-collect table').innerText()).includes('OR-2026-00001'));
check('the amount starts on the balance',
  await page.locator('.ar-collect input[name="amount"]').inputValue() === '81706.59',
  await page.locator('.ar-collect input[name="amount"]').inputValue());
check('the form cannot ask for more than is outstanding',
  await page.locator('.ar-collect input[name="amount"]').getAttribute('max') === '81706.59');
check('payment methods come from the finance lists',
  (await page.locator('.ar-collect select[name="paymentMethod"] option').allTextContents()).includes('Bank Transfer'));
check('the dialog fits its window without scrolling sideways',
  await page.evaluate(()=>{ const m=document.querySelector('.ar-collect');
    return m.scrollWidth <= m.clientWidth + 1; }));

await page.screenshot({ path:SHOTS+'ar-collect.png', fullPage:true });

// Recording one sends exactly what was typed, and nothing it invented.
await page.locator('.ar-collect input[name="amount"]').fill('20000');
await page.locator('.ar-collect input[name="bankRef"]').fill('BDO-88991');
await page.locator('.ar-collect select[name="paymentMethod"]').selectOption('GCash');
await page.locator('.ar-collect button[type="submit"]').click();
await page.waitForFunction(()=>document.querySelector('#modal').classList.contains('hidden'), null, { timeout:5000 });

check('the amount typed is the amount sent',
  collectPosted && String(collectPosted.amount) === '20000', JSON.stringify(collectPosted));
check('the method and reference travel with it',
  collectPosted && collectPosted.paymentMethod === 'GCash' && collectPosted.bankRef === 'BDO-88991');
check('the date is sent, never left to the server to guess',
  collectPosted && /^\d{4}-\d{2}-\d{2}$/.test(String(collectPosted.receiptDate||'')), collectPosted?.receiptDate);

/* ------------------------------------------------------------ the centre */
await page.evaluate(()=>document.querySelector('[data-section="center"]').click());
await page.waitForSelector('.viz-ring', { timeout:8000 });
check('collection and receivables are drawn as circles',
  (await page.locator('.viz-ring').count()) >= 2, `${await page.locator('.viz-ring').count()} rings`);
const centreText = await page.locator('body').innerText();
check('the rate is stated as a rate', /3[23]%/.test(centreText));
const tileLabels = await page.locator('.viz-tile-label').allTextContents();
check('billed, collected and outstanding are all on the tiles',
  ['Billed','Collected','Outstanding'].every(l=>tileLabels.includes(l)), tileLabels.join(' | '));
await page.screenshot({ path:SHOTS+'ar-centre.png', fullPage:true });

/* --------------------------------------------------------- statements */
await page.evaluate(()=>document.querySelector('[data-section="statements"]').click());
await page.waitForSelector('#soaGenerate', { timeout:8000 });
const soaHeaders = await page.locator('.workspace-card table thead th').allTextContents();
check('the statement register shows the balance carried through',
  ['Opening','Charges','Payments','Closing'].every(h=>soaHeaders.includes(h)), soaHeaders.join(' | '));
check('a month and a customer are picked, not typed',
  (await page.locator('#soaMonth option').count()) >= 2
  && (await page.locator('#soaCustomer option').count()) >= 2);

await page.locator('[data-soa-open="1"]').click();
await page.waitForSelector('#soaLines', { timeout:5000 });
check('a draft statement opens with its generated lines',
  (await page.locator('.soa-line:not(.soa-line-head)').count()) === 2,
  `${await page.locator('.soa-line:not(.soa-line-head)').count()} lines`);
check('the closing balance is arithmetic, not a stored number',
  (await page.locator('#soaClosing').innerText()).includes('87,706.59'),
  await page.locator('#soaClosing').innerText());

// Adding a credit line must move the closing balance on the spot.
await page.locator('#soaAdd').click();
const last = page.locator('.soa-line:not(.soa-line-head)').last();
await last.locator('[data-s="credit"]').fill('706.59');
check('an adjustment moves the closing balance as it is typed',
  (await page.locator('#soaClosing').innerText()).includes('87,000'),
  await page.locator('#soaClosing').innerText());
check('a draft statement can be issued', await page.locator('#soaIssue').count() === 1);
await page.screenshot({ path:SHOTS+'ar-statement.png', fullPage:true });
await page.locator('#soaClose').click();

/* ------------------------------------------------- a narrower window --------
 *
 * Alexis dragged the window in and the screen came apart: the status filter ran
 * off the left edge, the register was cut down the middle, and half the page
 * was empty white with a scrollbar under it. A laptop beside a spreadsheet is a
 * normal way to work, so the register has to survive it.
 */
for (const width of [1180, 1024, 900]) {
  await page.setViewportSize({ width, height:960 });
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.workspace-filters, .filter-bar, select');
    const r = bar ? bar.getBoundingClientRect() : null;
    const wrap = document.querySelector('.record-table-wrap');
    return { scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      barLeft: r ? Math.round(r.left) : null,
      wrapOverflow: wrap ? getComputedStyle(wrap).overflowX : null,
      wrapRight: wrap ? Math.round(wrap.getBoundingClientRect().right) : null };
  });
  check(`at ${width}px the page does not scroll sideways`,
    m.scrollW <= m.clientW + 2, `${m.scrollW} wide in ${m.clientW}`);
  check(`at ${width}px the filters stay on the page`,
    m.barLeft === null || m.barLeft >= -1, `left edge at ${m.barLeft}px`);
  /*
   * The rule itself, not just its effect. A register that happens to fit on
   * this fixture would pass the scroll check while the real one, with real
   * customer names in it, still pushed the page sideways.
   */
  /*
   * The condition Alexis was actually in. Column widths are saved to
   * localStorage in pixels when somebody drags a column, and restored whatever
   * the window is: widths set on a wide monitor come back on a narrow one and
   * the register becomes wider than the page. Simulated here by pinning the
   * columns, because a fixture with short mock values fits when the real
   * register does not.
   */
  await page.evaluate(() => document.querySelectorAll('.record-table thead th')
    .forEach(th => { th.style.width = '260px'; }));
  await page.waitForTimeout(120);
  const pinned = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth }));
  check(`at ${width}px restored column widths do not push the page sideways`,
    pinned.scrollW <= pinned.clientW + 2, `${pinned.scrollW} wide in ${pinned.clientW}`);
  await page.evaluate(() => document.querySelectorAll('.record-table thead th')
    .forEach(th => { th.style.width = ''; }));
  check(`at ${width}px a wide register scrolls inside its card`,
    m.wrapOverflow === 'auto' || m.wrapOverflow === 'scroll', String(m.wrapOverflow));
  check(`at ${width}px the register stays inside the window`,
    m.wrapRight === null || m.wrapRight <= m.clientW + 2, `right edge at ${m.wrapRight} of ${m.clientW}`);
}
await page.setViewportSize({ width:1440, height:960 });
await page.waitForTimeout(250);

check('no script errors', errors.length === 0, errors.slice(0,3).join(' | ') || 'clean');

await browser.close();
server.close();

console.log('\n=== Receivables render ===');
for (const [s,n,note] of results) console.log(`${s}  ${n}${note?'  ·  '+note:''}`);
const failed = results.filter(r=>r[0]==='FAIL').length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
