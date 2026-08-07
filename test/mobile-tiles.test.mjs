import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The mobile tile launcher is plain browser code inside a 500KB module that
 * cannot be imported here, so this reads the source as text. It exists because
 * the first version of the launcher was keyed on 'ip-warehouse-management'
 * while Physical Count actually lives in 'ip-cycle-counting' - the tiles were
 * silently never rendered and nothing caught it.
 */
const src = readFileSync(new URL('../public/foundation.js', import.meta.url), 'utf8');

function tileModules() {
  const start = src.indexOf('const MOBILE_TILES={');
  assert.ok(start > -1, 'MOBILE_TILES must exist');
  const block = src.slice(start, src.indexOf('\n};', start));
  return {
    block,
    codes: [...block.matchAll(/'([a-z]{2}-[a-z-]+)':\{/g)].map(m => m[1]),
    sections: [...block.matchAll(/section:'([a-z]+)'/g)].map(m => m[1]),
  };
}

/*
 * Tabs are declared two ways: a dedicated `if(code===...)` branch for modules
 * with bespoke workbenches, and a one-line entry in the shared map for the
 * rest. A tile pointing at a section is just as broken either way, so the
 * guard has to read both forms.
 */
function tabsFor(code) {
  const marker = `if(code==='${code}')return [`;
  const start = src.indexOf(marker);
  if (start !== -1) {
    const block = src.slice(start, src.indexOf('];', start));
    return [...block.matchAll(/\['([a-z]+)','/g)].map(m => m[1]);
  }
  const mapStart = src.indexOf(`'${code}':[[`);
  if (mapStart === -1) return null;
  const line = src.slice(mapStart, src.indexOf('\n', mapStart));
  return [...line.matchAll(/\['([a-z]+)','/g)].map(m => m[1]);
}

test('the physical count module has mobile tiles', () => {
  const { codes } = tileModules();
  assert.ok(codes.includes('ip-cycle-counting'),
    'Physical Count lives in ip-cycle-counting, so that module must be tiled');
});

test('every tiled module code is a real module', () => {
  const { codes } = tileModules();
  for (const code of codes) {
    assert.ok(tabsFor(code), `${code} has no workspaceTabs entry - the tiles would never render`);
  }
});

test('every tile points at a section that module actually has', () => {
  const { block, codes } = tileModules();
  for (const code of codes) {
    const tabs = tabsFor(code);
    const slice = block.slice(block.indexOf(`'${code}':{`));
    const own = slice.slice(0, slice.indexOf('\n  }'));
    for (const [, section] of own.matchAll(/section:'([a-z]+)'/g)) {
      assert.ok(tabs.includes(section), `${code} tile targets '${section}', which is not one of ${tabs.join(', ')}`);
    }
  }
});

test('the phone launcher is reachable from the home screen and from a section', () => {
  // Home is the landing cockpit; the module map (and on a phone, the tile
  // launcher) sits behind "Open modules".
  assert.match(src, /if\(!state\.showModuleMap\)return renderHomeDashboard\(\);/,
    'signing in must land on the dashboard');
  assert.match(src, /if\(isPhone\(\)&&!state\.mobileFull\)return renderMobileLaunchpad\(\);/,
    'the launchpad must hand off to the phone launcher');
  assert.match(src, /if\(isPhone\(\)&&!state\.mobileFull&&renderMobileTiles\(module\)\)return;/,
    'opening a module on a phone must show its tiles');
  assert.match(src, /addMobileBackBar\(\)/, 'a section on a phone must offer a way back to the tiles');
});

test('the asset cache-buster matches the shipped build', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const build = src.match(/const FOUNDATION_BUILD='([^']+)'/)[1];
  const stamp = build.match(/(\d{8})-R(\d+)/);
  const expected = `v=${stamp[1]}-r${stamp[2]}`;
  assert.ok(html.includes(`foundation.js?${expected}`),
    `index.html must request foundation.js?${expected} so a phone cannot serve a stale copy`);
  assert.ok(html.includes(`foundation.css?${expected}`), 'the stylesheet needs the same cache-buster');
});
