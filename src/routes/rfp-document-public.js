import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail } from '../lib/http.js';

/*
 * The signed request for payment, readable without a Blitz login.
 *
 * Mounted before requireUser, because the whole point is that Monde Nissin can
 * open the form E88 sent them. Everything about it is deliberately narrow:
 *
 *   - one unguessable token, tied to one request, revocable at any time
 *   - read only. There is no action on this page, nothing to approve, no way
 *     back into the ERP
 *   - the request has to be fully approved. A token cannot be used to watch a
 *     request move through the chain
 *   - the payload is the fields the form prints and the signatures, not the
 *     row. Internal ids, bank account ids, GL links and audit columns do not
 *     leave the building
 *
 * It records every open, because "did they ever look at it" is the first thing
 * Finance ask when a payment goes quiet.
 */
export const rfpDocumentPublicRoutes = new Hono();

// Only what the printed form actually shows.
const FORM_FIELDS = ['request_no','request_date','requestor_name','requestor_email','department',
  'contact_no','purpose','purchase_order_no','request_type','payment_type','mode_of_payment',
  'due_date','payee_name','payee_address','payee_contact','payee_email','payee_tin','vendor_code',
  'bank_name','account_name','account_no','currency','invoice_date','supplier_invoice_no',
  'cost_center','gl_account','uom','gross_amount','withholding_amount','net_payable','remarks',
  'department_approved_by','department_approved_at','finance_validated_by','finance_validated_at',
  'final_approved_by','final_approved_at','status'];

rfpDocumentPublicRoutes.get('/:token', async c => {
  const token = String(c.req.param('token') || '');
  if (token.length < 20) return fail(c, 'This link is not valid.', 404);
  const link = await first(c.env.DB,
    `SELECT * FROM erp_rfp_doc_tokens WHERE token=? AND revoked=0`, [token]);
  if (!link) return fail(c, 'This link is no longer valid. Ask E88 Finance to send it again.', 404);

  const row = await first(c.env.DB,
    `SELECT * FROM erp_payment_requests WHERE request_no=?`, [link.rfp_ref]);
  if (!row) return fail(c, 'This request for payment is no longer on the register.', 404);

  /*
   * A token is issued at dispatch, and dispatch only happens after the CEO has
   * released the request. If it somehow reaches a request that has gone back
   * into the chain, the form is withheld rather than shown half signed.
   */
  const releasedAt = String(row.final_approved_at || '');
  if (!releasedAt) return fail(c, 'This request has not been fully approved.', 409);

  const request = {};
  FORM_FIELDS.forEach(k => { if (row[k] !== undefined) request[k] = row[k]; });

  const signatures = (await all(c.env.DB,
    `SELECT stage,actor,actor_name,signature,created_at FROM erp_rfp_approvals
      WHERE rfp_ref=? AND decision='APPROVED' ORDER BY id`, [link.rfp_ref]))
    .filter(s => s.signature);

  await run(c.env.DB, `UPDATE erp_rfp_doc_tokens
     SET view_count=view_count+1, last_seen_at=datetime('now') WHERE id=?`, [link.id]);

  return ok(c, { request, signatures, dispatchedAt: link.created_at });
});
