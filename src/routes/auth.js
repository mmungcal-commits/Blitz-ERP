import { Hono } from 'hono';
import { first, run } from '../lib/db.js';
import { ok, fail, jsonBody, requestMeta } from '../lib/http.js';
import {
  expiredSessionCookie,
  hashPassword,
  passwordPolicy,
  randomToken,
  readCookie,
  sessionCookie,
  sha256,
  verifyPassword,
} from '../lib/crypto.js';

export const authRoutes = new Hono();
const DOMAIN = 'nrdev.ph';
const SESSION_SECONDS = 43200;

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validDomain(email, env) {
  return email.endsWith(`@${env.ALLOWED_DOMAIN || DOMAIN}`);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role_code,
    department: user.department,
    liveAccess: !!user.live_access,
    canUseAdminScope: !!user.admin_access,
  };
}

async function recordAuthEvent(c, email, eventType, success, detail = '') {
  const meta = requestMeta(c);
  await run(c.env.DB,
    `INSERT INTO erp_auth_events(email,event_type,success,detail,ip_address,user_agent)
     VALUES(?,?,?,?,?,?)`,
    [email, eventType, success ? 1 : 0, detail, meta.ipAddress, meta.userAgent]);
}

async function createSession(c, user, requestedScope) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const meta = requestMeta(c);
  // ADMIN scope can only ever be granted to accounts explicitly flagged
  // admin_access=1, and only when the user asked for it at login. Every
  // other case (including a mistyped/omitted scope) falls back to
  // OPERATIONS, which is governed purely by the account's role_code.
  const scope = (requestedScope === 'ADMIN' && user.admin_access) ? 'ADMIN' : 'OPERATIONS';
  await run(c.env.DB,
    `INSERT INTO erp_sessions(user_id,token_hash,expires_at,ip_address,user_agent,session_scope)
     VALUES(?,?,?,?,?,?)`,
    [user.id, tokenHash, expiresAt, meta.ipAddress, meta.userAgent, scope]);
  c.header('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
  return scope;
}

authRoutes.post('/login', async c => {
  const body = await jsonBody(c);
  const email = normalizedEmail(body.email);
  const password = String(body.password || '');
  const genericError = 'Invalid email or password, or the account has not been activated.';

  if (!validDomain(email, c.env) || !password) {
    await recordAuthEvent(c, email, 'LOGIN', false, 'INVALID_INPUT');
    return fail(c, genericError, 401);
  }

  const user = await first(c.env.DB,
    `SELECT u.*,cr.password_hash,cr.password_salt,cr.password_iterations,
            cr.activated_at,cr.failed_login_count,cr.locked_until
       FROM erp_users u
       LEFT JOIN erp_user_credentials cr ON cr.user_id=u.id
      WHERE u.email=?`,
    [email]);

  const production = String(c.env.ENVIRONMENT || '').toLowerCase() === 'production';
  if (!user || !user.active || (production && !user.live_access)) {
    await recordAuthEvent(c, email, 'LOGIN', false, 'ACCOUNT_NOT_AUTHORIZED');
    return fail(c, genericError, 401);
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await recordAuthEvent(c, email, 'LOGIN', false, 'ACCOUNT_TEMPORARILY_LOCKED');
    return fail(c, 'This account is temporarily locked. Try again in 15 minutes.', 423);
  }

  let verified = await verifyPassword(password, user.password_hash, user.password_salt, user.password_iterations);

  // One-time migration path for the existing administrator from the prior shared APP_PASS.
  const adminEmail = normalizedEmail(c.env.APP_ADMIN_EMAIL || 'mmungcal@nrdev.ph');
  if (!verified && !user.password_hash && email === adminEmail && c.env.APP_PASS && password === c.env.APP_PASS) {
    const credential = await hashPassword(password);
    await run(c.env.DB,
      `INSERT INTO erp_user_credentials(user_id,password_hash,password_salt,password_iterations,activated_at,updated_at)
       VALUES(?,?,?,?,datetime('now'),datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         password_hash=excluded.password_hash,
         password_salt=excluded.password_salt,
         password_iterations=excluded.password_iterations,
         activated_at=datetime('now'),
         updated_at=datetime('now')`,
      [user.id, credential.hash, credential.salt, credential.iterations]);
    verified = true;
  }

  if (!verified) {
    const failures = Number(user.failed_login_count || 0) + 1;
    const lock = failures >= 5;
    await run(c.env.DB,
      `INSERT INTO erp_user_credentials(user_id,failed_login_count,locked_until,updated_at)
       VALUES(?,?,CASE WHEN ? THEN datetime('now','+15 minutes') ELSE NULL END,datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         failed_login_count=?,
         locked_until=CASE WHEN ? THEN datetime('now','+15 minutes') ELSE locked_until END,
         updated_at=datetime('now')`,
      [user.id, failures, lock ? 1 : 0, failures, lock ? 1 : 0]);
    await recordAuthEvent(c, email, 'LOGIN', false, lock ? 'LOCKED_AFTER_FAILURES' : 'INVALID_CREDENTIALS');
    return fail(c, genericError, 401);
  }

  await run(c.env.DB,
    `UPDATE erp_user_credentials SET failed_login_count=0,locked_until=NULL,updated_at=datetime('now') WHERE user_id=?`,
    [user.id]);
  await run(c.env.DB, `UPDATE erp_users SET last_login_at=datetime('now') WHERE id=?`, [user.id]);
  const requestedScope = normalizedEmail(body.scope) === 'admin' || String(body.scope || '').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'OPERATIONS';
  const grantedScope = await createSession(c, user, requestedScope);
  await recordAuthEvent(c, email, 'LOGIN', true, `SCOPE_${grantedScope}`);
  return ok(c, { user: publicUser(user), scope: grantedScope, canUseAdminScope: !!user.admin_access });
});

authRoutes.post('/activate', async c => {
  const body = await jsonBody(c);
  const email = normalizedEmail(body.email);
  const tokenHash = await sha256(body.token || '');
  const policyError = passwordPolicy(body.password);
  if (!validDomain(email, c.env)) return fail(c, 'Only @nrdev.ph accounts can be activated.');
  if (policyError) return fail(c, policyError);
  if (body.password !== body.confirmPassword) return fail(c, 'Passwords do not match.');

  const user = await first(c.env.DB,
    `SELECT u.*,cr.activation_token_hash,cr.activation_expires_at
       FROM erp_users u
       JOIN erp_user_credentials cr ON cr.user_id=u.id
      WHERE u.email=?`,
    [email]);
  if (!user || !user.active || user.activation_token_hash !== tokenHash ||
      !user.activation_expires_at || new Date(user.activation_expires_at).getTime() <= Date.now()) {
    await recordAuthEvent(c, email, 'ACTIVATE', false, 'INVALID_OR_EXPIRED_TOKEN');
    return fail(c, 'The activation link is invalid or has expired.', 400);
  }

  const credential = await hashPassword(body.password);
  await run(c.env.DB,
    `UPDATE erp_user_credentials
        SET password_hash=?,password_salt=?,password_iterations=?,activated_at=datetime('now'),
            activation_token_hash=NULL,activation_expires_at=NULL,failed_login_count=0,locked_until=NULL,
            updated_at=datetime('now')
      WHERE user_id=?`,
    [credential.hash, credential.salt, credential.iterations, user.id]);
  await createSession(c, user);
  await recordAuthEvent(c, email, 'ACTIVATE', true);
  return ok(c, { user: publicUser(user) });
});

authRoutes.post('/reset-password', async c => {
  const body = await jsonBody(c);
  const email = normalizedEmail(body.email);
  const tokenHash = await sha256(body.token || '');
  const policyError = passwordPolicy(body.password);
  if (!validDomain(email, c.env)) return fail(c, 'Only @nrdev.ph accounts are supported.');
  if (policyError) return fail(c, policyError);
  if (body.password !== body.confirmPassword) return fail(c, 'Passwords do not match.');

  const user = await first(c.env.DB,
    `SELECT u.*,cr.reset_token_hash,cr.reset_expires_at
       FROM erp_users u
       JOIN erp_user_credentials cr ON cr.user_id=u.id
      WHERE u.email=?`,
    [email]);
  if (!user || !user.active || user.reset_token_hash !== tokenHash ||
      !user.reset_expires_at || new Date(user.reset_expires_at).getTime() <= Date.now()) {
    await recordAuthEvent(c, email, 'RESET_PASSWORD', false, 'INVALID_OR_EXPIRED_TOKEN');
    return fail(c, 'The password-reset link is invalid or has expired.', 400);
  }

  const credential = await hashPassword(body.password);
  await run(c.env.DB,
    `UPDATE erp_user_credentials
        SET password_hash=?,password_salt=?,password_iterations=?,reset_token_hash=NULL,reset_expires_at=NULL,
            failed_login_count=0,locked_until=NULL,updated_at=datetime('now')
      WHERE user_id=?`,
    [credential.hash, credential.salt, credential.iterations, user.id]);
  await run(c.env.DB, `DELETE FROM erp_sessions WHERE user_id=?`, [user.id]);
  await createSession(c, user);
  await recordAuthEvent(c, email, 'RESET_PASSWORD', true);
  return ok(c, { user: publicUser(user) });
});

authRoutes.post('/logout', async c => {
  const token = readCookie(c.req.raw, 'e88_session');
  if (token) await run(c.env.DB, `DELETE FROM erp_sessions WHERE token_hash=?`, [await sha256(token)]);
  c.header('Set-Cookie', expiredSessionCookie());
  return ok(c, { signedOut: true });
});
