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
  await applySql('migrations/0015_user_access_station_connections.sql');
  await applySql('migrations/0016_clean_module_workspace.sql');
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
  assert.equal(sessionBody.workspaceCatalog.groups.length, 11);
  assert.ok(sessionBody.workspaceAccess.includes('fa-general-accounting'));
  assert.ok(sessionBody.workspaceAccess.includes('sd-lease-contract-management'));

  const createWorkspaceRecord = await mf.dispatchFetch('https://e88.test/api/workspace/modules/fa-general-accounting/records', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordType: 'Journal Entry',
      transactionDate: '2026-07-30',
      entityName: 'E88 Ventures Inc.',
      department: 'Finance and Accounting',
      description: 'Clean workspace integration test',
      amount: 1250,
      status: 'DRAFT',
    }),
  });
  const workspaceRecordBody = await createWorkspaceRecord.json();
  assert.equal(createWorkspaceRecord.status, 201, JSON.stringify(workspaceRecordBody));
  assert.match(workspaceRecordBody.record.record_no, /^FA-/);

  const listWorkspaceRecords = await mf.dispatchFetch('https://e88.test/api/workspace/modules/fa-general-accounting/records', { headers: { Cookie: cookie } });
  const listWorkspaceBody = await listWorkspaceRecords.json();
  assert.equal(listWorkspaceRecords.status, 200, JSON.stringify(listWorkspaceBody));
  assert.equal(listWorkspaceBody.rows.length, 1);

  const createLeaseContract = await mf.dispatchFetch('https://e88.test/api/workspace/modules/sd-lease-contract-management/records', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordType: 'Lease Contract',
      transactionDate: '2026-07-30',
      entityName: 'B2B Customer',
      department: 'Sales',
      businessChannel: 'B2B',
      contractEndDate: '2029-07-29',
      billingFrequency: 'MONTHLY',
      unitCount: 25,
      description: 'Connected lease contract test',
      amount: 250000,
      status: 'DRAFT',
    }),
  });
  const leaseContractBody = await createLeaseContract.json();
  assert.equal(createLeaseContract.status, 201, JSON.stringify(leaseContractBody));
  const leaseContracts = await mf.dispatchFetch('https://e88.test/api/workspace/modules/sd-lease-contract-management/records?channel=B2B', { headers: { Cookie: cookie } });
  const leaseContractsBody = await leaseContracts.json();
  assert.equal(leaseContracts.status, 200, JSON.stringify(leaseContractsBody));
  assert.equal(leaseContractsBody.rows.length, 1);
  assert.equal(leaseContractsBody.rows[0].business_channel, 'B2B');

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
      modules: ['INVENTORY'],
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
  assert.equal(staffSessionBody.permissions.find(row => row.module === 'INVENTORY').can_view, 1);
  assert.equal(staffSessionBody.permissions.find(row => row.module === 'DASHBOARD').can_view, 0);
  assert.ok(staffSessionBody.workspaceAccess.includes('ip-warehouse-management'));
  assert.ok(!staffSessionBody.workspaceAccess.includes('sd-crm'));

  const staffWorkspace = await mf.dispatchFetch('https://e88.test/api/workspace/modules/ip-warehouse-management/summary', { headers: { Cookie: staffCookie } });
  assert.equal(staffWorkspace.status, 200, await staffWorkspace.text());
  const deniedWorkspace = await mf.dispatchFetch('https://e88.test/api/workspace/modules/sd-crm/summary', { headers: { Cookie: staffCookie } });
  assert.equal(deniedWorkspace.status, 403);

  const staffInventory = await mf.dispatchFetch('https://e88.test/api/masters/items', { headers: { Cookie: staffCookie } });
  assert.equal(staffInventory.status, 200, await staffInventory.text());
  const staffDashboard = await mf.dispatchFetch('https://e88.test/api/dashboard', { headers: { Cookie: staffCookie } });
  assert.equal(staffDashboard.status, 403);
  const staffStations = await mf.dispatchFetch('https://e88.test/api/stations', { headers: { Cookie: staffCookie } });
  assert.equal(staffStations.status, 403);

  const stationInsert = await db.prepare(
    `INSERT INTO erp_station_projects(project_no,site_name,planned_location,progress_pct,status)
     VALUES('BSSP-TEST-0001','Alpha Station','Santa Rosa',100,'ACTIVE')`,
  ).run();
  const stationId = stationInsert.meta.last_row_id;
  const connectedAssetInsert = await db.prepare(
    `INSERT INTO erp_assets(asset_no,serial_no,serial_type,item_code,item_name,category,current_status,current_holder_type,current_holder_id,current_holder_name,reconciliation_status)
     VALUES('AST-TEST-0001','BAT-TEST-CONNECTED','BAT','BAT-TEST','Battery','BAT','ASSIGNED_TO_STATION','STATION_PROJECT',?,'Alpha Station','CLEAR')`,
  ).bind(stationId).run();
  const disconnectedAssetInsert = await db.prepare(
    `INSERT INTO erp_assets(asset_no,serial_no,serial_type,item_code,item_name,category,current_status,current_holder_type,current_holder_name,reconciliation_status)
     VALUES('AST-TEST-0002','BAT-TEST-SOLD','BAT','BAT-TEST','Battery','BAT','SOLD','CUSTOMER','Customer','CLEAR')`,
  ).run();
  await db.prepare(
    `INSERT INTO erp_station_project_assets(project_id,asset_id,serial_no,asset_role,status)
     VALUES(?,?,?,'BATTERY','CONNECTED'),(?,?,?,'BATTERY','DISCONNECTED')`,
  ).bind(
    stationId, connectedAssetInsert.meta.last_row_id, 'BAT-TEST-CONNECTED',
    stationId, disconnectedAssetInsert.meta.last_row_id, 'BAT-TEST-SOLD',
  ).run();

  const stationSearch = await mf.dispatchFetch('https://e88.test/api/stations?q=Alpha', { headers: { Cookie: cookie } });
  const stationSearchBody = await stationSearch.json();
  assert.equal(stationSearch.status, 200, JSON.stringify(stationSearchBody));
  assert.equal(stationSearchBody.rows.length, 1);
  assert.equal(stationSearchBody.rows[0].connected_asset_count, 1);
  assert.equal(stationSearchBody.rows[0].disconnected_asset_count, 1);

  const stationDetail = await mf.dispatchFetch(`https://e88.test/api/stations/${stationId}`, { headers: { Cookie: cookie } });
  const stationDetailBody = await stationDetail.json();
  assert.equal(stationDetail.status, 200, JSON.stringify(stationDetailBody));
  assert.equal(stationDetailBody.summary.connected, 1);
  assert.equal(stationDetailBody.summary.disconnected, 1);
  assert.equal(stationDetailBody.connectedAssets[0].serial_no, 'BAT-TEST-CONNECTED');
  assert.equal(stationDetailBody.disconnectedAssets[0].serial_no, 'BAT-TEST-SOLD');

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
