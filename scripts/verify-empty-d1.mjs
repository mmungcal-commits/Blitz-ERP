#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function runJson(command) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--remote', `--command=${command}`, '--json'],
    { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`D1 verification query failed with exit code ${result.status ?? 'unknown'}.`);
  }

  const output = String(result.stdout || '').trim();
  try {
    return JSON.parse(output);
  } catch {
    const firstArray = output.indexOf('[');
    const firstObject = output.indexOf('{');
    const start = [firstArray, firstObject].filter(index => index >= 0).sort((a, b) => a - b)[0];
    if (start === undefined) {
      throw new Error(`Wrangler did not return JSON. Output: ${output.slice(0, 500)}`);
    }
    return JSON.parse(output.slice(start));
  }
}

function findNumericValue(value, key) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNumericValue(entry, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const number = Number(value[key]);
      if (Number.isFinite(number)) return number;
    }
    for (const entry of Object.values(value)) {
      const found = findNumericValue(entry, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const tableResult = runJson(
  "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name='erp_assets';"
);
const tableCount = findNumericValue(tableResult, 'table_count');
if (tableCount === undefined) {
  throw new Error('Unable to read table_count from Wrangler JSON output.');
}

if (tableCount === 0) {
  console.log('Bootstrap safety check passed: erp_assets does not exist in the configured D1 database.');
  process.exit(0);
}

const assetResult = runJson('SELECT COUNT(*) AS asset_count FROM erp_assets;');
const assetCount = findNumericValue(assetResult, 'asset_count');
if (assetCount === undefined) {
  throw new Error('Unable to read asset_count from Wrangler JSON output.');
}

if (assetCount > 0) {
  console.error(`Bootstrap stopped: the configured D1 already contains ${assetCount} serialized assets.`);
  console.error('Select upgrade_existing to preserve the current records.');
  process.exit(2);
}

console.log('Bootstrap safety check passed: erp_assets exists but contains no serialized assets.');
