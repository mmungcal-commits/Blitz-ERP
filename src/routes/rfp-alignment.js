// src/routes/rfp-alignment.js
// RFP workflow alignment for the Payables module: MANCOM tier, returns-with-reason,
// e-signature + separation of duties, cash advances with per-line liquidation, and
// proof of payment. Self-contained: talks to D1 directly (c.env.DB) and returns JSON,
// so it does not depend on the exact signatures of the shared lib helpers.
//
// Mounted in src/index.js alongside financeRoutes: app.route('/api/finance', rfpAlignmentRoutes).
import { Hono } from 'hono';
import {
  requiredStages, checkApproval, nextStage,
  mancomMin as mancomMinFor, rfpFlag,
} from '../lib/rfp-rules.js';

export const rfpAlignmentRoutes = new Hono();

// The signed-in user. src/lib/auth.js puts the erp_users row on the context as
// 'erpUser'; the other keys are fallbacks so this module still works if it is
// lifted into another app. Resolving this is what makes the role gate and the
// separation-of-duties checks below real rather than decorative.
function actor(c) {
  const s = c.get('erpUser') || c.get('session') || c.get('user') || c.get('auth') || {};
  return {
    email: String(s.email || s.user || s.username || 'system').toLowerCase(),
    name: s.display_name || s.name || s.full_name || s.fullName || s.email || 'system',
    role: String(s.role_code || s.role || s.roleCode || '').toUpperCase(),
  };
}
const db = (c) => c.env.DB;
const mancomMin = (c) => mancomMinFor(db(c));
async function approvalsFor(c, ref) {
  const r = await db(c).prepare('SELECT stage,decision,actor,actor_name,reason,signature,created_at FROM erp_rfp_approvals WHERE rfp_ref=? ORDER BY id').bind(ref).all();
  return r.results || [];
}
// GET /rfp/:ref/workflow  — current approval trail + whether MANCOM applies
rfpAlignmentRoutes.get('/rfp/:ref/workflow', async (c) => {
  const ref = c.req.param('ref');
  const amount = Number(c.req.query('amount') || 0);
  const min = await mancomMin(c);
  const trail = await approvalsFor(c, ref);
  return c.json({ ok: true, ref, mancomRequired: amount >= min, mancomMin: min, stages: requiredStages(amount, min), trail });
});

// POST /rfp/:ref/approve  { stage, amount, signature }
// e-signature required; separation of duties: same person cannot sign two stages,
// and cannot approve an RFP they submitted (submittedBy passed from the client/RFP row).
rfpAlignmentRoutes.post('/rfp/:ref/approve', async (c) => {
  const ref = c.req.param('ref');
  const b = await c.req.json().catch(() => ({}));
  const me = actor(c);
  const stage = String(b.stage || '').toUpperCase();
  const min = await mancomMin(c);
  const amount = Number(b.amount || 0);
  const trail = await approvalsFor(c, ref);

  const refusal = checkApproval({
    stage, actorEmail: me.email, actorRole: me.role, submittedBy: b.submittedBy,
    amount, min, signature: b.signature, trail,
    requireSignature: await rfpFlag(db(c), 'rfp_require_signature', '1'),
    enforceRoleGate: await rfpFlag(db(c), 'rfp_role_gate', '0'),
    enforceSod: await rfpFlag(db(c), 'rfp_separation_of_duties', '1'),
  });
  if (refusal) return c.json({ ok: false, msg: refusal.msg }, refusal.code);

  await db(c).prepare('INSERT INTO erp_rfp_approvals(rfp_ref,stage,decision,actor,actor_name,signature,amount) VALUES(?,?,?,?,?,?,?)')
    .bind(ref, stage, 'APPROVED', me.email, me.name, String(b.signature).slice(0, 300000), amount).run();

  const next = nextStage(amount, min, await approvalsFor(c, ref));
  return c.json({ ok: true, stage, nextStage: next, fullyApproved: !next, stages: requiredStages(amount, min) });
});

// POST /rfp/:ref/return  { stage, reason }  — reason is mandatory
rfpAlignmentRoutes.post('/rfp/:ref/return', async (c) => {
  const ref = c.req.param('ref');
  const b = await c.req.json().catch(() => ({}));
  const me = actor(c);
  const reason = String(b.reason || '').trim();
  if (!reason) return c.json({ ok: false, msg: 'A return reason is required.' }, 400);
  await db(c).prepare('INSERT INTO erp_rfp_approvals(rfp_ref,stage,decision,actor,actor_name,reason) VALUES(?,?,?,?,?,?)')
    .bind(ref, String(b.stage || 'DEPARTMENT').toUpperCase(), 'RETURNED', me.email, me.name, reason).run();
  return c.json({ ok: true, status: 'RETURNED', reason });
});

// ---------- Cash advances ----------
async function nextCa(c) {
  const r = await db(c).prepare("SELECT id FROM erp_rfp_cash_advances ORDER BY id DESC LIMIT 1").first();
  const n = r ? (parseInt(String(r.id).replace(/\D/g, ''), 10) || 0) + 1 : 1;
  return 'CA' + ('00000000' + n).slice(-8);
}
// POST /rfp/cash-advance  { requestor, department, amount, purpose, rfp_ref? }
rfpAlignmentRoutes.post('/rfp/cash-advance', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const amount = Number(b.amount || 0);
  if (amount <= 0) return c.json({ ok: false, msg: 'Amount must be greater than zero.' }, 400);
  const id = await nextCa(c);
  const me = actor(c);
  await db(c).prepare('INSERT INTO erp_rfp_cash_advances(id,rfp_ref,requestor,department,amount,purpose,status) VALUES(?,?,?,?,?,?,?)')
    .bind(id, b.rfp_ref || null, b.requestor || me.email, b.department || '', amount, b.purpose || '', 'PENDING').run();
  return c.json({ ok: true, id });
});
// POST /rfp/cash-advance/:id/release  — mark FOR_LIQUIDATION (after it is approved/paid)
rfpAlignmentRoutes.post('/rfp/cash-advance/:id/release', async (c) => {
  const id = c.req.param('id');
  const ca = await db(c).prepare('SELECT * FROM erp_rfp_cash_advances WHERE id=?').bind(id).first();
  if (!ca) return c.json({ ok: false, msg: 'Cash advance not found.' }, 404);
  await db(c).prepare("UPDATE erp_rfp_cash_advances SET status='FOR_LIQUIDATION', updated_at=datetime('now') WHERE id=?").bind(id).run();
  return c.json({ ok: true, status: 'FOR_LIQUIDATION' });
});
// POST /rfp/cash-advance/:id/liquidate  { date, lines:[{activity,amount,receipt_ref}] }
// gated: only when the advance is FOR_LIQUIDATION (mirrors the live liquidation gate).
rfpAlignmentRoutes.post('/rfp/cash-advance/:id/liquidate', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json().catch(() => ({}));
  const ca = await db(c).prepare('SELECT * FROM erp_rfp_cash_advances WHERE id=?').bind(id).first();
  if (!ca) return c.json({ ok: false, msg: 'Cash advance not found.' }, 404);
  if (String(ca.status) !== 'FOR_LIQUIDATION')
    return c.json({ ok: false, msg: `This cash advance is not ready for liquidation (status: ${ca.status}). It must be approved and released first.` }, 409);
  if (!b.date) return c.json({ ok: false, msg: 'Please select the liquidation date.' }, 400);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return c.json({ ok: false, msg: 'Add at least one liquidation line with a receipt.' }, 400);
  let spent = 0;
  for (const ln of lines) {
    const amt = Number(ln.amount) || 0; spent += amt;
    await db(c).prepare('INSERT INTO erp_rfp_liquidation_lines(advance_id,activity,amount,receipt_ref) VALUES(?,?,?,?)')
      .bind(id, ln.activity || '', amt, ln.receipt_ref || '').run();
  }
  const variance = Number(ca.amount) - spent;
  await db(c).prepare("UPDATE erp_rfp_cash_advances SET status='LIQUIDATED', liq_date=?, spent=?, variance=?, updated_at=datetime('now') WHERE id=?")
    .bind(b.date, spent, variance, id).run();
  return c.json({ ok: true, status: 'LIQUIDATED', spent, variance });
});

// POST /rfp/:ref/proof-of-payment  { reference, paid_at }
rfpAlignmentRoutes.post('/rfp/:ref/proof-of-payment', async (c) => {
  const ref = c.req.param('ref');
  const b = await c.req.json().catch(() => ({}));
  const me = actor(c);
  if (!b.reference || !String(b.reference).trim()) return c.json({ ok: false, msg: 'A payment reference is required.' }, 400);
  await db(c).prepare('INSERT INTO erp_rfp_proof_of_payment(rfp_ref,reference,paid_at,actor) VALUES(?,?,?,?)')
    .bind(ref, String(b.reference), b.paid_at || new Date().toISOString().slice(0, 10), me.email).run();
  return c.json({ ok: true, status: 'PAID' });
});
