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
  { code:'ip-warehouse-management', label:'Warehouse Management', permission:'INVENTORY', action:'VIEW' },
]},{ code:'fa', title:'Finance & Accounting', items:[
  { code:'fa-receivables-payables', label:'Payables Management', permission:'FINANCE', action:'VIEW' },
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
    { label:'Physical counts awaiting approval', count:2, module:'ip-cycle-counting#approvals' },
    { label:'Payment requests for your validation', count:3, module:'fa-receivables-payables#records' },
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
let zeroHome = null;
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
      return res.end(JSON.stringify(zeroHome || HOME));
    }
    if (path.includes('/definition')) return res.end(JSON.stringify({ ok:true, definition:{ fields:[], statuses:[] } }));
    // A generic stub still has to carry the shapes the screens destructure,
    // or a passing navigation looks like a failure.
    return res.end(JSON.stringify({ ok:true, rows:[], data:[], counts:[], items:[],
      byLocation:[], summary:{}, total:0, lines:[] }));
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
check('the activity feed is gone from the landing page',
  (await page.locator('.home-feed').count()) === 0);
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
  (await page.locator('[data-home-go="ip-cycle-counting#approvals"]').count()) === 1);

// A number you cannot click is a dead end.
check('every destination names a section, not just a module',
  (await page.evaluate(() => [...document.querySelectorAll('[data-viz-open],[data-home-go]')]
     .map(e => e.getAttribute('data-viz-open') || e.getAttribute('data-home-go'))
     .every(d => d.includes('#')))),
  (await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-viz-open]')]
     .map(e => e.getAttribute('data-viz-open')))].join(' | '))));
check('every stat tile is clickable and points somewhere',
  (await page.locator('.viz-tile.is-clickable').count()) === 5,
  `${await page.locator('.viz-tile.is-clickable').count()} of ${await page.locator('.viz-tile').count()}`);
// The activity trend spans every module, so it has no single home and stays
// unclickable rather than pretending to lead somewhere.
check('every card with a natural home is a way into it',
  (await page.locator('.home-shell figure.viz-clickable').count()) >= 3
  && (await page.locator('.viz-open').count()) >= 3,
  (await page.locator('.viz-open').allTextContents()).join(' | '));
// Every card on the dashboard now leads somewhere, so the affordance and the
// destination must agree exactly - no card claiming a link it does not have.
check('every card that shows an Open affordance actually has a destination',
  (await page.locator('.home-shell figure.viz .viz-open').count())
    === (await page.locator('.home-shell figure.viz-clickable').count()),
  `${await page.locator('.home-shell .viz-open').count()} affordances / ${await page.locator('.home-shell figure.viz-clickable').count()} clickable`);

// Clicking a tile actually lands in the module, not just visually reacts.
// A card opens the register the number came from, not the module's front page.
await page.locator('.viz-tile[data-viz-open="ip-cycle-counting#records"]').first().click();
await page.waitForFunction(() => document.body.classList.contains('workbench-view'), { timeout:8000 });
await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent?.includes('Count Plans'), { timeout:8000 });
check('clicking a tile opens the source records, not the module front page',
  (await page.locator('#pageTitle').textContent()).includes('Cycle Counting')
  && (await page.locator('.nav-item.active').textContent()).includes('Count Plans'),
  (await page.locator('#pageTitle').textContent())+' \u203a '+(await page.locator('.nav-item.active').textContent()));
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('.home-shell', { timeout:8000 });

// And so does the card, without the Table toggle hijacking it.
await page.locator('figure.viz-clickable').first().locator('.viz-tbl-toggle').click();
check('the table toggle inside a clickable card does not navigate',
  await page.locator('.home-shell').isVisible());
await page.locator('figure.viz-clickable').first().locator('.viz-tbl-toggle').click();
const card = page.locator('figure[data-viz-open="ip-warehouse-management#records"]');
await card.locator('.viz-title').click();
await page.waitForFunction(() => document.body.classList.contains('workbench-view'), { timeout:8000 });
await page.waitForFunction(() => document.querySelector('.nav-item.active')?.textContent?.includes('Unit Visibility'), { timeout:8000 });
check('clicking a chart card opens its source register',
  (await page.locator('#pageTitle').textContent()).includes('Warehouse')
  && (await page.locator('.nav-item.active').textContent()).includes('Unit Visibility'),
  (await page.locator('#pageTitle').textContent())+' \u203a '+(await page.locator('.nav-item.active').textContent()));
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('.home-shell', { timeout:8000 });

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
 * Finance's dashboard: the six numbers they asked for, over a period they can
 * change. A management report without a stated period is not a report.
 */
const FIN = JSON.parse(JSON.stringify(HOME));
FIN.department = 'Finance';
FIN.period = { from:'2026-08-01', to:'2026-08-08' };
FIN.focus = ['management','finance','inventory'];
FIN.sections.management = { period:{from:'2026-08-01',to:'2026-08-08'},
  pendingApprovals:7, pendingApprovalValue:842000, pendingMine:3,
  availableUnits:412, leasedUnits:96, soldUnits:31, deployedUnits:12,
  billed:1250000, collected:975000, outstanding:275000, invoices:18,
  collectionPct:78, receivablesPct:22, overdue:64000, overdueCount:3,
  aging:[{label:'Current',value:180000},{label:'1-30 days',value:61000},{label:'Over 90 days',value:34000}] };
zeroHome = FIN;
const fin = await browser.newPage({ viewport:{ width:1440, height:1100 } });
await fin.goto(base, { waitUntil:'networkidle' });
await fin.waitForSelector('.viz-tiles', { timeout:8000 });
// The labels are uppercased by CSS, so compare on the text, not its casing.
const finLabels = (await fin.locator('.viz-tile-label').allTextContents()).map(t=>t.trim().toUpperCase());
check('Finance leads with the six numbers it asked for',
  ['PENDING APPROVALS','AVAILABLE UNITS','LEASED UNITS','SOLD UNITS','COLLECTION','RECEIVABLES']
    .every(l => finLabels.includes(l)), finLabels.join(', '));
// Pending approval is the RFP queue, not a mix of every module's backlog.
check('pending approvals counts RFPs in the chain, and says how many are yours',
  (await fin.locator('.viz-tile:has-text("Pending approvals") .viz-tile-value').first().innerText()).trim() === '7'
  && (await fin.locator('.viz-tile:has-text("Pending approvals") small').first().innerText()).includes('3 waiting on you'),
  (await fin.locator('.viz-tile:has-text("Pending approvals") small').first().innerText()).trim());
check('the period is stated and changeable',
  (await fin.locator('#homeFrom').inputValue()) === '2026-08-01'
  && (await fin.locator('#homeTo').inputValue()) === '2026-08-08'
  && (await fin.locator('[data-range]').count()) === 4,
  `${await fin.locator('[data-range]').count()} presets`);
check('collection and receivables are drawn, not just stated',
  (await fin.locator('.viz-ring-value').first().textContent()).trim() === '78%'
  && (await fin.locator('figure.viz').count()) >= 3,
  `${await fin.locator('figure.viz').count()} figures`);
check('a rate reads as a rate, not a bare number',
  (await fin.locator('.viz-tile:has-text("Collection") .viz-tile-value').first().innerText()).replace(/\s/g,'') === '78%',
  (await fin.locator('.viz-tile:has-text("Collection") .viz-tile-value').first().innerText()).replace(/\s/g,''));
check('the department is named on the greeting',
  (await fin.locator('.home-hello p').textContent()).includes('Finance'),
  (await fin.locator('.home-hello p').textContent()).trim());
await fin.screenshot({ path:SHOTS+'home-finance.png' });
await fin.close();
zeroHome = null;

/*
 * The shape the live system is actually in: inventory empty, no finance data,
 * no counting progress - so every card but one falls away and a single chart
 * is left alone in a full-width row. That is where it ballooned.
 */
const SPARSE = JSON.parse(JSON.stringify(HOME));
SPARSE.sections = {
  inventory:{ available:0, quarantine:0, unvalued:0, openCounts:2, variances:180, byClass:[] },
  management:{ period:{from:'2026-08-01',to:'2026-08-08'}, pendingApprovals:0, pendingApprovalValue:0,
    pendingMine:0, availableUnits:0, leasedUnits:0, soldUnits:0, deployedUnits:0,
    billed:0, collected:0, outstanding:0, invoices:0,
    collectionPct:null, receivablesPct:null, overdue:0, overdueCount:0, aging:[] },
};
SPARSE.waiting = [];
SPARSE.progress = null;
SPARSE.trends = { all:{ series:[{label:'2026-08-02',value:1},{label:'2026-08-03',value:2},
  {label:'2026-08-04',value:3},{label:'2026-08-05',value:5},{label:'2026-08-06',value:9},
  {label:'2026-08-07',value:40},{label:'2026-08-08',value:377}], delta:null } };
zeroHome = SPARSE;
const sparse = await browser.newPage({ viewport:{ width:1740, height:1000 } });
await sparse.goto(base, { waitUntil:'networkidle' });
await sparse.waitForSelector('.home-shell figure.viz', { timeout:8000 });
const chartBox = await sparse.locator('.home-shell figure.viz').first().boundingBox();
check('a lone chart does not balloon to fill the page',
  chartBox.height <= 420, `${Math.round(chartBox.width)}x${Math.round(chartBox.height)}px`);
check('a chart card stays a sensible width even when it is the only one',
  chartBox.width <= 700, `${Math.round(chartBox.width)}px wide`);
const svgBox = await sparse.locator('.home-shell .viz-svg').first().boundingBox();
check('the plot itself is bounded', svgBox.height <= 320, `${Math.round(svgBox.height)}px tall`);

// A daily tally is discrete: six quiet days then one busy one is a row of
// empty columns and one tall one, not a flat line that suddenly climbs.
// The circles hold their place on an empty system: a card that vanishes reads
// as a screen that failed to load, an empty ring reads as "none yet".
check('the circles are still there when there is nothing in them',
  (await sparse.locator('.home-shell .viz-donut.is-empty, .home-shell .viz-ring').count()) >= 4,
  `${await sparse.locator('.home-shell .viz-donut, .home-shell .viz-ring').count()} circles`);
check('an empty ring shows its track and no arc',
  (await sparse.locator('.home-shell .viz-ring .viz-ring-arc').count()) === 0,
  `${await sparse.locator('.home-shell .viz-ring').count()} rings, no arcs`);
check('an empty donut draws a track and a zero, not an apology',
  (await sparse.locator('.viz-donut.is-empty .viz-hero').first().textContent()).trim() === '0'
  && (await sparse.locator('.home-shell').innerText()).indexOf('Nothing to show yet') === -1);
check('the seven-day bar chart is gone',
  (await sparse.locator('.home-shell').innerText()).indexOf('Activity across') === -1);

// An empty system must say it is empty, not just show zeros.
check('a dashboard of zeros explains itself',
  (await sparse.locator('.home-empty').count()) === 1
  && (await sparse.locator('.home-empty').innerText()).includes('count sheet'),
  (await sparse.locator('.home-empty b').textContent()));
await sparse.screenshot({ path:SHOTS+'home-sparse.png' });
await sparse.close();
zeroHome = null;

/*
 * Zero must look like zero. A round line cap on a zero-length arc still paints
 * a dot, which reads as "a little bit" when the answer is none.
 */
const ZERO_HOME = JSON.parse(JSON.stringify(HOME));
ZERO_HOME.sections.inventory = { available:0, quarantine:0, unvalued:0, openCounts:0, variances:0, byClass:[] };
ZERO_HOME.progress = { counted:0, expected:120, pct:0 };
ZERO_HOME.trends = { inventory:{ series:[{label:'a',value:0},{label:'b',value:0},{label:'c',value:0}], delta:null } };
zeroHome = ZERO_HOME;
const zeros = await browser.newPage({ viewport:{ width:1440, height:960 } });
await zeros.goto(base, { waitUntil:'networkidle' });
await zeros.waitForSelector('.viz-ring', { timeout:8000 });
check('a ring at zero draws no arc at all',
  (await zeros.locator('.viz-ring .viz-ring-arc').count()) === 0
  && (await zeros.locator('.viz-ring circle').count()) === 1,
  `${await zeros.locator('.viz-ring circle').count()} circle(s), ${await zeros.locator('.viz-ring-arc').count()} arc(s)`);
check('the zero ring still says zero, quietly',
  (await zeros.locator('.viz-ring-value').textContent()).trim() === '0%'
  && (await zeros.locator('.viz-ring-value.is-zero').count()) === 1);
check('tiles reading zero stop wearing a status colour',
  (await zeros.locator('.viz-tile.is-zero').count()) === 5,
  `${await zeros.locator('.viz-tile.is-zero').count()} of ${await zeros.locator('.viz-tile').count()}`);
check('a flat history draws no sparkline',
  (await zeros.locator('.viz-spark').count()) === 0);
await zeros.screenshot({ path:SHOTS+'home-zero.png' });
await zeros.close();
zeroHome = null;

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

// Back to the dashboard: the checks above walked into a module.
await page.goto(base, { waitUntil:'networkidle' });
await page.waitForSelector('.home-grid > .viz', { timeout:8000 });

/*
 * The dashboard is arrangeable. Which number matters most is not the same
 * question every week, so the cards move and the order is remembered. Keys
 * rather than positions, or adding a card would shuffle everything below it.
 */
const keys = await page.evaluate(()=>[...document.querySelectorAll('.home-grid > .viz')]
  .map(c=>c.dataset.vizKey));
check('every card carries a key that survives a re-render',
  keys.length > 2 && keys.every(k=>k && /^[a-z0-9-]+$/.test(k)), keys.slice(0,4).join(', '));
check('the keys are distinct', new Set(keys).size === keys.length, keys.length+' cards');
check('the cards say they can be moved',
  await page.locator('.home-grid > .viz.viz-movable').count() === keys.length);
check('there is a way back to the order it shipped with',
  await page.locator('#homeResetLayout').count() === 1);

// Move the last card to the front with the keyboard, which is also the path
// anyone not using a mouse has to take.
await page.locator('.home-grid > .viz').last().focus();
for (let i = 0; i < keys.length - 1; i += 1)
  await page.keyboard.press('Alt+ArrowLeft');
const moved = await page.evaluate(()=>[...document.querySelectorAll('.home-grid > .viz')]
  .map(c=>c.dataset.vizKey));
check('a card can be moved to the front', moved[0] === keys[keys.length-1],
  `${moved[0]} vs ${keys[keys.length-1]}`);
check('the order is written down',
  await page.evaluate(()=>{ try{ const v=JSON.parse(localStorage.getItem('blitz-home-layout')||'[]');
    return Array.isArray(v) && v.length > 2; }catch(e){ return false; } }));

// And it survives a reload, which is the whole point of remembering it.
await page.reload({ waitUntil:'networkidle' });
await page.waitForSelector('.home-grid > .viz', { timeout:8000 });
const after = await page.evaluate(()=>[...document.querySelectorAll('.home-grid > .viz')]
  .map(c=>c.dataset.vizKey));
check('the arrangement survives a reload', after[0] === moved[0], `${after[0]} vs ${moved[0]}`);

// Reset puts it back rather than leaving the person stuck with their own mess.
await page.locator('#homeResetLayout').click();
await page.waitForTimeout(600);
const reset = await page.evaluate(()=>[...document.querySelectorAll('.home-grid > .viz')]
  .map(c=>c.dataset.vizKey));
check('reset restores the order it shipped with', reset[0] === keys[0], `${reset[0]} vs ${keys[0]}`);

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
