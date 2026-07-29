import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok } from '../lib/http.js';

export const sessionRoutes = new Hono();

sessionRoutes.get('/', async (c) => {
  const user = c.get('erpUser');
  const settingsRows = await all(c.env.DB, `SELECT key,value FROM erp_settings`);
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  let permissions = [];
  if (user.role_code === 'ADMIN') {
    const modules = ['DASHBOARD','SHIPMENTS','RECEIVING','INVENTORY','RETURNS','REQUISITIONS','DELIVERIES','SALES','STATIONS','PLANNING','ADMIN'];
    permissions = modules.map(module => ({ module, can_view:1,can_create:1,can_edit:1,can_approve:1,can_post:1,can_export:1,can_manage:1 }));
  } else {
    permissions = await all(c.env.DB, `SELECT * FROM erp_role_permissions WHERE role_code=?`, [user.role_code]);
  }
  return ok(c, {
    user: { id:user.id,email:user.email,displayName:user.display_name,role:user.role_code,department:user.department,liveAccess:!!user.live_access },
    permissions,
    settings,
    environment: c.env.ENVIRONMENT || 'LIVE',
  });
});
