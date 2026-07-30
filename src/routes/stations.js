import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensurePartner, nextCode, normalizeText, normalizeSerial } from '../lib/codes.js';
import { getAsset, isAvailable, postMovement } from '../lib/inventory.js';

export const stationRoutes = new Hono();

const connectedCondition = `
  a.current_holder_type='STATION_PROJECT'
  AND a.current_holder_id=p.id
  AND a.current_status IN ('ASSIGNED_TO_STATION','UNDER_REPAIR')`;

stationRoutes.get('/', requirePermission('STATIONS','VIEW'), async c => {
  const { page, size, offset } = pageParams(c);
  const query = normalizeText(c.req.query('q'));
  const filter = query
    ? `WHERE p.project_no LIKE ? OR p.site_name LIKE ? OR COALESCE(x.name,'') LIKE ? OR COALESCE(p.planned_location,'') LIKE ?`
    : '';
  const searchArgs = query ? new Array(4).fill(`%${query}%`) : [];
  const rows = await all(c.env.DB,
    `SELECT p.*,x.name partner_name,
       COALESCE(SUM(CASE WHEN ${connectedCondition} THEN 1 ELSE 0 END),0) connected_asset_count,
       COALESCE(SUM(CASE WHEN pa.id IS NOT NULL AND NOT (${connectedCondition}) THEN 1 ELSE 0 END),0) disconnected_asset_count
     FROM erp_station_projects p
     LEFT JOIN erp_partners x ON x.id=p.partner_id
     LEFT JOIN erp_station_project_assets pa ON pa.project_id=p.id
     LEFT JOIN erp_assets a ON a.id=pa.asset_id
     ${filter}
     GROUP BY p.id
     ORDER BY COALESCE(p.target_activation_date,p.planned_date,p.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...searchArgs, size, offset]);
  const total = await first(c.env.DB,
    `SELECT COUNT(*) n FROM erp_station_projects p LEFT JOIN erp_partners x ON x.id=p.partner_id ${filter}`,
    searchArgs);
  return ok(c, { rows, page, size, total: total?.n || 0, query });
});

stationRoutes.post('/', requirePermission('STATIONS','CREATE'), async c => {
  const b = await jsonBody(c);
  if (!b.siteName) return fail(c, 'Site name is required');
  let partner = null;
  if (b.partnerName) partner = await ensurePartner(c.env.DB, {
    name: b.partnerName,
    type: 'SITE_PARTNER',
    address: b.plannedLocation || '',
    sourceSystem: b.sourceSystem || 'E88_FINSYS',
  });
  const no = normalizeText(b.projectNo) || await nextCode(c.env.DB, 'STATION_PROJECT', 'BSSP', 6);
  const r = await run(c.env.DB,
    `INSERT INTO erp_station_projects(project_no,site_name,partner_id,planned_location,planned_date,target_activation_date,actual_activation_date,progress_pct,status,budget_amount,actual_cost)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [no, b.siteName, partner?.id || null, b.plannedLocation || '', b.plannedDate || '',
      b.targetActivationDate || '', b.actualActivationDate || '', numberValue(b.progressPct),
      b.status || 'PLANNED', numberValue(b.budgetAmount), numberValue(b.actualCost)]);
  await audit(c, { action: 'CREATE', module: 'STATIONS', recordType: 'STATION_PROJECT', recordId: r.meta.last_row_id, recordNo: no, after: b });
  return ok(c, { id: r.meta.last_row_id, projectNo: no }, 201);
});

stationRoutes.get('/:id', requirePermission('STATIONS','VIEW'), async c => {
  const id = Number(c.req.param('id'));
  const header = await first(c.env.DB,
    `SELECT p.*,x.name partner_name FROM erp_station_projects p LEFT JOIN erp_partners x ON x.id=p.partner_id WHERE p.id=?`,
    [id]);
  if (!header) return fail(c, 'Station project not found', 404);
  const assets = await all(c.env.DB,
    `SELECT pa.*,a.category,a.item_name,a.current_status,a.current_location_code,a.current_holder_type,
       a.current_holder_id,a.current_holder_name,a.reconciliation_status,
       CASE
         WHEN a.current_holder_type='STATION_PROJECT' AND a.current_holder_id=? AND a.current_status='ASSIGNED_TO_STATION' THEN 'CONNECTED'
         WHEN a.current_holder_type='STATION_PROJECT' AND a.current_holder_id=? AND a.current_status='UNDER_REPAIR' THEN 'MAINTENANCE'
         ELSE 'DISCONNECTED'
       END connection_status
     FROM erp_station_project_assets pa
     LEFT JOIN erp_assets a ON a.id=pa.asset_id
     WHERE pa.project_id=?
     ORDER BY connection_status,pa.asset_role,pa.serial_no`,
    [id, id, id]);
  const connectedAssets = assets.filter(asset => asset.connection_status !== 'DISCONNECTED');
  const disconnectedAssets = assets.filter(asset => asset.connection_status === 'DISCONNECTED');
  return ok(c, {
    header,
    assets,
    connectedAssets,
    disconnectedAssets,
    summary: {
      connected: connectedAssets.filter(asset => asset.connection_status === 'CONNECTED').length,
      maintenance: connectedAssets.filter(asset => asset.connection_status === 'MAINTENANCE').length,
      disconnected: disconnectedAssets.length,
    },
  });
});

stationRoutes.post('/:id/update', requirePermission('STATIONS','EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const before = await first(c.env.DB, `SELECT * FROM erp_station_projects WHERE id=?`, [id]);
  if (!before) return fail(c, 'Station project not found', 404);
  await run(c.env.DB,
    `UPDATE erp_station_projects
     SET planned_location=COALESCE(?,planned_location),planned_date=COALESCE(?,planned_date),
       target_activation_date=COALESCE(?,target_activation_date),actual_activation_date=COALESCE(?,actual_activation_date),
       progress_pct=COALESCE(?,progress_pct),status=COALESCE(?,status),
       budget_amount=COALESCE(?,budget_amount),actual_cost=COALESCE(?,actual_cost)
     WHERE id=?`,
    [b.plannedLocation ?? null, b.plannedDate ?? null, b.targetActivationDate ?? null,
      b.actualActivationDate ?? null, b.progressPct ?? null, b.status ?? null,
      b.budgetAmount ?? null, b.actualCost ?? null, id]);
  const after = await first(c.env.DB, `SELECT * FROM erp_station_projects WHERE id=?`, [id]);
  await audit(c, { action: 'UPDATE', module: 'STATIONS', recordType: 'STATION_PROJECT', recordId: id, recordNo: after.project_no, before, after });
  return ok(c, { project: after });
});

stationRoutes.post('/:id/assets', requirePermission('STATIONS','POST'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const project = await first(c.env.DB, `SELECT * FROM erp_station_projects WHERE id=?`, [id]);
  if (!project) return fail(c, 'Station project not found', 404);
  const asset = await getAsset(c.env.DB, normalizeSerial(b.serialNo));
  if (!asset) return fail(c, 'Serial is not registered', 404);
  if (!isAvailable(asset)) return fail(c, `Serial ${asset.serial_no} is not available`, 409);

  const assignedDate = b.assignedDate || new Date().toISOString();
  const assetRole = b.assetRole || asset.category;
  try {
    await postMovement(c.env.DB, {
      serialNo: asset.serial_no,
      movementType: 'STATION_DEPLOYMENT',
      movementDate: assignedDate,
      toLocationCode: project.planned_location,
      toStatus: 'ASSIGNED_TO_STATION',
      holderType: 'STATION_PROJECT',
      holderId: id,
      holderName: project.site_name,
      sourceDocType: 'STATION_PROJECT',
      sourceDocId: id,
      sourceDocNo: project.project_no,
      reasonCode: assetRole,
    }, c.get('erpUser').email);
  } catch (e) {
    return fail(c, e.message, 409);
  }

  const existing = await first(c.env.DB,
    `SELECT id FROM erp_station_project_assets WHERE project_id=? AND asset_id=? LIMIT 1`,
    [id, asset.id]);
  if (existing) {
    await run(c.env.DB,
      `UPDATE erp_station_project_assets SET serial_no=?,asset_role=?,assigned_date=?,status='CONNECTED' WHERE id=?`,
      [asset.serial_no, assetRole, assignedDate, existing.id]);
  } else {
    await run(c.env.DB,
      `INSERT INTO erp_station_project_assets(project_id,asset_id,serial_no,asset_role,assigned_date,status) VALUES(?,?,?,?,?,'CONNECTED')`,
      [id, asset.id, asset.serial_no, assetRole, assignedDate]);
  }
  await audit(c, {
    action: 'ASSIGN_ASSET',
    module: 'STATIONS',
    recordType: 'STATION_PROJECT',
    recordId: id,
    recordNo: project.project_no,
    after: { serialNo: asset.serial_no, assetRole, connectionStatus: 'CONNECTED' },
  });
  return ok(c, { assigned: true, connectionStatus: 'CONNECTED' });
});

stationRoutes.post('/:id/activate', requirePermission('STATIONS','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const project = await first(c.env.DB, `SELECT * FROM erp_station_projects WHERE id=?`, [id]);
  if (!project) return fail(c, 'Station project not found', 404);
  const counts = await all(c.env.DB,
    `SELECT a.category,COUNT(*) qty
     FROM erp_station_project_assets pa
     JOIN erp_assets a ON a.id=pa.asset_id
     WHERE pa.project_id=?
       AND a.current_holder_type='STATION_PROJECT'
       AND a.current_holder_id=?
       AND a.current_status='ASSIGNED_TO_STATION'
     GROUP BY a.category`,
    [id, id]);
  const map = Object.fromEntries(counts.map(value => [value.category, value.qty]));
  if (!(map.BSS > 0)) return fail(c, 'A connected swapping-station/locker serial must be assigned before activation', 409);
  if (!(map.BAT > 0)) return fail(c, 'At least one connected battery must be assigned before activation', 409);
  await run(c.env.DB,
    `UPDATE erp_station_projects SET status='ACTIVE',progress_pct=100,actual_activation_date=COALESCE(actual_activation_date,?) WHERE id=?`,
    [new Date().toISOString().slice(0, 10), id]);
  await audit(c, { action: 'ACTIVATE', module: 'STATIONS', recordType: 'STATION_PROJECT', recordId: id, recordNo: project.project_no, after: { status: 'ACTIVE', counts: map } });
  return ok(c, { active: true, counts: map });
});
