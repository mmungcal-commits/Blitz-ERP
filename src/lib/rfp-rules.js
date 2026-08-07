// src/lib/rfp-rules.js
// The RFP approval rules exactly as the live SWIFT app enforces them, so the
// ERP behaves the same way. Source: "E88 RFP & Payments - System Workflow
// Specification" (sections 3-6).
//
//   Canonical order  DEPARTMENT -> FINANCE -> MANCOM (conditional) -> FINAL
//   Stage roles      DEPARTMENT=DEPTHEAD  FINANCE=FINANCE  MANCOM=MANCOM  FINAL=CEO
//   MANCOM applies   only when the amount is >= erp_rfp_settings.mancom_min
//
// Everything here is pure logic plus two small settings reads, so both
// src/routes/finance.js (the chain the UI drives) and src/routes/rfp-alignment.js
// (the SWIFT-compatible endpoints) enforce one identical rule set.

export const STAGE_ORDER = ['DEPARTMENT', 'FINANCE', 'MANCOM', 'FINAL'];

export const STAGE_ROLE = {
  DEPARTMENT: 'DEPTHEAD',
  FINANCE: 'FINANCE',
  MANCOM: 'MANCOM',
  FINAL: 'CEO',
};

// The spec names the SWIFT role codes; this ERP uses its own. One stage may be
// satisfied by any role in its list. Kept generous on purpose: a Department
// Manager standing in for the Department Head is normal practice here.
export const STAGE_ROLE_ALIASES = {
  DEPARTMENT: ['DEPTHEAD', 'DEPT_HEAD', 'DEPT_MANAGER', 'DEPARTMENT_HEAD', 'DEPARTMENT_MANAGER', 'SCM_MANAGER'],
  FINANCE: ['FINANCE', 'FINANCE_MANAGER', 'ACCOUNTING', 'CONTROLLER'],
  MANCOM: ['MANCOM', 'MANCOM_MEMBER', 'MANAGEMENT_COMMITTEE'],
  FINAL: ['CEO', 'PRESIDENT', 'CHIEF_EXECUTIVE'],
};

// "Admin may act on any stage (override); the action is still recorded."
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN', 'SYSADMIN'];

export const isAdminRole = (role) => ADMIN_ROLES.includes(String(role || '').toUpperCase());

export function roleSatisfiesStage(role, stage) {
  const r = String(role || '').toUpperCase();
  if (!r) return false;
  if (isAdminRole(r)) return true;
  const allowed = STAGE_ROLE_ALIASES[stage] || [STAGE_ROLE[stage]];
  return allowed.includes(r);
}

// The action names the UI posts, mapped onto the spec's stage names.
export const ACTION_STAGE = {
  DEPARTMENT_APPROVE: 'DEPARTMENT',
  FINANCE_VALIDATE: 'FINANCE',
  MANCOM_APPROVE: 'MANCOM',
  FINAL_APPROVE: 'FINAL',
};

export const APPROVAL_ACTIONS = Object.keys(ACTION_STAGE);

/** Which stages this amount has to pass. MANCOM drops out below the threshold. */
export function requiredStages(amount, mancomMin) {
  return STAGE_ORDER.filter(s => s !== 'MANCOM' || Number(amount || 0) >= Number(mancomMin || 0));
}

/** Reads a value from erp_rfp_settings, tolerating a missing table. */
export async function rfpSetting(db, key, fallback) {
  try {
    const row = await db.prepare('SELECT value FROM erp_rfp_settings WHERE key=?').bind(key).first();
    if (row && row.value != null && String(row.value) !== '') return String(row.value);
  } catch (e) { /* table not migrated yet */ }
  return fallback;
}

export async function mancomMin(db) {
  return Number(await rfpSetting(db, 'mancom_min', '100000')) || 100000;
}

/** 1/0 switches, so the rules can be tightened without a redeploy. */
export async function rfpFlag(db, key, fallback) {
  const v = await rfpSetting(db, key, fallback);
  return String(v) === '1' || String(v).toLowerCase() === 'true';
}

/**
 * A return branches the request back to the requestor (spec section 9), so the
 * approvals it collected before that return no longer count: on resubmission the
 * chain starts again at DEPARTMENT. Rather than adding a "superseded" column we
 * simply read the trail from the last RETURNED entry onwards — the full history
 * stays intact and printable.
 */
export function activeTrail(trail) {
  const rows = Array.isArray(trail) ? trail : [];
  let from = 0;
  rows.forEach((t, i) => {
    if (String(t.decision || '').toUpperCase() === 'RETURNED') from = i + 1;
  });
  return rows.slice(from);
}

/**
 * The whole of spec section 5, in one place.
 *
 * @param trail rows from erp_rfp_approvals for this RFP
 * @returns {msg, code} when the approval must be refused, or null when it may proceed
 */
export function checkApproval({
  stage, actorEmail, actorRole, submittedBy, amount, min, signature, trail,
  requireSignature = true, enforceRoleGate = false, enforceSod = true,
}) {
  const me = String(actorEmail || '').toLowerCase();
  const rows = activeTrail(trail);

  if (!STAGE_ORDER.includes(stage)) return { msg: 'Unknown approval stage.', code: 400 };

  // e-signature: "a typed name or drawn signature is required"
  if (requireSignature && !String(signature || '').trim()) {
    return { msg: 'An e-signature is required to approve. Draw or type your name in the signature box.', code: 400 };
  }

  // MANCOM tiering
  if (stage === 'MANCOM' && Number(amount || 0) < Number(min || 0)) {
    return { msg: `MANCOM approval only applies to requests of PHP ${Number(min).toLocaleString('en-US')} or more.`, code: 400 };
  }

  // role gate
  if (enforceRoleGate && !roleSatisfiesStage(actorRole, stage)) {
    return { msg: `This stage requires the ${STAGE_ROLE[stage]} role.`, code: 403 };
  }

  if (enforceSod) {
    if (submittedBy && String(submittedBy).toLowerCase() === me) {
      return { msg: 'You cannot approve a request for payment you submitted (separation of duties).', code: 403 };
    }
    const signedElsewhere = rows.some(t =>
      String(t.decision || '').toUpperCase() === 'APPROVED' &&
      STAGE_ORDER.includes(String(t.stage || '').toUpperCase()) &&
      String(t.stage || '').toUpperCase() !== stage &&
      String(t.actor || '').toLowerCase() === me);
    if (signedElsewhere && !isAdminRole(actorRole)) {
      return { msg: 'You already signed an earlier stage of this request (separation of duties).', code: 403 };
    }
  }

  const already = rows.some(t =>
    String(t.stage || '').toUpperCase() === stage &&
    String(t.decision || '').toUpperCase() === 'APPROVED');
  if (already) return { msg: `This request is already approved at the ${stage} stage.`, code: 409 };

  return null;
}

/** Next stage still outstanding, or null when the RFP is fully approved. */
export function nextStage(amount, min, trail) {
  const done = activeTrail(trail)
    .filter(t => String(t.decision || '').toUpperCase() === 'APPROVED')
    .map(t => String(t.stage || '').toUpperCase());
  return requiredStages(amount, min).find(s => !done.includes(s)) || null;
}
