import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
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
  /*
   * The name on the document and the name you call somebody are not the same.
   * display_name stays the full legal name because approvals are printed with
   * it; the screen greets them by the name they actually use.
   */
  const preferred = await first(c.env.DB,
    `SELECT preferred_name FROM erp_user_preferred_names WHERE email=?`, [user.email])
    .catch(() => null);
  return ok(c, {
    user: { id:user.id,email:user.email,displayName:user.display_name,
      preferredName:preferred?.preferred_name||'',
      role:user.role_code,department:user.department,liveAccess:!!user.live_access,scope:user.session_scope||'OPERATIONS',canUseAdminScope:!!user.admin_access },
    permissions,
    workspaceAccess,
    workspaceCatalog:{ groups:WORKSPACE_GROUPS, tools:WORKSPACE_TOOLS, addons:WORKSPACE_ADDONS },
    settings,
    environment: c.env.ENVIRONMENT || 'LIVE',
  });
});
