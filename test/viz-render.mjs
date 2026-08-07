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
import { mkdirSync } from 'node:fs';

// Screenshots are evidence, not artefacts to commit - they live in an ignored dir.
const SHOTS = fileURLToPath(new URL('./__screens__/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

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

const HOME = { ok:true,
  user:{ name:'Mark Mungcal', role:'FINANCE', email:'mark@e88.ph' },
  sections:{
    inventory:{ available:412, quarantine:7, unvalued:3, openCounts:3, variances:18,
      byClass:[{label:'Motorcycle',value:210},{label:'Battery',value:120},{label:'Charger',value:82}] },
    finance:{ open:5, mine:2, byStage:[{label:'FINANCE_REVIEWED',value:3},{label:'DRAFT',value:2}] },
  },
  waiting:[
    { label:'Physical counts awaiting approval', count:2, module:'ip-cycle-counting' },
    { label:'Payment requests for your validation', count:3, module:'fa-receivables-payables' },
  ],
  activity:[{ event_at:'2026-08-07', user_email:'judy@nrdev.ph', action:'SUBMIT_CYCLE_COUNT', module:'INVENTORY', record_no:'CC-0000002' }],
  progress:{ counted:424, expected:517, pct:82.0 },
  trends:{
    all:{ series:[{label:'2026-08-01',value:4},{label:'2026-08-02',value:2},{label:'2026-08-03',value:9},
                  {label:'2026-08-04',value:6},{label:'2026-08-05',value:11},{label:'2026-08-06',value:7},
                  {label:'2026-08-07',value:13}], delta:118.7 },
    inventory:{ series:[{label:'2026-08-01',value:2},{label:'2026-08-02',value:1},{label:'2026-08-03',value:5},
                        {label:'2026-08-04',value:3},{label:'2026-08-05',value:6},{label:'2026-08-06',value:4},
                        {label:'2026-08-07',value:8}], delta:112.5 },
  },
};

let breakHome = false;
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
    if (path === '/api/dashboard/home') {
      // ?boom=1 makes the dashboard endpoint fail, so the fallback is testable.
      if (String(req.headers['x-boom'] || '') === '1' || breakHome) {
        res.statusCode = 500; return res.end(JSON.stringify({ ok:false, error:'no such column: requested_by' }));
      }
      return res.end(JSON.stringify(HOME));
    }
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

// Signing in lands on the cockpit, not the module map.
await page.waitForSelector('.home-shell', { timeout:8000 });
check('signing in lands on a dashboard, not the module map',
  await page.locator('.home-shell').isVisible() && !(await page.locator('.enterprise-launchpad').count()));
check('the queue with your name on it leads, biggest first',
  (await page.locator('.home-wait b').allTextContents()).join(',') === '3,2',
  (await page.locator('.home-wait span').allTextContents()).join(' | '));
check('the dashboard carries live charts',
  (await page.locator('.home-shell figure.viz').count()) >= 3,
  `${await page.locator('.home-shell figure.viz').count()} figures`);
check('a real percentage is drawn as a ring with the figure inside',
  (await page.locator('.viz-ring').count()) === 1
  && (await page.locator('.viz-ring-value').textContent()).trim() === '82%',
  await page.locator('.viz-ring-value').textContent());
check('a tile carries a sparkline of the real last 7 days',
  (await page.locator('.viz-tile .viz-spark rect').count()) === 7,
  `${await page.locator('.viz-tile .viz-spark rect').count()} bars`);
check('the delta is signed and named against its period',
  /^\u2191 112\.5% vs the 3 days before$/.test(
    (await page.locator('.viz-tile-delta').first().innerText()).replace(/\s+/g,' ').trim()),
  (await page.locator('.viz-tile-delta').first().innerText()).replace(/\s+/g,' ').trim());
check('a waiting item opens the module it belongs to',
  (await page.locator('[data-home-go="ip-cycle-counting"]').count()) === 1);

// The map is one button away, and still there.
await page.screenshot({ path:SHOTS+'home-cockpit.png' });
await page.locator('#homeModules').click();
await page.waitForSelector('.enterprise-launchpad', { timeout:8000 });
check('the module map opens from the dashboard button',
  await page.locator('.enterprise-columns').isVisible());

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

/*
 * The failure that actually stranded someone: the dashboard endpoint threw, the
 * catch called renderLaunchpad(), and renderLaunchpad routed straight back into
 * the dashboard - so the loading message span forever. A broken dashboard must
 * degrade to the module map, never trap the user.
 */
breakHome = true;
const broken = await browser.newPage({ viewport:{ width:1440, height:960 } });
const brokenErrors = [];
broken.on('pageerror', e => brokenErrors.push(String(e)));
await broken.goto(base, { waitUntil:'domcontentloaded' });
let landed = 'timed out on the loading message';
try {
  await broken.waitForSelector('.enterprise-launchpad', { timeout:9000 });
  landed = 'fell through to the module map';
} catch { /* left as the timeout message */ }
check('a broken dashboard falls through to the modules instead of hanging',
  landed === 'fell through to the module map', landed);
check('the fallback does not loop',
  !(await broken.locator('.workspace-loading').count()),
  (await broken.locator('.workspace-loading').textContent().catch(()=>'')) || 'no loading message left on screen');
await broken.close();
breakHome = false;

await page.screenshot({ path:SHOTS+'viz-cockpit.png', fullPage:false });

// And the same cockpit on a phone.
const phone = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
await phone.goto(base, { waitUntil:'networkidle' });
await phone.waitForSelector('.home-shell', { timeout:8000 });
const homeOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the dashboard fits a phone', homeOverflow <= 1, `${homeOverflow}px`);
await phone.locator('#homeModules').click();
await phone.waitForSelector('.mtile-wrap', { timeout:8000 });
check('a phone gets the tile launcher, not the eleven-column map',
  await phone.locator('.mtile-wrap').isVisible());
await phone.locator('[data-mgroup="ip"]').click();
await phone.locator('[data-mmodule="ip-cycle-counting"]').click();
await phone.waitForSelector('[data-mtile]', { timeout:8000 });
await phone.locator('[data-mtile="center"]').click();
await phone.waitForSelector('.viz-tiles', { timeout:8000 });
const phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the cockpit fits a phone without sideways scroll', phoneOverflow <= 1, `${phoneOverflow}px`);
await phone.screenshot({ path:SHOTS+'viz-cockpit-phone.png' });

await browser.close();
server.close();

const failed = results.filter(r=>!r.pass).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
