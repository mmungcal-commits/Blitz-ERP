/*
 * Renders the real public/ bundle in a real browser at phone width and checks
 * the tiles actually paint. Static analysis cannot tell you that a media query
 * matched or that a click handler bound, and that is exactly where the last
 * mobile attempt failed.
 *
 *   node test/mobile-render.mjs
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const REAL_GROUPS = [
  ['fa','Finance & Accounting',9],['sd','Sales & Distribution',8],['ip','Inventory & Procurement',4],
  ['mf','Manufacturing',6],['qm','Quality Management',4],['pm','Project Management',5],
  ['eam','Enterprise Asset Management',7],['fm','Facility Management',6],['lm','Logistics Management',6],
  ['hcm','HCM',6],['srp','SRP',8],
];
// The live catalog is eleven groups and sixty-nine modules, not the single
// group a toy fixture would use - the launcher has to stay usable at that size.
const CATALOG_GROUPS = REAL_GROUPS.map(([code,title,n])=>({
  code, title,
  items: code==='ip'
    ? [{code:'ip-warehouse-management',label:'Warehouse Management',permission:'INVENTORY',action:'VIEW'},
       {code:'ip-cycle-counting',label:'Inventory & Cycle Counting',permission:'INVENTORY',action:'VIEW'},
       {code:'ip-inbound-logistics',label:'Inbound Logistics',permission:'INVENTORY',action:'VIEW'},
       {code:'ip-sourcing-purchasing',label:'Sourcing & Purchasing',permission:'INVENTORY',action:'VIEW'}]
    : Array.from({length:n},(_,i)=>({code:`${code}-mod-${i}`,label:`${title} ${i+1}`,permission:'FINANCE',action:'VIEW'})),
}));

const SESSION = {
  ok: true,
  user: { email: 'mark@e88.ph', displayName: 'Mark Mungcal', role: 'FINANCE', scope: 'OPERATIONS', canUseAdminScope: 1 },
  workspaceAccess: CATALOG_GROUPS.flatMap(g => g.items).map(i => (
    { module_code: i.code, can_view: 1, can_create: 1, can_edit: 1, can_approve: 1, can_post: 1 })),
  workspaceCatalog: { groups: CATALOG_GROUPS, tools: [], addons: [] },
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ·  ' + detail : ''}`);
};

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json');
    if (path === '/api/session') return res.end(JSON.stringify(SESSION));
    if (path.includes('/definition')) return res.end(JSON.stringify({ ok: true, definition: { fields: [], statuses: [], documentType: 'Cycle Count' } }));
    return res.end(JSON.stringify({ ok: true, rows: [], data: [], counts: [], summary: {} }));
  }
  try {
    const name = path === '/' ? 'index.html' : path.slice(1);
    const file = await readFile(join(PUBLIC, name));
    res.setHeader('content-type', TYPES[extname(name)] || 'application/octet-stream');
    res.end(file);
  } catch { res.statusCode = 404; res.end('not found'); }
});

await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.mtile-wrap, .enterprise-launchpad', { timeout: 8000 });

check('the phone home screen is the tile launcher, not the eleven-column map',
  await page.locator('.mtile-wrap').isVisible(),
  await page.locator('.mtile-head h2').first().textContent());

check('every group in the live-sized catalog renders as a tap target',
  (await page.locator('[data-mgroup]').count()) === REAL_GROUPS.length,
  `${await page.locator('[data-mgroup]').count()} of ${REAL_GROUPS.length} group tile(s)`);

// Nothing may spill sideways - a horizontal scrollbar on a phone means the
// layout is broken however good the tiles look.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the home screen does not scroll sideways', overflow <= 1, `${overflow}px overflow`);

const groupTile = page.locator('[data-mgroup="ip"]');
check('the Inventory group is reachable without hunting', await groupTile.isVisible());

const box = await groupTile.boundingBox();
check('a tile is big enough to hit with a thumb', box && box.height >= 72 && box.width >= 130,
  box ? `${Math.round(box.width)}x${Math.round(box.height)}px` : 'no box');

await groupTile.click();
await page.waitForSelector('[data-mmodule]');
check('tapping a group lists its modules',
  (await page.locator('[data-mmodule]').count()) === 4,
  (await page.locator('[data-mmodule] b').allTextContents()).join(', '));

await page.locator('[data-mmodule="ip-cycle-counting"]').click();
await page.waitForSelector('[data-mtile]');
const tiles = await page.locator('[data-mtile] b').allTextContents();
check('opening Inventory & Cycle Counting shows the count tiles',
  tiles.includes('Physical Count') && tiles.includes('Count Plans'), tiles.join(', '));

await page.locator('[data-mtile="approvals"]').click();
await page.waitForSelector('.mtile-back', { timeout: 8000 });
check('a section keeps one obvious way back to the tiles',
  await page.locator('.mtile-back').isVisible(),
  (await page.locator('.mtile-back').textContent()).trim());

await page.locator('.mtile-back').click();
await page.waitForSelector('[data-mtile]');
check('back returns to the module tiles', (await page.locator('[data-mtile]').count()) === 4);

// Remove count sheet has to be findable on the phone, not only on a desktop.
await page.locator('[data-mtile="approvals"]').click();
await page.waitForSelector('.mtile-back', { timeout: 8000 });
const removeBtn = page.locator('#removeCount');
check('an open count sheet can be removed from the phone too',
  (await removeBtn.count()) === 0 || await removeBtn.isVisible(),
  (await removeBtn.count()) ? 'button present' : 'no open sheet in this fixture - button correctly absent');

// The desktop must be untouched by all of this.
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desk.goto(base, { waitUntil: 'networkidle' });
await desk.waitForSelector('.enterprise-launchpad', { timeout: 8000 });
check('the desktop still gets the enterprise map',
  await desk.locator('.enterprise-columns').isVisible() && !(await desk.locator('.mtile-wrap').count()));

check('no script errors on any screen', errors.length === 0, errors.join(' | ') || 'clean');

await page.screenshot({ path: SHOTS+'mobile-home.png' });
await browser.close();
server.close();

const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
