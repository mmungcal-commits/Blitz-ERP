#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const local = args.has('--local') || !remote;
const confirmed = process.argv.includes('--confirm=E88_NEW_DATABASE') || process.env.E88_BOOTSTRAP_CONFIRM === 'E88_NEW_DATABASE';
const wranglerToml = await readFile(join(ROOT, 'wrangler.toml'), 'utf8');
const databaseId = wranglerToml.match(/database_id\s*=\s*"([^"]+)"/)?.[1] || '';
const previousLiveDatabaseId = 'ed5e7a18-4f30-4ec2-9b2f-4b94d05f3a6e';

if (remote && databaseId === previousLiveDatabaseId) {
  console.error('Remote bootstrap stopped: wrangler.toml still points to the previous live D1 database.');
  console.error('Create a NEW D1 database, replace database_id, and retry. The opening-data bootstrap will not overwrite the prior live database.');
  process.exit(2);
}
if (remote && !confirmed) {
  console.error('Remote bootstrap stopped. Use a NEW/EMPTY D1 database and pass --confirm=E88_NEW_DATABASE.');
  console.error('Never run this opening-data bootstrap against the current live database without a backup and approved cutover.');
  process.exit(2);
}

const preLoadFiles = [
  'schema.sql','schema2.sql','schema4.sql','schema7.sql','alter_users.sql','data.sql',
  'migrations/0008_connected_erp.sql',
  'migrations/0010_procurement_sales_controls.sql',
  'migrations/0011_finance_planning_registers.sql'
];
const postLoadFiles = [
  'migrations/0012_ramco_enterprise.sql',
  'migrations/0013_atlas_receiving_workbench.sql'
];
const manifest = JSON.parse(await readFile(join(ROOT, 'migrations/opening/manifest.json'), 'utf8'));
const files = [...preLoadFiles, ...(manifest.files || []).map(f => `migrations/opening/${f}`), ...postLoadFiles];

for (const rel of files) {
  const full = join(ROOT, rel);
  try { await access(full, constants.R_OK); } catch { throw new Error(`Missing SQL file: ${rel}`); }
  const commandArgs = ['wrangler', 'd1', 'execute', 'DB', local ? '--local' : '--remote', `--file=${full}`];
  console.log(`\n[${files.indexOf(rel)+1}/${files.length}] Applying ${rel}`);
  const result = spawnSync('npx', commandArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`Database bootstrap failed at ${rel}. Resolve the error before retrying.`);
    process.exit(result.status || 1);
  }
}
console.log(`\nE88 FinSys database bootstrap completed (${local ? 'local' : 'remote'}).`);
