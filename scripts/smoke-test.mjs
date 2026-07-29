#!/usr/bin/env node
const base = (process.env.E88_URL || process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: E88_URL=https://your-worker.workers.dev node scripts/smoke-test.mjs');
  process.exit(2);
}
const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}
if (process.env.E88_BASIC_AUTH) headers.Authorization = `Basic ${Buffer.from(process.env.E88_BASIC_AUTH).toString('base64')}`;

const checks = [
  ['Shell', '/', r => r.ok && /E88 FinSys/i.test(r.text)],
  ['Health API', '/api/health', r => r.ok && /7\.1\.0/.test(r.text)],
  ['Session API', '/api/session', r => r.ok && /email|user|permissions/i.test(r.text)],
  ['Dashboard API', '/api/dashboard', r => r.ok && /inventory|kpi|shipment/i.test(r.text)],
];
let failures = 0;
for (const [name, path, validate] of checks) {
  try {
    const response = await fetch(`${base}${path}`, { headers, redirect: 'follow' });
    const text = await response.text();
    const result = { ok: response.ok, status: response.status, text };
    const passed = validate(result);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: HTTP ${response.status}`);
    if (!passed) failures++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failures++;
  }
}
if (failures) process.exit(1);
console.log('Live smoke test passed.');
