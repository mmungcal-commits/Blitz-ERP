import { all, first, run } from './db.js';
import { readCookie, sha256 } from './crypto.js';

const DOMAIN = 'nrdev.ph';
export const ERP_MODULES = [
  'DASHBOARD','PROCUREMENT','SHIPMENTS','RECEIVING','INVENTORY','RETURNS',
  'REQUISITIONS','DELIVERIES','SALES','CUSTOMERS','STATIONS','PLANNING','ADMIN',
  'FINANCE',
];
const FULL_PERMISSION = {
  can_view: 1, can_create: 1, can_edit: 1, can_approve: 1,
  can_post: 1, can_export: 1, can_manage: 1,
};
const NO_PERMISSION = {
  can_view: 0, can_create: 0, can_edit: 0, can_approve: 0,
  can_post: 0, can_export: 0, can_manage: 0,
};

function emailFromBasic(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ') || !env.APP_PASS) return '';
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    const password = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (password !== env.APP_PASS) return '';
    return (env.APP_ADMIN_EMAIL || 'mmungcal@nrdev.ph').toLowerCase();
  } catch {
    return '';
  }
}

export function requestEmail(c) {
  const accessEmail = c.req.header('Cf-Access-Authenticated-User-Email');
  const devEmail = c.req.header('X-Dev-User');
  const allowDev = String(c.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true' || c.env.ENVIRONMENT !== 'production';
  return String(accessEmail || (allowDev ? devEmail : '') || emailFromBasic(c.req.raw, c.env) || '').trim().toLowerCase();
}

function isAuthorizedUser(user, env) {
  if (!user?.active) return false;
  const production = String(env.ENVIRONMENT || '').toLowerCase() === 'production';
  return !production || !!user.live_access;
}

async function userFromSession(c) {
  const token = readCookie(c.req.raw, 'e88_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const user = await first(c.env.DB,
    `SELECT u.*
       FROM erp_sessions s
       JOIN erp_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND julianday(s.expires_at)>julianday('now')`,
    [tokenHash]);
  if (!isAuthorizedUser(user, c.env)) return null;
  await run(c.env.DB, `UPDATE erp_sessions SET last_seen_at=datetime('now') WHERE token_hash=?`, [tokenHash]);
  return user;
}

export async function loadUser(c) {
  const sessionUser = await userFromSession(c);
  if (sessionUser) return sessionUser;

  const email = requestEmail(c);
  if (!email || !email.endsWith(`@${c.env.ALLOWED_DOMAIN || DOMAIN}`)) {
    return null;
  }
  const user = await first(c.env.DB, `SELECT * FROM erp_users WHERE email=?`, [email]);
  if (!isAuthorizedUser(user, c.env)) return null;
  await run(c.env.DB, `UPDATE erp_users SET last_login_at=datetime('now') WHERE id=?`, [user.id]);
  return user;
}

export async function permissionFor(db, user, module) {
  if (user.role_code === 'ADMIN') return { module, ...FULL_PERMISSION };

  const explicitMode = await first(db, `SELECT 1 configured FROM erp_user_module_access WHERE user_id=? LIMIT 1`, [user.id]);
  if (explicitMode) {
    const access = await first(db, `SELECT allowed FROM erp_user_module_access WHERE user_id=? AND module=?`, [user.id, module]);
    if (!access?.allowed) return { module, ...NO_PERMISSION };
  }

  const rolePermission = await first(db, `SELECT * FROM erp_role_permissions WHERE role_code=? AND module=?`, [user.role_code, module]) || {};
  if (explicitMode) return { module, ...NO_PERMISSION, ...rolePermission, can_view: 1 };
  return { module, ...NO_PERMISSION, ...rolePermission };
}

export async function effectivePermissions(db, user) {
  if (user.role_code === 'ADMIN') return ERP_MODULES.map(module => ({ module, ...FULL_PERMISSION }));

  const [roleRows, accessRows] = await Promise.all([
    all(db, `SELECT * FROM erp_role_permissions WHERE role_code=?`, [user.role_code]),
    all(db, `SELECT module,allowed FROM erp_user_module_access WHERE user_id=?`, [user.id]),
  ]);
  const roleMap = new Map(roleRows.map(row => [row.module, row]));
  const accessMap = new Map(accessRows.map(row => [row.module, !!row.allowed]));
  const explicitMode = accessRows.length > 0;

  return ERP_MODULES.map(module => {
    if (explicitMode && !accessMap.get(module)) return { module, ...NO_PERMISSION };
    const rolePermission = roleMap.get(module) || {};
    return {
      module,
      ...NO_PERMISSION,
      ...rolePermission,
      ...(explicitMode ? { can_view: 1 } : {}),
    };
  });
}

export async function requireUser(c, next) {
  const user = await loadUser(c);
  if (!user) return c.json({ ok: false, error: 'Authentication required.' }, 401);
  c.set('erpUser', user);
  return next();
}

const ACTION_COLUMN = {
  VIEW: 'can_view', CREATE: 'can_create', EDIT: 'can_edit', APPROVE: 'can_approve',
  POST: 'can_post', EXPORT: 'can_export', MANAGE: 'can_manage'
};

export function requirePermission(module, action = 'VIEW') {
  return async (c, next) => {
    const user = c.get('erpUser') || await loadUser(c);
    if (!user) return c.json({ ok: false, error: 'Authentication required.' }, 401);
    c.set('erpUser', user);
    if (user.role_code === 'ADMIN') return next();
    const permission = await permissionFor(c.env.DB, user, module);
    const column = ACTION_COLUMN[action] || 'can_view';
    if (!permission[column]) return c.json({ ok: false, error: `You do not have ${action.toLowerCase()} access to ${module}.` }, 403);
    return next();
  };
}

export function requireAnyPermission(modules, action = 'VIEW') {
  return async (c, next) => {
    const user = c.get('erpUser') || await loadUser(c);
    if (!user) return c.json({ ok: false, error: 'Authentication required.' }, 401);
    c.set('erpUser', user);
    if (user.role_code === 'ADMIN') return next();
    const column = ACTION_COLUMN[action] || 'can_view';
    for (const module of modules) {
      const permission = await permissionFor(c.env.DB, user, module);
      if (permission[column]) return next();
    }
    return c.json({ ok: false, error: 'You do not have access to the requested master data.' }, 403);
  };
}
