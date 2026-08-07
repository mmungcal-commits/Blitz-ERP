import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody } from '../lib/http.js';
import { sendMailQuiet, mailLayout, mailButton, mailFacts, mailAttachments } from '../lib/mailer.js';
import { raiseRfpForPurchaseOrder } from '../lib/po-to-rfp.js';
import { attachmentsFor } from '../lib/attachments.js';

const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const peso = (v, cur) => `${cur || 'PHP'} ${Number(v || 0).toLocaleString('en-US',{minimumFractionDigits:2})}`;

// Everyone who has already touched the document, so rejections reach them all.
function participants(chain) {
  return [...new Set(chain.map(s => String(s.approver_email || '').trim().toLowerCase()).filter(Boolean))];
}

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
  const __d = await first(c.env.DB, `SELECT meta FROM erp_po_doc WHERE purchase_order_id=?`, [step.purchase_order_id]);
  let doc={};try{doc=(__d&&__d.meta)?JSON.parse(__d.meta):{};}catch(e){doc={};}
  const __lm={};(doc.lineMeta||[]).forEach(m=>{__lm[m.no]=m;});
  const linesD=lines.map(l=>({...l,unit:(__lm[l.line_no]||{}).unit||'pcs',remarks:(__lm[l.line_no]||{}).remarks||''}));
  const safeChain = chain.map(s => ({ step_no:s.step_no, role:s.role, approver_name:s.approver_name, approver_email:s.approver_email, status:s.status, signature:s.signature, signature_type:s.signature_type, decided_at:s.decided_at, comment:s.comment }));
  return ok(c, { header, doc, lines: linesD, chain: safeChain, step: { role:step.role, approver_name:step.approver_name, status:step.status }, actionable, poStatus: header.status });
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
  const header = await first(c.env.DB, `SELECT * FROM erp_purchase_orders WHERE id=?`, [step.purchase_order_id]);
  const attachments = await attachmentsFor(c.env.DB, 'PURCHASE_ORDER', step.purchase_order_id, step.purchase_order_no);
  const facts = [['Purchase Order', step.purchase_order_no], ['Vendor', header?.vendor_name],
    ['Total', peso(header?.total_amount, header?.currency)],
    ['Decided by', `${step.approver_name || step.approver_email} (${String(step.role||'').replace(/_/g,' ')})`]];

  if(decision === 'REJECTED'){
    await run(c.env.DB, `UPDATE erp_purchase_orders SET status='REJECTED', updated_at=datetime('now') WHERE id=?`, [step.purchase_order_id]);
    const to = participants(chain);
    if (to.length) await sendMailQuiet(c.env, {
      to,
      subject: `Cancelled: Purchase Order ${step.purchase_order_no}`,
      html: mailLayout('Purchase order cancelled',
        `<p><b>${esc(step.approver_name || step.approver_email)}</b> cancelled this purchase order.</p>`
        + mailFacts(facts.concat([['Reason', b.comment || 'No reason given']]))
        + `<p style="font-size:12px;color:#657586">The requestor can raise a corrected purchase order from Inbound Logistics.</p>`,
        'Purchase order approval routing'),
    });
    return ok(c, { decision, poStatus: 'REJECTED', done: true, notified: to });
  }
  const after = await loadChain(c.env.DB, step.purchase_order_id);
  const next = currentStep(after);
  const origin = new URL(c.req.url).origin;
  if(!next){
    await run(c.env.DB, `UPDATE erp_purchase_orders SET status='APPROVED', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [step.approver_email || step.approver_name || 'approver', step.purchase_order_id]);
    // The last signature is what raises the payment request, so the approved
    // figure and the figure Finance pays are the same figure.
    const approved = await first(c.env.DB, `SELECT * FROM erp_purchase_orders WHERE id=?`, [step.purchase_order_id]);
    const rfp = await raiseRfpForPurchaseOrder(c.env.DB, approved, step.approver_email);
    const to = participants(after);
    if (to.length) await sendMailQuiet(c.env, {
      to,
      subject: `Fully approved: Purchase Order ${step.purchase_order_no}`,
      html: mailLayout('Purchase order fully approved',
        `<p>All approvers have signed. The purchase order is now <b>APPROVED</b> and can be sent to the vendor.</p>`
        + mailFacts(rfp.created ? facts.concat([['Payment request', rfp.requestNo + ' (draft)']]) : facts)
        + mailAttachments(attachments),
        'Purchase order approval routing'),
    });
    return ok(c, { decision, poStatus: 'APPROVED', done: true, notified: to, paymentRequest: rfp });
  }
  // Hand the baton to the next approver automatically.
  const nextLink = `${origin}/approve.html?token=${next.token}`;
  const mailed = next.approver_email ? await sendMailQuiet(c.env, {
    to: next.approver_email,
    subject: `Approval needed: Purchase Order ${step.purchase_order_no}`,
    html: mailLayout('Purchase order awaiting your approval',
      `<p><b>${esc(step.approver_name || step.approver_email)}</b> has signed. It is now your turn as <b>${esc(String(next.role||'').replace(/_/g,' '))}</b>.</p>`
      + mailFacts(facts)
      + mailButton(nextLink, 'Review and sign')
      + mailAttachments(attachments)
      + `<p style="font-size:12px;color:#657586">No login is required.</p>`,
      'Purchase order approval routing'),
  }) : { ok: false, skipped: true };
  return ok(c, { decision, poStatus: 'FOR_APPROVAL', done: false,
    next: { role: next.role, approver_name: next.approver_name, token: next.token },
    notified: mailed.ok ? next.approver_email : null });
});
