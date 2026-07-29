import { first, run } from './db.js';

const DOMAIN = 'nrdev.ph';

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

export async function loadUser(c) {
  const email = requestEmail(c);
  if (!email || !email.endsWith(`@${c.env.ALLOWED_DOMAIN || DOMAIN}`)) {
    return null;
  }
  let user = await first(c.env.DB, `SELECT * FROM erp_users WHERE email=?`, [email]);
  if (!user) {
    const adminEmail = String(c.env.APP_ADMIN_EMAIL || 'mmungcal@nrdev.ph').toLowerCase();
    const role = email === adminEmail ? 'ADMIN' : 'STAFF';
    const live = role === 'ADMIN' ? 1 : 0;
    const r = await run(c.env.DB,
      `INSERT INTO erp_users(email,display_name,role_code,live_access) VALUES(?,?,?,?)`,
      [email, email.split('@')[0], role, live]);
    user = { id: r.meta.last_row_id, email, display_name: email.split('@')[0], role_code: role, live_access: live, active: 1 };
  }
  if (!user.active) return null;
  await run(c.env.DB, `UPDATE erp_users SET last_login_at=datetime('now') WHERE id=?`, [user.id]);
  return user;
}

export async function permissionFor(db, roleCode, module) {
  if (roleCode === 'ADMIN') {
    return { can_view: 1, can_create: 1, can_edit: 1, can_approve: 1, can_post: 1, can_export: 1, can_manage: 1 };
  }
  return await first(db, `SELECT * FROM erp_role_permissions WHERE role_code=? AND module=?`, [roleCode, module]) || {};
}

export async function requireUser(c, next) {
  const user = await loadUser(c);
  if (!user) return c.json({ ok: false, error: 'Access is restricted to authorized @nrdev.ph users.' }, 401);
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
    const permission = await permissionFor(c.env.DB, user.role_code, module);
    const column = ACTION_COLUMN[action] || 'can_view';
    if (!permission[column]) return c.json({ ok: false, error: `You do not have ${action.toLowerCase()} access to ${module}.` }, 403);
    return next();
  };
}
