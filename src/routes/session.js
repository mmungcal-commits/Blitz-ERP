import { Hono } from 'hono';
import { all } from '../lib/db.js';
import { ok } from '../lib/http.js';
import { effectivePermissions } from '../lib/auth.js';
import { effectiveWorkspaceAccess, WORKSPACE_ADDONS, WORKSPACE_GROUPS, WORKSPACE_TOOLS } from '../lib/workspace.js';

export const sessionRoutes = new Hono();

sessionRoutes.get('/', async (c) => {
  const user = c.get('erpUser');
  const settingsRows = await all(c.env.DB, `SELECT key,value FROM erp_settings`);
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const permissions = await effectivePermissions(c.env.DB, user);
  const workspaceAccess = await effectiveWorkspaceAccess(c.env.DB, user, permissions);
  return ok(c, {
    user: { id:user.id,email:user.email,displayName:user.display_name,role:user.role_code,department:user.department,liveAccess:!!user.live_access },
    permissions,
    workspaceAccess,
    workspaceCatalog:{ groups:WORKSPACE_GROUPS, tools:WORKSPACE_TOOLS, addons:WORKSPACE_ADDONS },
    settings,
    environment: c.env.ENVIRONMENT || 'LIVE',
  });
});
