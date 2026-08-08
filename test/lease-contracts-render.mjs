/*
 * Renders the Lease Contracts screen and the unit-tagging forms in Chromium.
 *
 * This screen exists to show one gap: the units a customer is entitled to
 * against the units they actually hold. A contract for twenty with eleven
 * tagged is not a contract for eleven, it is nine units the company thinks are
 * on a shelf. That number is arithmetic between two columns, which is exactly
 * the kind of thing that reads correctly in source and lands under the wrong
 * header on the page.
 *
 * The forms are the other half. .operational-form is a flex row, and a form
 * that inherits it lays its heading, fields and buttons side by side - every
 * field present, every check on presence passing, and the form unusable. So
 * the layout is measured here, not merely counted.
 *
 *   node test/lease-contracts-render.mjs
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

const GROUPS = [{ code:'sd', title:'Sales & Distribution', items:[
  { code:'sd-order-management', label:'Order Management', permission:'SALES', action:'VIEW' },
]}];
const SESSION = { ok:true,
  user:{ email:'mmungcal@nrdev.ph', displayName:'Mark Alexis Mungcal', preferredName:'Alexis',
    role:'FINANCE', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess:[{ module_code:'sd-order-management', can_view:1, can_create:1, can_edit:1, can_approve:1, can_post:1 }],
  workspaceCatalog:{ groups:GROUPS, tools:[], addons:[] } };

/*
 * One of each shape: a live contract with a gap and no paper, a live contract
 * fully tagged and papered, and one that has run its term.
 */
const LEASES = [
  { id:1, lease_no:'LSE-0001', cb_code:'AMICO-B1', batch_code:'B1', customer_name:'Amico Innovations, Inc',
    client_name:'Amico Innovations, Inc', effective_date:'2026-02-01', end_of_term:'2027-01-31',
    unit_count:20, units_out:11, documents:0, deposit_amount:150000, daily_rate_vat_ex:0,
    contract_term_months:12, status:'ACTIVE' },
  { id:2, lease_no:'LSE-0002', cb_code:'JAMO-B1', batch_code:'B1', customer_name:'Jamo Business Solutions Corp.',
    client_name:'Jamo Business Solutions Corp.', effective_date:'2026-03-15', end_of_term:'2027-03-14',
    unit_count:8, units_out:8, documents:2, deposit_amount:60000, daily_rate_vat_ex:195,
    contract_term_months:12, status:'ACTIVE' },
  { id:3, lease_no:'LSE-0003', cb_code:'PILOT-B1', batch_code:'B1', customer_name:'Pilot Rider Co',
    client_name:'Pilot Rider Co', effective_date:'2025-09-01', end_of_term:'2026-02-28',
    unit_count:5, units_out:0, documents:1, deposit_amount:0, daily_rate_vat_ex:180,
    contract_term_months:6, status:'CLOSED' },
];
const TOTALS = { contracts:3, units:33, units_on_live_contracts:28, unitsDeployed:19 };

const DETAIL = { ok:true, header:LEASES[0],
  units:[
    { id:1, serial_no:'R5FBM0000000001', item_name:'E88 R280', deployed_at:'2026-02-03',
      deployed_by:'mmungcal@nrdev.ph', returned_at:null, return_reason:null },
    { id:2, serial_no:'R5FBM0000000002', item_name:'E88 R280', deployed_at:'2026-02-03',
      deployed_by:'mmungcal@nrdev.ph', returned_at:'2026-06-30', returned_by:'mmungcal@nrdev.ph',
      return_reason:'Swapped for a D400' },
  ],
  documents:[] };

let deployPosted = null;
let returnPosted = null;
let ratePosted = null;
const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path === '/api/sales/leases')
      return res.end(JSON.stringify({ ok:true, rows:LEASES, totals:TOTALS }));
    if (/\/sales\/leases\/\d+\/deploy$/.test(path)){
      let body=''; for await (const chunk of req) body += chunk;
      deployPosted = JSON.parse(body||'{}');
      // One of the two is already out elsewhere, so the screen has to name it.
      return res.end(JSON.stringify({ ok:true, leaseNo:'LSE-0001', customer:'Amico Innovations, Inc',
        deployed:[(deployPosted.serials||[])[0]].filter(Boolean),
        refused:(deployPosted.serials||[]).slice(1)
          .map(s=>({ serial:s, reason:'already out with Jamo Business Solutions Corp. on LSE-0002' })) }));
    }
    if (/\/sales\/leases\/\d+\/return$/.test(path)){
      let body=''; for await (const chunk of req) body += chunk;
      returnPosted = JSON.parse(body||'{}');
      return res.end(JSON.stringify({ ok:true, returned:returnPosted.serials||[] }));
    }
    if (/\/sales\/leases\/\d+$/.test(path) && req.method === 'PATCH'){
      let body=''; for await (const chunk of req) body += chunk;
      ratePosted = JSON.parse(body||'{}');
      return res.end(JSON.stringify({ ok:true, id:1, leaseNo:'LSE-0001',
        dailyRateVatEx:Number(ratePosted.dailyRateVatEx), orderValue:1528800 }));
    }
    if (/\/sales\/leases\/\d+$/.test(path)) return res.end(JSON.stringify(DETAIL));
    if (path === '/api/sales/lookups')
      return res.end(JSON.stringify({ ok:true, customers:[], employees:[], items:[], assets:[] }));
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
await page.locator('[data-workspace="sd-order-management"]').click();
await page.waitForSelector('.workspace-card', { timeout:8000 });

/* ----------------------------------------------------------------- the tab */
const tabs = await page.locator('[data-section]').allTextContents();
check('lease contracts are reachable from the order module',
  tabs.some(t=>/Lease Contracts/i.test(t)), tabs.join(' | '));
// A tab key with no glyph in the icon map printed the word "undefined" in front
// of its own label, which is what happened here the first time this ran.
check('no tab prints "undefined" in front of its label',
  !tabs.some(t=>/undefined/.test(t)), tabs.join(' | '));

await page.locator('[data-section="leases"]').first().dispatchEvent('click');
await page.waitForSelector('[data-lease]', { timeout:8000 });

/* -------------------------------------------------------------- the tiles */
const tiles = (await page.locator('.viz-tiles, .viz-tile').first().innerText().catch(()=>'')) ||
  await page.locator('.workbench-body').innerText();
check('the screen leads with units contracted and units tagged',
  /33/.test(tiles) && /19/.test(tiles), tiles.replace(/\n/g,' ').slice(0,180));
check('the untagged gap is stated, not left to be worked out',
  /\b9\b/.test(tiles), 'expected 28 live units less 19 tagged = 9');

/* ------------------------------------------------------------- the register */
const headers = await page.locator('.workspace-card table thead th').allTextContents();
check('the register carries contracted, tagged, untagged and the money',
  headers.includes('Units') && headers.includes('Tagged out') && headers.includes('Untagged')
  && headers.includes('Rate / day') && headers.includes('Contract value'),
  headers.join(' | '));
const cells = await page.locator('.workspace-card table tbody tr').first().locator('td').count();
check('every row has a cell for every header', cells === headers.length,
  `${cells} cells vs ${headers.length} headers`);

const rowText = async n => (await page.locator('.workspace-card table tbody tr').nth(n).innerText()).replace(/\n/g,' ');
const amico = await rowText(0);
check('a contract with a gap shows the gap', /\b9\b/.test(amico), amico);
check('a contract with no paper says so', /none/i.test(amico), amico);
const jamo = await rowText(1);
check('a fully tagged contract shows no gap and its paper',
  jamo.includes('2 files') && !/none/i.test(jamo), jamo);

// The gap is the number somebody acts on, so it must not read as ordinary text.
check('the gap is marked, not buried in the row',
  await page.locator('.workspace-card table tbody tr').first().locator('.needs-item').count() >= 1);

await page.screenshot({ path:SHOTS+'lease-contracts.png', fullPage:true });

/* ------------------------------------------------------------ the contract */
await page.locator('tr:has-text("LSE-0001") td').first().click();
await page.waitForSelector('#modalBody .workspace-kpis', { timeout:5000 });
const detail = (await page.locator('#modalBody').innerText()).replace(/\n/g,' ');
check('the contract opens on contracted against tagged',
  detail.includes('20') && detail.includes('Tagged out now'), detail.slice(0,180));
check('the contract names its untagged units',
  /not yet tagged/i.test(detail), detail.slice(0,220));
check('a returned unit is shown with its reason, not hidden',
  detail.includes('Swapped for a D400'), detail.slice(0,260));
check('an open deployment offers a return, a closed one does not',
  await page.locator('#modalBody [data-return-unit]').count() === 1);
check('a contract with no paper still offers the uploader',
  await page.locator('#modalBody #leaseDoc').count() === 1);

await page.screenshot({ path:SHOTS+'lease-contract-detail.png', fullPage:true });

/* ------------------------------------------------------------- tagging out */
await page.locator('#modalBody #leaseTag').click();
await page.waitForSelector('#leaseDeployForm', { timeout:5000 });

const geom = await page.evaluate(()=>{
  const form = document.querySelector('#leaseDeployForm');
  const box = e => { const r = e.getBoundingClientRect(); return { t:r.top, b:r.bottom, l:r.left, w:r.width }; };
  return { form:box(form), note:box(form.querySelector('.modal-note')),
    field:box(form.querySelector('textarea[name="serials"]')),
    actions:box(form.querySelector('.modal-actions')) };
});
check('the serial box sits below the customer line, not beside it',
  geom.note.b <= geom.field.t + 1,
  `note bottom ${Math.round(geom.note.b)} vs field top ${Math.round(geom.field.t)}`);
check('the buttons sit below the serial box, not beside it',
  geom.actions.t >= geom.field.b - 1,
  `buttons top ${Math.round(geom.actions.t)} vs field bottom ${Math.round(geom.field.b)}`);
check('the serial box uses the width of the form',
  geom.field.w > geom.form.w * 0.8, `field ${Math.round(geom.field.w)} of ${Math.round(geom.form.w)}`);

// Empty is refused on the page, before it ever reaches the server.
await page.locator('#leaseDeployForm button[type="submit"]').click();
await page.waitForTimeout(300);
check('an empty tagging is refused without a round trip', deployPosted === null,
  JSON.stringify(deployPosted));

await page.locator('#leaseDeployForm textarea[name="serials"]')
  .fill('R5FBM0000000007\nR5FBM0000000008');
await page.locator('#leaseDeployForm input[name="note"]').fill('Delivered to the Pasig yard');
await page.locator('#leaseDeployForm button[type="submit"]').click();
await page.waitForTimeout(600);
check('the serials are sent as separate units, not one string',
  Array.isArray(deployPosted?.serials) && deployPosted.serials.length === 2
  && deployPosted.serials[0] === 'R5FBM0000000007',
  JSON.stringify(deployPosted));
check('the note travels with them', deployPosted?.note === 'Delivered to the Pasig yard');

/*
 * A refusal exists so somebody looks at it. "1 refused" is not something
 * anybody can act on; the serial and the customer holding it are.
 */
await page.waitForSelector('#refusedOk', { timeout:5000 });
const refused = (await page.locator('#modalBody').innerText()).replace(/\n/g,' ');
check('a refused serial is named', refused.includes('R5FBM0000000008'), refused.slice(0,200));
check('a refusal says who already has it',
  /Jamo Business Solutions Corp\./.test(refused) && /LSE-0002/.test(refused), refused.slice(0,240));
await page.screenshot({ path:SHOTS+'lease-tag-refused.png', fullPage:true });
await page.locator('#refusedOk').click();
await page.waitForTimeout(400);

/* --------------------------------------------------------------- returning */
await page.locator('tr:has-text("LSE-0001") td').first().click();
await page.waitForSelector('#modalBody [data-return-unit]', { timeout:5000 });
await page.locator('#modalBody [data-return-unit]').first().click();
await page.waitForSelector('#leaseReturnForm', { timeout:5000 });
await page.locator('#leaseReturnForm input[name="reason"]').fill('End of term');
await page.locator('#leaseReturnForm button[type="submit"]').click();
await page.waitForTimeout(600);
check('the return names the unit and why it came back',
  returnPosted?.serials?.[0] === 'R5FBM0000000001' && returnPosted?.reason === 'End of term',
  JSON.stringify(returnPosted));

/* ------------------------------------------------------- the rate, typed in */
/*
 * Sixteen of the real contracts arrived with the rate cell blank. The screen
 * has to say so, offer the box, and show the money the rate implies while it is
 * being typed - a value typed separately is the same fact recorded twice.
 */
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('tr:has-text("LSE-0001") [data-rate-lease]').click();
await page.waitForSelector('#leaseRateForm', { timeout:5000 });
check('the rate box starts empty when no rate ever arrived',
  await page.locator('#leaseRateForm input[name="dailyRateVatEx"]').inputValue() === '',
  await page.locator('#leaseRateForm input[name="dailyRateVatEx"]').inputValue());
check('the term and units come in already filled',
  await page.locator('#leaseRateForm input[name="unitCount"]').inputValue() === '20'
  && await page.locator('#leaseRateForm input[name="effectiveDate"]').inputValue() === '2026-02-01');
check('with no rate the screen says there is no value yet',
  /No value yet/i.test(await page.locator('#leaseRateValue').innerText()),
  await page.locator('#leaseRateValue').innerText());

await page.locator('#leaseRateForm input[name="dailyRateVatEx"]').fill('210');
await page.waitForTimeout(200);
// 210 x 20 units x 364 days between 1 Feb 2026 and 31 Jan 2027.
const preview = await page.locator('#leaseRateValue').innerText();
check('the value follows the rate as it is typed', preview.includes('1,528,800.00'), preview);

const rateGeom = await page.evaluate(()=>{
  const form = document.querySelector('#leaseRateForm');
  const box = e => { const r = e.getBoundingClientRect(); return { t:r.top, b:r.bottom, w:r.width }; };
  return { form:box(form), grid:box(form.querySelector('.form-grid')),
    actions:box(form.querySelector('.modal-actions')),
    cols:getComputedStyle(form.querySelector('.form-grid')).gridTemplateColumns.split(' ').length };
});
check('the terms lay out in more than one column', rateGeom.cols >= 2, rateGeom.cols + ' column(s)');
check('the buttons sit below the fields, not beside them',
  rateGeom.actions.t >= rateGeom.grid.b - 1,
  `buttons top ${Math.round(rateGeom.actions.t)} vs fields bottom ${Math.round(rateGeom.grid.b)}`);
check('the fields use the width of the form',
  rateGeom.grid.w > rateGeom.form.w * 0.9,
  `fields ${Math.round(rateGeom.grid.w)} of ${Math.round(rateGeom.form.w)}`);

await page.screenshot({ path:SHOTS+'lease-rate.png', fullPage:true });
await page.locator('#leaseRateForm button[type="submit"]').click();
await page.waitForTimeout(600);
check('the rate is sent, and the value is not sent alongside it',
  ratePosted && String(ratePosted.dailyRateVatEx) === '210'
  && String(ratePosted.unitCount) === '20' && ratePosted.orderValue === undefined,
  JSON.stringify(ratePosted));

check('no script errors', errors.length === 0, errors.slice(0,3).join(' | ') || 'clean');

await browser.close();
server.close();

console.log('\n=== Lease contracts and unit tagging ===');
for (const [s,n,note] of results) console.log(`${s}  ${n}${note ? '  ·  ' + note : ''}`);
const failed = results.filter(r=>r[0]==='FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
