import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const bundle = await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});

const mf = new Miniflare({
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: '2024-11-01',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'e88-auth-integration' },
  bindings: {
    ENVIRONMENT: 'production',
    ALLOWED_DOMAIN: 'nrdev.ph',
    APP_ADMIN_EMAIL: 'mmungcal@nrdev.ph',
    APP_PASS: 'E88-Test-Password-2026',
    APP_TIMEZONE: 'Asia/Manila',
  },
});

try {
  const db = await mf.getD1Database('DB');
  const applySql = async path => {
    const source = (await readFile(path, 'utf8')).replace(/^--.*$/gm, '');
    for (const statement of source.split(';').map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  };
  await applySql('migrations/0008_connected_erp.sql');
  await applySql('migrations/0014_application_auth.sql');
  await db.prepare(
    `INSERT INTO erp_users(email,display_name,role_code,department,live_access,active)
     VALUES(?,?,?,?,1,1)`,
  ).bind('mmungcal@nrdev.ph', 'Mark Alexis Mungcal', 'ADMIN', 'Finance and Accounting').run();

  const unauthenticated = await mf.dispatchFetch('https://e88.test/api/session');
  assert.equal(unauthenticated.status, 401);

  const login = await mf.dispatchFetch('https://e88.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mmungcal@nrdev.ph', password: 'E88-Test-Password-2026' }),
  });
  const loginText = await login.text();
  assert.equal(login.status, 200, loginText);
  const cookie = login.headers.get('Set-Cookie');
  assert.match(cookie, /e88_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const session = await mf.dispatchFetch('https://e88.test/api/session', { headers: { Cookie: cookie } });
  const sessionText = await session.text();
  assert.equal(session.status, 200, sessionText);
  const sessionBody = JSON.parse(sessionText);
  assert.equal(sessionBody.user.email, 'mmungcal@nrdev.ph');
  assert.equal(sessionBody.user.role, 'ADMIN');

  const users = await mf.dispatchFetch('https://e88.test/api/admin/users', { headers: { Cookie: cookie } });
  const usersText = await users.text();
  assert.equal(users.status, 200, usersText);
  assert.doesNotMatch(usersText, /password_hash|password_salt|activation_token_hash|reset_token_hash/);

  const createUser = await mf.dispatchFetch('https://e88.test/api/admin/users', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'staff@nrdev.ph',
      displayName: 'E88 Staff',
      roleCode: 'STAFF',
      department: 'Supply Chain',
      liveAccess: true,
      active: true,
    }),
  });
  const createUserBody = await createUser.json();
  assert.equal(createUser.status, 200, JSON.stringify(createUserBody));
  assert.match(createUserBody.activationLink, /\?activate=/);
  const activationUrl = new URL(createUserBody.activationLink);

  const activate = await mf.dispatchFetch('https://e88.test/api/auth/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: activationUrl.searchParams.get('email'),
      token: activationUrl.searchParams.get('activate'),
      password: 'Staff-Private-Password-2026',
      confirmPassword: 'Staff-Private-Password-2026',
    }),
  });
  const activateText = await activate.text();
  assert.equal(activate.status, 200, activateText);
  const staffCookie = activate.headers.get('Set-Cookie');
  assert.match(staffCookie, /e88_session=/);

  const staffSession = await mf.dispatchFetch('https://e88.test/api/session', { headers: { Cookie: staffCookie } });
  const staffSessionBody = await staffSession.json();
  assert.equal(staffSession.status, 200, JSON.stringify(staffSessionBody));
  assert.equal(staffSessionBody.user.email, 'staff@nrdev.ph');

  const logout = await mf.dispatchFetch('https://e88.test/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(logout.status, 200);

  const afterLogout = await mf.dispatchFetch('https://e88.test/api/session', { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);

  console.log('E88 FinSys authentication integration: PASS');
} finally {
  await mf.dispose();
}
