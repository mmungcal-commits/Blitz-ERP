/*
 * Renders the module control centres that just gained charts, and checks the
 * charts are actually on the page rather than merely in the source.
 *
 * Two failures live here and nowhere else: a centre that throws while building
 * its charts (the screen goes blank and the error is in the console, not the
 * tests), and a centre whose circles vanish because every figure is zero. Both
 * have happened on this system, so both are asserted.
 *
 *   node test/module-centres-render.mjs
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

const MODULES = [
  { code:'ip-inbound-logistics', label:'Inbound Logistics', permission:'SHIPMENTS' },
  { code:'sd-outbound-logistics', label:'Outbound Logistics', permission:'DELIVERIES' },
  { code:'sd-order-management', label:'Order Management', permission:'SALES' },
  { code:'ip-sourcing-purchasing', label:'Sourcing & Purchasing', permission:'PROCUREMENT' },
];
const GROUPS = [
  { code:'ip', title:'Inventory & Procurement', items:MODULES.filter(m=>m.code.startsWith('ip')).map(m=>({...m, action:'VIEW'})) },
  { code:'sd', title:'Sales & Distribution', items:MODULES.filter(m=>m.code.startsWith('sd')).map(m=>({...m, action:'VIEW'})) },
];
const SESSION = { ok:true,
  user:{ email:'mmungcal@nrdev.ph', displayName:'Mark Alexis Mungcal', preferredName:'Alexis',
    role:'ADMIN', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess: MODULES.map(m=>({ module_code:m.code, can_view:1, can_create:1, can_edit:1, can_approve:1, can_post:1 })),
  workspaceCatalog:{ groups:GROUPS, tools:[], addons:[] } };

// Enough shape that every chart has something to draw, and one status that is
// deliberately empty so a zero slice is exercised too.
const PO_ROWS = [
  { id:1, purchase_order_no:'PO-000001', order_date:'2026-03-02', vendor_name:'Yunku Industrial',
    expected_delivery_date:'2026-04-01', currency:'PHP', total_amount:850000, line_count:4, status:'APPROVED' },
  { id:2, purchase_order_no:'PO-000002', order_date:'2026-03-14', vendor_name:'Ampace Cells',
    expected_delivery_date:'2026-04-20', currency:'PHP', total_amount:410000, line_count:2, status:'DRAFT' },
  { id:3, purchase_order_no:'PO-000003', order_date:'2026-04-04', vendor_name:'Yunku Industrial',
    expected_delivery_date:'2026-05-02', currency:'PHP', total_amount:220000, line_count:1, status:'PARTIALLY_RECEIVED' },
];
const SHIPMENTS = { ok:true, total:2, rows:[
  { id:1, shipment_no:'SHP-0001', purchase_order_ref:'PO-000001', batch_code:'2026Q1', supplier_name:'Yunku Industrial',
    expected_qty:120, received_qty:96, open_variances:2, status:'PARTIALLY_RECEIVED' },
  { id:2, shipment_no:'SHP-0002', purchase_order_ref:'PO-000003', batch_code:'2026Q2', supplier_name:'Ampace Cells',
    expected_qty:80, received_qty:0, open_variances:0, status:'EXPECTED' },
]};
const OUTBOUND = { ok:true,
  requisitions:[
    { id:1, requisition_no:'REQ-0001', request_type:'Lease', holder_type:'CUSTOMER', holder_name:'Angkas',
      required_date:'2026-03-20', serial_count:4, total_qty:4, status:'SUBMITTED' },
    { id:2, requisition_no:'REQ-0002', request_type:'Demo', holder_type:'PARTNER', holder_name:'Flexride',
      required_date:'2026-03-28', serial_count:2, total_qty:2, status:'FULFILLED', expected_return_date:'2026-04-28' },
  ],
  deliveries:[
    { id:1, status:'PLANNED' }, { id:2, status:'RELEASED' }, { id:3, status:'DELIVERED' },
  ]};
const SALES = { ok:true, total:3, rows:[
  { id:1, sales_order_no:'SO-000001', order_date:'2026-02-11', transaction_type:'LEASE',
    customer_name:'Angkas', line_count:2, gross_amount:640000, credit_status:'CLEAR', status:'APPROVED' },
  { id:2, sales_order_no:'SO-000002', order_date:'2026-03-06', transaction_type:'SALE',
    customer_name:'Messerve', line_count:1, gross_amount:180000, credit_status:'CLEAR', status:'DRAFT' },
  { id:3, sales_order_no:'SO-000003', order_date:'2026-03-19', transaction_type:'DEMO',
    customer_name:'Philpower', line_count:1, gross_amount:0, credit_status:'CLEAR', status:'DRAFT' },
]};

const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path === '/api/procurement/purchase-orders')
      return res.end(JSON.stringify({ ok:true, total:PO_ROWS.length, rows:PO_ROWS }));
    if (path === '/api/shipments') return res.end(JSON.stringify(SHIPMENTS));
    if (path === '/api/receiving/open-shipments') return res.end(JSON.stringify({ ok:true, rows:[{id:2}] }));
    if (path === '/api/receiving/reports/reconciliation')
      return res.end(JSON.stringify({ ok:true, totals:{ openVariances:2, matched:1, withDiscrepancies:1 } }));
    if (path === '/api/requisitions/outbound-workbench') return res.end(JSON.stringify(OUTBOUND));
    if (path === '/api/sales') return res.end(JSON.stringify(SALES));
    if (path === '/api/sales/lookups')
      return res.end(JSON.stringify({ ok:true, assets:[
        { category:'MC', serial_no:'R5FBMX0B2RL000423' }, { category:'BAT', serial_no:'B-1' },
        { category:'BSS', serial_no:'S-1' }], customers:[], items:[], orders:[] }));
    if (path === '/api/workspace/modules/ip-sourcing-purchasing/summary')
      return res.end(JSON.stringify({ ok:true, counts:{ total:6, completed:2 } }));
    if (path === '/api/procurement/landed-cost')
      return res.end(JSON.stringify({ ok:true, rows:[{ id:1, landed_cost_no:'LC-0001', purchase_order_no:'PO-000001',
        allocation_method:'VALUE', total_cost:41000, status:'DRAFT' }] }));
    // Setup screens are counted panels now, not a list of words.
    if (path.startsWith('/api/finance/module-setup/') || path.startsWith('/api/inventory/module-setup/'))
      return res.end(JSON.stringify({ ok:true, code:path.split('/').pop(), panels:[
        { title:'Where planning gets its numbers', columns:['Source','What it counts','Units'],
          rows:[['On hand','Confirmed by goods receipt',412],['Incoming','On an expected shipment',84],
                ['Open purchase order','Approved and not yet shipped',0],['Deployed','With a customer or site',97]] },
        { title:'Stock by class', columns:['Class','Units','Without a cost','Value'],
          rows:[['MC',210,3,18400000],['BAT',120,0,2400000]] },
      ] }));
    if (path === '/api/dashboard/home')
      return res.end(JSON.stringify({ ok:true, user:{ name:'Alexis Mungcal', role:'ADMIN', email:'mmungcal@nrdev.ph' },
        sections:{}, waiting:[], activity:[], progress:{}, trends:{}, period:{ from:'2026-08-01', to:'2026-08-31' } }));
    return res.end(JSON.stringify({ ok:true, rows:[], data:[], total:0, lines:[], summary:{},
      counts:{ total:0, completed:0 }, totals:{}, locations:[], vendors:[], items:[], assets:[], orders:[] }));
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
page.on('pageerror', e=>errors.push(String(e)+' :: '+String(e.stack||'').split('\n').slice(0,3).join(' | ')));
page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });
await page.goto(base, { waitUntil:'networkidle' });

// Admin and operations land differently - one on the cockpit, one on the module
// map - so open the map only when there is one to open.
async function openModule(code){
  await page.goto(base, { waitUntil:'networkidle' });
  await page.waitForSelector('#homeModules, [data-workspace]', { timeout:10000 });
  if (await page.locator('#homeModules').count()) await page.locator('#homeModules').click();
  await page.locator(`[data-workspace="${code}"]`).click();
}

for (const m of MODULES) {
  await openModule(m.code);
  await page.waitForSelector('.viz-tiles, .workspace-card', { timeout:10000 });

  const tiles = await page.locator('.viz-tile').count();
  const figures = await page.locator('figure.viz').count();
  const circles = await page.locator('.viz-donut, .viz-ring').count();
  check(`${m.label}: the centre leads with KPI tiles`, tiles >= 4, `${tiles} tiles`);
  check(`${m.label}: the centre draws its charts`, figures >= 3, `${figures} figures`);
  check(`${m.label}: at least two of them are circles`, circles >= 2, `${circles} circles`);

  // A chart that grows to fill the viewport is the bug that hid here before.
  const box = await page.locator('figure.viz').first().boundingBox();
  check(`${m.label}: a chart card keeps a sensible size`,
    box && box.width <= 700 && box.height <= 460, box ? `${Math.round(box.width)}x${Math.round(box.height)}px` : 'no box');

  // Every chart on a control centre should lead somewhere.
  const clickable = await page.locator('figure.viz-clickable, .viz-tile.is-clickable').count();
  check(`${m.label}: the figures are a way in, not a dead end`, clickable >= 1, `${clickable} clickable`);

  await page.screenshot({ path:`${SHOTS}centre-${m.code}.png`, fullPage:true });
}

/*
 * A setup screen that only names the concepts a module works with tells nobody
 * whether anything is configured. These are counted panels now, so the check is
 * that real columns and rows reach the page.
 */
for (const m of [{ code:'ip-inventory-analysis', label:'Inventory Analysis' },
                 { code:'ip-sourcing-purchasing', label:'Sourcing & Purchasing' }]) {
  if (!MODULES.some(x => x.code === m.code)) continue;
  await openModule(m.code);
  await page.evaluate(()=>{ const b=document.querySelector('[data-section="setup"]'); if(b) b.click(); });
  await page.waitForTimeout(900);
  const headers = await page.locator('.workspace-card table thead th').allTextContents();
  const bodyRows = await page.locator('.workspace-card table tbody tr').count();
  check(`${m.label}: the setup screen is counted panels, not a list of words`,
    headers.length >= 3 && bodyRows >= 2, `${headers.length} columns, ${bodyRows} rows`);
  check(`${m.label}: no bare definition list is left on setup`,
    (await page.locator('.definition-list').count()) === 0,
    `${await page.locator('.definition-list').count()} definition lists`);
  await page.screenshot({ path:`${SHOTS}setup-${m.code}.png`, fullPage:true });
}

/* ------------------------------------------------- getting back out again */
/*
 * The module map had no way back to the dashboard. The flag that opens it is
 * only cleared from a workspace sidebar, so anyone who opened the map and did
 * not pick a module was stuck with signing out as the only exit. Every screen
 * you can reach has to be a screen you can leave.
 */
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('#homeModules', { timeout:10000 });
await page.locator('#homeModules').click();
await page.waitForSelector('.enterprise-launchpad', { timeout:8000 });

check('the module map offers a way back to the dashboard',
  await page.locator('#launchHome').count() === 1);
check('the brand mark goes home too',
  await page.locator('button.launchpad-brand').count() === 1);

// The exit has to be visible on the strip, not merely present in the DOM.
const homeBox = await page.locator('#launchHome').boundingBox();
check('the way back is on screen without scrolling',
  homeBox && homeBox.width > 0 && homeBox.y >= 0 && homeBox.y < 200,
  homeBox ? `at y=${Math.round(homeBox.y)}` : 'not rendered');

await page.locator('#launchHome').click();
await page.waitForSelector('.home-hello h1', { timeout:8000 });
check('it lands on the dashboard, not back on the map',
  await page.locator('.enterprise-launchpad').count() === 0);

// And the same via the logo, which is where people click by habit.
await page.locator('#homeModules').click();
await page.waitForSelector('.enterprise-launchpad', { timeout:8000 });
await page.locator('button.launchpad-brand').click();
await page.waitForSelector('.home-hello h1', { timeout:8000 });
check('the brand mark lands on the dashboard as well',
  await page.locator('.enterprise-launchpad').count() === 0);

/*
 * Customize reads the app title off the brand mark. It used to find it by
 * position - "first div in the controls" - and the Dashboard button moved what
 * sits first, which would have written the app title over the signed-in
 * person's name instead.
 */
await page.locator('#homeModules').click();
await page.waitForSelector('.enterprise-launchpad', { timeout:8000 });
const named = await page.evaluate(()=>{
  const el = document.querySelector('.launchpad-brand .brand-name');
  const who = document.querySelector('.launchpad-controls div:last-child span');
  return { brand: el && el.textContent.trim(), who: who && who.textContent.trim() };
});
check('the app title and the person are different elements',
  named.brand && named.who && named.brand !== named.who,
  JSON.stringify(named));

await page.screenshot({ path:`${SHOTS}module-map.png`, fullPage:true });

check('no script errors on any centre', errors.length === 0, errors.slice(0,3).join(' | ') || 'clean');

await browser.close();
server.close();

console.log('\n=== Module centres render ===');
for (const [s,n,note] of results) console.log(`${s}  ${n}${note?'  ·  '+note:''}`);
const failed = results.filter(r=>r[0]==='FAIL').length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
