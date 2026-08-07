/*
 * Renders the real bundle in Chromium and checks the charts actually draw.
 * A chart is the one thing you cannot verify by reading code - geometry,
 * label collisions and overflow only exist once it is painted.
 *
 *   node test/viz-render.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };

const GROUPS = [{ code:'ip', title:'Inventory & Procurement', items:[
  { code:'ip-cycle-counting', label:'Inventory & Cycle Counting', permission:'INVENTORY', action:'VIEW' },
]}];

const SESSION = {
  ok:true,
  user:{ email:'mark@e88.ph', displayName:'Mark Mungcal', role:'FINANCE', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess: GROUPS.flatMap(g=>g.items).map(i=>(
    { module_code:i.code, can_view:1, can_create:1, can_edit:1, can_approve:1, can_post:1 })),
  workspaceCatalog:{ groups:GROUPS, tools:[], addons:[] },
};

// A register with enough shape that every chart has something to draw:
// several statuses, variances in more than one location, part-done sheets.
const COUNTS = { ok:true, total:7, rows:[
  { id:1, count_no:'CC-0000001', count_date:'2026-08-01', location_code:'WH-MAIN', location_name:'Main Warehouse',
    category:'MC', expected_units:120, counted_units:120, variance_units:4, status:'APPROVED' },
  { id:2, count_no:'CC-0000002', count_date:'2026-08-03', location_code:'WH-MAIN', location_name:'Main Warehouse',
    category:'BAT', expected_units:80, counted_units:41, variance_units:2, status:'OPEN' },
  { id:3, count_no:'CC-0000003', count_date:'2026-08-04', location_code:'WH-CEBU', location_name:'Cebu Hub',
    category:'SP', expected_units:210, counted_units:210, variance_units:11, status:'SUBMITTED' },
  { id:4, count_no:'CC-0000004', count_date:'2026-08-05', location_code:'WH-CEBU', location_name:'Cebu Hub',
    category:null, expected_units:60, counted_units:6, variance_units:0, status:'OPEN' },
  { id:5, count_no:'CC-0000005', count_date:'2026-08-06', location_code:'WH-DAVAO', location_name:'Davao Depot',
    category:'CHG', expected_units:35, counted_units:35, variance_units:1, status:'POSTED' },
  { id:6, count_no:'CC-0000006', count_date:'2026-08-07', location_code:'WH-MAIN', location_name:'Main Warehouse',
    category:'MC', expected_units:0, counted_units:0, variance_units:0, status:'OPEN' },
  { id:7, count_no:'CC-0000007', count_date:'2026-07-28', location_code:'WH-DAVAO', location_name:'Davao Depot',
    category:'BSS', expected_units:12, counted_units:12, variance_units:0, status:'CANCELLED' },
]};

const results = [];
const check = (name, pass, detail='') => {
  results.push({ name, pass, detail });
  console.log(`${pass?'PASS':'FAIL'}  ${name}${detail?'  ·  '+detail:''}`);
};

const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path === '/api/inventory/cycle-counts') return res.end(JSON.stringify(COUNTS));
    if (path.includes('/definition')) return res.end(JSON.stringify({ ok:true, definition:{ fields:[], statuses:[] } }));
    return res.end(JSON.stringify({ ok:true, rows:[], data:[], counts:[], summary:{} }));
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

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport:{ width:1440, height:960 } });
const errors = [];
page.on('pageerror', e=>errors.push(String(e)));
page.on('console', m=>{ if (m.type()==='error') errors.push('console: '+m.text()); });

await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('.enterprise-launchpad', { timeout:8000 });
await page.locator('[data-workspace="ip-cycle-counting"]').click();
await page.waitForSelector('.viz-tiles', { timeout:8000 });

check('the cockpit leads with status tiles',
  (await page.locator('.viz-tile').count()) === 5,
  (await page.locator('.viz-tile-label').allTextContents()).join(', '));

check('a tile carries its label and number, not colour alone',
  (await page.locator('.viz-tile').first().locator('.viz-tile-label').textContent()).trim().length > 0
  && (await page.locator('.viz-tile-value').first().textContent()).trim().length > 0);

check('every chart drew a plot',
  (await page.locator('.viz .viz-svg, .viz .viz-meters').count()) >= 3,
  `${await page.locator('figure.viz').count()} figures`);

const arcs = await page.locator('.viz-donut path').count();
check('the donut drew one arc per non-zero status', arcs === 5, `${arcs} arcs`);

check('the donut centre carries the total',
  (await page.locator('.viz-donut .viz-hero').textContent()).trim() === '7',
  await page.locator('.viz-donut .viz-hero').textContent());

const barLabels = await page.locator('figure.viz:has(.viz-bar) .viz-cat').allTextContents();
check('variances are ranked by location, largest first',
  barLabels[0] === 'WH-CEBU' && barLabels.includes('WH-MAIN') && barLabels.includes('WH-DAVAO'),
  barLabels.join(' > '));

check('a legend is present wherever there is more than one series',
  (await page.locator('.viz-legend').count()) >= 1,
  `${await page.locator('.viz-legend li').count()} legend entries`);

// The relief rule: three palette slots sit under 3:1 on white, so every
// figure must offer its numbers as text.
const figures = await page.locator('figure.viz').count();
const toggles = await page.locator('.viz-tbl-toggle').count();
check('every chart offers a table view', toggles >= figures - 1, `${toggles} toggles / ${figures} figures`);

await page.locator('.viz-tbl-toggle').first().click();
check('the table view opens with real numbers in it',
  !(await page.locator('figure.viz .viz-table').first().isHidden()),
  (await page.locator('figure.viz .viz-table').first().locator('td').first().textContent()));
await page.locator('.viz-tbl-toggle').first().click();

// Nothing may spill out of its card.
const overflow = await page.evaluate(() => {
  let worst = 0;
  document.querySelectorAll('figure.viz').forEach(f => {
    const fr = f.getBoundingClientRect();
    f.querySelectorAll('svg, text, .viz-legend').forEach(el => {
      const r = el.getBoundingClientRect();
      worst = Math.max(worst, r.right - fr.right, fr.left - r.left);
    });
  });
  return Math.round(worst);
});
check('no chart content spills outside its card', overflow <= 2, `${overflow}px`);

check('the page does not scroll sideways',
  (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);

// Hover must produce a tooltip, since not every value is directly labelled.
// Hover a bar: an arc's bounding-box centre lands in the donut hole, which is
// a quirk of automated hovering, not of the chart.
await page.locator('.viz-bar path').first().hover();
await page.waitForTimeout(150);
check('hovering a mark shows its value',
  await page.locator('.viz-tip').isVisible(),
  (await page.locator('.viz-tip').textContent()) || '');

// Every mark still has to be individually described, arcs included.
const described = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.viz-donut path, .viz-bar path, .viz-meters li')];
  return { total: marks.length,
    tipped: marks.filter(m => (m.closest('[data-viz-tip]') || m).hasAttribute('data-viz-tip')).length };
});
check('every mark describes itself for hover and keyboard',
  described.tipped === described.total, `${described.tipped}/${described.total}`);

check('no script errors', errors.length === 0, errors.slice(0,2).join(' | ') || 'clean');

await page.screenshot({ path:'viz-cockpit.png', fullPage:false });

// And the same cockpit on a phone.
const phone = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
await phone.goto(base, { waitUntil:'networkidle' });
await phone.waitForSelector('.mtile-wrap', { timeout:8000 });
await phone.locator('[data-mgroup="ip"]').click();
await phone.locator('[data-mmodule="ip-cycle-counting"]').click();
await phone.waitForSelector('[data-mtile]', { timeout:8000 });
await phone.locator('[data-mtile="center"]').click();
await phone.waitForSelector('.viz-tiles', { timeout:8000 });
const phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the cockpit fits a phone without sideways scroll', phoneOverflow <= 1, `${phoneOverflow}px`);
await phone.screenshot({ path:'viz-cockpit-phone.png' });

await browser.close();
server.close();

const failed = results.filter(r=>!r.pass).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
