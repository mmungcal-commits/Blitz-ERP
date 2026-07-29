#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const toml = await readFile(join(ROOT, 'wrangler.toml'), 'utf8');
const match = toml.match(/database_id\s*=\s*"([^"]+)"/);
const databaseId = match?.[1] || '';
const knownPreviousLive = 'ed5e7a18-4f30-4ec2-9b2f-4b94d05f3a6e';
const confirmed = process.env.E88_DEPLOY_CONFIRM === 'CONNECTED_SCHEMA_INSTALLED';

if (!databaseId || /REPLACE|YOUR_|PLACEHOLDER/i.test(databaseId)) {
  console.error('Deployment stopped: put the intended D1 database_id in wrangler.toml.');
  process.exit(2);
}
if (databaseId === knownPreviousLive && !confirmed) {
  console.error('Deployment stopped: wrangler.toml still points to the previous live D1 database.');
  console.error('Create/bootstrap the v7 database first, or explicitly set E88_DEPLOY_CONFIRM=CONNECTED_SCHEMA_INSTALLED only after the connected migrations are verified.');
  process.exit(2);
}
console.log(`Pre-deploy guard passed for D1 ${databaseId}.`);
