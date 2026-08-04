import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody } from '../lib/http.js';

// PUBLIC (no login) purchase-order approval by token.
// Mounted before requireUser so approvers can act straight from an emailed link.
export const poApprovalPublicRoutes = new Hono();

async function loadChain(db, poId){
  return await all(db, `SELECT * FROM erp_po_approvals WHERE purchase_order_id=? ORDER BY step_no`, [poId]);
}
function currentStep(chain){
  return chain.find(s => s.status === 'PENDING' && s.role !== 'CREATOR') || null;
}

// View the PO + chain for a token
poApprovalPublicRoutes.get('/:token', async c => {
  const token = c.req.param('token');
  const step = await first(c.env.DB, `SELECT * FROM erp_po_approvals WHERE token=?`, [token]);
  if(!step) return fail(c, 'This approval link is invalid or has expired.', 404);
  const header = await first(c.env.DB, `SELECT * FROM erp_purchase_orders WHERE id=?`, [step.purchase_order_id]);
  if(!header) return fail(c, 'Purchase order not found.', 404);
  const lines = await all(c.env.DB, `SELECT * FROM erp_purchase_order_lines WHERE purchase_order_id=? ORDER BY line_no`, [step.purchase_order_id]);
  const chain = await loadChain(c.env.DB, step.purchase_order_id);
  const cur = currentStep(chain);
  const actionable = !!cur && cur.token === token && step.status === 'PENDING';
  const safeChain = chain.map(s => ({ step_no:s.step_no, role:s.role, approver_name:s.approver_name, approver_email:s.approver_email, status:s.status, signature:s.signature, signature_type:s.signature_type, decided_at:s.decided_at, comment:s.comment }));
  return ok(c, { header, lines, chain: safeChain, step: { role:step.role, approver_name:step.approver_name, status:step.status }, actionable, poStatus: header.status });
});

// Approve or reject with an e-signature
poApprovalPublicRoutes.post('/:token', async c => {
  const token = c.req.param('token');
  const b = await jsonBody(c);
  const step = await first(c.env.DB, `SELECT * FROM erp_po_approvals WHERE token=?`, [token]);
  if(!step) return fail(c, 'This approval link is invalid or has expired.', 404);
  if(step.status !== 'PENDING') return fail(c, `You already recorded a decision (${step.status}).`, 409);
  const chain = await loadChain(c.env.DB, step.purchase_order_id);
  const cur = currentStep(chain);
  if(!cur || cur.id !== step.id) return fail(c, 'It is not this step\'s turn yet. Earlier approvers must sign first.', 409);
  const decision = (b.decision || 'APPROVE').toUpperCase() === 'REJECT' ? 'REJECTED' : 'APPROVED';
  const signature = String(b.signature || '').slice(0, 200000);
  const sigType = (b.signatureType || 'TYPE').toUpperCase() === 'DRAW' ? 'DRAW' : 'TYPE';
  if(decision === 'APPROVED' && !signature) return fail(c, 'A signature is required to approve.');
  await run(c.env.DB, `UPDATE erp_po_approvals SET status=?, signature=?, signature_type=?, comment=?, decided_at=datetime('now') WHERE id=?`,
    [decision, signature, sigType, String(b.comment || '').slice(0, 1000), step.id]);
  if(decision === 'REJECTED'){
    await run(c.env.DB, `UPDATE erp_purchase_orders SET status='REJECTED', updated_at=datetime('now') WHERE id=?`, [step.purchase_order_id]);
    return ok(c, { decision, poStatus: 'REJECTED', done: true });
  }
  const after = await loadChain(c.env.DB, step.purchase_order_id);
  const next = currentStep(after);
  if(!next){
    await run(c.env.DB, `UPDATE erp_purchase_orders SET status='APPROVED', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [step.approver_email || step.approver_name || 'approver', step.purchase_order_id]);
    return ok(c, { decision, poStatus: 'APPROVED', done: true });
  }
  return ok(c, { decision, poStatus: 'FOR_APPROVAL', done: false, next: { role: next.role, approver_name: next.approver_name, token: next.token } });
});
