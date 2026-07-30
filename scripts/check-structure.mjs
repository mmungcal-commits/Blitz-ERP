#!/usr/bin/env node
import { readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const passes = [];

async function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function check(condition, label, detail = '') {
  if (condition) passes.push({ label, detail });
  else failures.push({ label, detail });
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function main() {
  const required = [
    'src/index.js','public/index.html','public/foundation.js','public/foundation.css','public/logo.png',
    'wrangler.toml','package.json','migrations/0008_connected_erp.sql',
    'migrations/0010_procurement_sales_controls.sql','migrations/0011_finance_planning_registers.sql',
    'migrations/0012_ramco_enterprise.sql','migrations/0013_atlas_receiving_workbench.sql',
    'migrations/0014_application_auth.sql','src/routes/auth.js','src/lib/crypto.js',
    'migrations/0015_user_access_station_connections.sql',
    'migrations/0016_clean_module_workspace.sql','src/lib/workspace.js','src/routes/workspace.js',
    'migrations/opening/manifest.json','scripts/generate_opening_data.py','scripts/self_test.py'
  ];
  for (const rel of required) check(await exists(join(ROOT, rel)), `Required file: ${rel}`);

  const jsFiles = [
    ...await walk(join(ROOT, 'src'), p => p.endsWith('.js')),
    ...await walk(join(ROOT, 'public'), p => p.endsWith('.js')),
    ...await walk(join(ROOT, 'scripts'), p => p.endsWith('.mjs')),
    ...await walk(join(ROOT, 'test'), p => p.endsWith('.mjs')),
  ];
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    check(result.status === 0, `JavaScript syntax: ${relative(ROOT, file)}`, result.stderr.trim());
  }

  const importRegex = /(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const file of jsFiles.filter(x => x.includes(`${join('', 'src')}`))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(importRegex)) {
      let target = join(dirname(file), match[1]);
      if (!target.endsWith('.js') && !target.endsWith('.mjs')) target += '.js';
      check(await exists(target), `Import resolves: ${relative(ROOT, file)} -> ${match[1]}`);
    }
  }

  const indexSource = await readFile(join(ROOT, 'src/index.js'), 'utf8');
  const routeFiles = await walk(join(ROOT, 'src/routes'), p => p.endsWith('.js'));
  for (const file of routeFiles) {
    const base = file.split('/').pop().replace('.js', '');
    check(indexSource.includes(`./routes/${base}.js`), `Route imported: ${base}`);
  }

  const allSource = (await Promise.all(jsFiles.map(f => readFile(f, 'utf8')))).join('\n');
  for (const token of [
    'BATTERY_SWAP','UNRECONCILED','ensureItem','categoryCode','BarcodeDetector',
    'erp_stock_ledger','erp_serial_exceptions','erp_reconciliation_cases',
    'requirePermission','ALLOWED_DOMAIN','erp_user_credentials','e88_session',
    'erp_expected_receipt_matches','SERIAL_SUBSTITUTED','EXPECTED_SHIPMENT_ONLY'
  ]) check(allSource.includes(token), `Business control present: ${token}`);

  const codes = await readFile(join(ROOT, 'src/lib/codes.js'), 'utf8');
  for (const prefix of ['MC','BAT','BSS','SP','CHG','OTH']) {
    check(codes.includes(`'${prefix}'`), `Item-code category present: ${prefix}`);
  }

  const manifest = JSON.parse(await readFile(join(ROOT, 'migrations/opening/manifest.json'), 'utf8'));
  check(Array.isArray(manifest.files) && manifest.files.length > 0, 'Opening manifest contains SQL chunks', String(manifest.files?.length || 0));
  for (const file of manifest.files || []) check(await exists(join(ROOT, 'migrations/opening', file)), `Opening chunk exists: ${file}`);

  const sourceFiles = await walk(join(ROOT, 'source_data'), p => p.toLowerCase().endsWith('.xlsx'));
  check(sourceFiles.length === 14, 'All shared Excel workbooks bundled', String(sourceFiles.length));

  console.log(`E88 FinSys structure check: ${passes.length} passed, ${failures.length} failed.`);
  for (const p of passes) console.log(`PASS  ${p.label}${p.detail ? ` — ${p.detail}` : ''}`);
  for (const f of failures) console.error(`FAIL  ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  if (failures.length) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
