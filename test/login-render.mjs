/*
 * Renders the sign-in screen and checks it fits inside its own card.
 *
 * The heading overflowed the box because one rule reset its horizontal
 * padding to zero - invisible in the source, obvious on screen. This measures
 * geometry rather than trusting the CSS to say what it means.
 *
 *   node test/login-render.mjs
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

const results = [];
const check = (name, pass, detail='') => {
  results.push({ name, pass, detail });
  console.log(`${pass?'PASS':'FAIL'}  ${name}${detail?'  ·  '+detail:''}`);
};

// No session: the app must land on the sign-in screen.
const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok:false, error:'Not signed in' }));
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
const errors = [];

async function audit(page, label){
  await page.waitForSelector('.blitz-auth', { timeout:8000 });
  // Nothing inside the card may cross its edges, in either direction.
  const worst = await page.evaluate(() => {
    const card = document.querySelector('.blitz-auth');
    const cr = card.getBoundingClientRect();
    let over = 0, culprit = '';
    card.querySelectorAll('*').forEach(el => {
      if (!el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      const spill = Math.max(r.right - cr.right, cr.left - r.left);
      if (spill > over) { over = spill; culprit = el.tagName.toLowerCase()+'.'+(el.className||''); }
    });
    return { over: Math.round(over), culprit };
  });
  check(`${label}: nothing spills outside the card`, worst.over <= 1,
    worst.over ? `${worst.over}px from ${worst.culprit}` : 'flush');

  // The heading has to share the padding every other child uses.
  const aligned = await page.evaluate(() => {
    const l = el => el ? Math.round(el.getBoundingClientRect().left) : null;
    return { heading: l(document.querySelector('.auth-heading h1')),
      field: l(document.querySelector('.auth-field')),
      button: l(document.querySelector('.auth-submit')) };
  });
  check(`${label}: the heading sits inside the same padding as the form`,
    Math.abs(aligned.heading - aligned.field) <= 2 || aligned.heading > aligned.field,
    `heading ${aligned.heading} / field ${aligned.field} / button ${aligned.button}`);
  check(`${label}: the form and the button share one edge`,
    aligned.field === aligned.button, `${aligned.field} vs ${aligned.button}`);
}

const page = await browser.newPage({ viewport:{ width:1440, height:960 } });
page.on('pageerror', e=>errors.push(String(e)));
await page.goto(base, { waitUntil:'networkidle' });
await audit(page, 'desktop');

check('Operations is the default, with no choice to make',
  (await page.locator('[data-scope-pick]').count()) === 0
  && (await page.locator('#loginScope').inputValue()) === 'OPERATIONS',
  await page.locator('#loginScope').inputValue());

// The administration switch sits under the heading, above the form.
const order = await page.evaluate(() => {
  const kids = [...document.querySelector('.blitz-auth').children].map(el => el.className.split(' ')[0]);
  return kids.join(' > ');
});
check('the administration switch sits below the reset link, last in the card',
  order.indexOf('auth-links') < order.indexOf('blitz-scope-note')
  && order.trim().endsWith('blitz-scope-note'), order);
check('nothing explains the switch underneath it',
  (await page.locator('.blitz-scope-note small').count()) === 0);
check('the switch reads as a destination, not an afterthought',
  (await page.locator('#scopeAdminToggle').innerText()).trim() === 'Sign in to System Administration',
  (await page.locator('#scopeAdminToggle').innerText()).trim());

await page.screenshot({ path:SHOTS+'login-desktop.png' });

await page.locator('#scopeAdminToggle').click();
check('choosing administration actually changes the scope that is submitted',
  (await page.locator('#loginScope').inputValue()) === 'ADMIN'
  && (await page.locator('.blitz-auth.is-admin').count()) === 1);
await page.screenshot({ path:SHOTS+'login-admin.png' });

await page.locator('#scopeAdminToggle').click();
check('and it toggles back to Operations',
  (await page.locator('#loginScope').inputValue()) === 'OPERATIONS'
  && (await page.locator('.blitz-auth.is-admin').count()) === 0);

// A phone is where most people will actually sign in.
const phone = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
phone.on('pageerror', e=>errors.push(String(e)));
await phone.goto(base, { waitUntil:'networkidle' });
await audit(phone, 'phone');
const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the sign-in screen does not scroll sideways on a phone', sideways <= 1, `${sideways}px`);
await phone.screenshot({ path:SHOTS+'login-phone.png' });

// The name belongs to the backdrop now, not to the card.
check('BLITZ - ERP is a backdrop watermark, not a line on the card',
  (await page.locator('.blitz-wordmark').count()) === 0
  && (await page.evaluate(() => getComputedStyle(document.querySelector('#login'),'::after').content))
       .includes('BLITZ'),
  await page.evaluate(() => getComputedStyle(document.querySelector('#login'),'::after').content));
check('the watermark sits behind the card and cannot be clicked',
  await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#login'),'::after');
    return s.pointerEvents === 'none' && Number(s.zIndex) < 2;
  }));
check('the logo is the mark on the card, and it is large',
  (await page.locator('.blitz-mark').boundingBox()).height >= 70,
  `${Math.round((await page.locator('.blitz-mark').boundingBox()).height)}px tall`);

check('no script errors', errors.length === 0, errors.slice(0,2).join(' | ') || 'clean');

await browser.close();
server.close();
const failed = results.filter(r=>!r.pass).length;
console.log(`\n${results.length-failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
