import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, numberValue } from '../lib/http.js';
import { permissionFor, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { saveAttachments, attachmentsFor } from '../lib/attachments.js';
import { sendMailQuiet, mailLayout, mailFacts, mailAttachments } from '../lib/mailer.js';
import { nextCode, normalizeText } from '../lib/codes.js';
import { fixedAssetAccountsForCategory, inventoryAccountForCategory } from '../lib/transaction-rules.js';
import {
  approveJournal,
  calculateAgingBucket,
  captureFinanceEvent,
  createJournal,
  createSubledgerDocument,
  ensureAccountingPeriod,
  entityByCode,
  postJournal,
  postSubledgerDocument,
  retryFinanceEvent,
  registerPendingFixedAsset,
  reversePostedJournal,
  submitJournal,
} from '../lib/finance.js';

export const financeRoutes = new Hono();
const round = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function filters(c, alias = 'h') {
  const entity = normalizeText(c.req.query('entity') || 'E88').toUpperCase();
  const dateFrom = normalizeText(c.req.query('dateFrom') || `${new Date().getFullYear()}-01-01`);
  const dateTo = normalizeText(c.req.query('dateTo') || new Date().toISOString().slice(0, 10));
  const department = normalizeText(c.req.query('department'));
  const costCenter = normalizeText(c.req.query('costCenter'));
  const businessLine = normalizeText(c.req.query('businessLine'));
  const where = ['e.entity_code=?', `${alias}.journal_date BETWEEN ? AND ?`];
  const args = [entity, dateFrom, dateTo];
  if (department) { where.push(`l.department=?`); args.push(department); }
  if (costCenter) { where.push(`l.cost_center=?`); args.push(costCenter); }
  if (businessLine) { where.push(`l.business_line=?`); args.push(businessLine); }
  return { entity, dateFrom, dateTo, department, costCenter, businessLine, where, args };
}

async function journalDetail(db, id) {
  const header = await first(db,
    `SELECT h.*,e.entity_code,e.entity_name,p.period_name,p.status period_status
       FROM erp_journal_headers h
       JOIN erp_legal_entities e ON e.id=h.entity_id
       LEFT JOIN erp_accounting_periods p ON p.id=h.period_id
      WHERE h.id=?`, [id]);
  if (!header) return null;
  const lines = await all(db,
    `SELECT l.*,a.account_code,a.account_name,a.account_type,p.name partner_name
       FROM erp_journal_lines l
       JOIN erp_chart_accounts a ON a.id=l.account_id
       LEFT JOIN erp_partners p ON p.id=l.partner_id
      WHERE l.journal_id=? ORDER BY l.line_no`, [id]);
  return { header, lines };
}

financeRoutes.get('/master-data', requirePermission('FINANCE', 'VIEW'), async c => {
  const [entities, accounts, periods, taxCodes, partners, bankAccounts] = await Promise.all([
    all(c.env.DB, `SELECT * FROM erp_legal_entities WHERE active=1 ORDER BY entity_code`),
    all(c.env.DB, `SELECT * FROM erp_chart_accounts WHERE active=1 ORDER BY account_code`),
    all(c.env.DB, `SELECT p.*,e.entity_code FROM erp_accounting_periods p
      JOIN erp_legal_entities e ON e.id=p.entity_id ORDER BY p.fiscal_year DESC,p.period_no DESC`),
    all(c.env.DB, `SELECT * FROM erp_tax_codes WHERE active=1 ORDER BY tax_type,tax_code`),
    all(c.env.DB, `SELECT id,partner_code,partner_type,name,credit_status FROM erp_partners
      WHERE active=1 ORDER BY partner_type,name LIMIT 5000`),
    all(c.env.DB, `SELECT b.*,e.entity_code,a.account_code,a.account_name FROM erp_bank_accounts b
      JOIN erp_legal_entities e ON e.id=b.entity_id
      JOIN erp_chart_accounts a ON a.id=b.gl_account_id WHERE b.active=1 ORDER BY b.bank_name`),
  ]);
  return ok(c, { entities, accounts, periods, taxCodes, partners, bankAccounts });
});

financeRoutes.get('/dashboard', requirePermission('FINANCE', 'VIEW'), async c => {
  const f = filters(c);
  const base = `
    FROM erp_journal_headers h
    JOIN erp_legal_entities e ON e.id=h.entity_id
    JOIN erp_journal_lines l ON l.journal_id=h.id
    JOIN erp_chart_accounts a ON a.id=l.account_id
    WHERE h.status='POSTED' AND ${f.where.join(' AND ')}`;
  const [balances, activity, worklist, events, bank, inventory, overdue] = await Promise.all([
    first(c.env.DB, `SELECT
      COALESCE(SUM(CASE WHEN a.control_type='BANK' THEN l.base_debit-l.base_credit ELSE 0 END),0) cash,
      COALESCE(SUM(CASE WHEN a.control_type='AR' THEN l.base_debit-l.base_credit ELSE 0 END),0) receivables,
      COALESCE(SUM(CASE WHEN a.control_type='AP' THEN l.base_credit-l.base_debit ELSE 0 END),0) payables,
      COALESCE(SUM(CASE WHEN a.account_type='REVENUE' THEN l.base_credit-l.base_debit ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN a.account_type IN ('COGS','EXPENSE') THEN l.base_debit-l.base_credit ELSE 0 END),0) expenses
      ${base}`, f.args),
    all(c.env.DB, `SELECT strftime('%Y-%m',h.journal_date) period,
      COALESCE(SUM(CASE WHEN a.account_type='REVENUE' THEN l.base_credit-l.base_debit ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN a.account_type IN ('COGS','EXPENSE') THEN l.base_debit-l.base_credit ELSE 0 END),0) expenses
      ${base} GROUP BY strftime('%Y-%m',h.journal_date) ORDER BY period`, f.args),
    first(c.env.DB, `SELECT
      SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END) submitted,
      SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) approved,
      SUM(CASE WHEN status='DRAFT' THEN 1 ELSE 0 END) drafts
      FROM erp_journal_headers h JOIN erp_legal_entities e ON e.id=h.entity_id
      WHERE e.entity_code=?`, [f.entity]),
    first(c.env.DB, `SELECT
      SUM(CASE WHEN status='CAPTURED' THEN 1 ELSE 0 END) captured,
      SUM(CASE WHEN status='JOURNAL_PREPARED' THEN 1 ELSE 0 END) prepared,
      SUM(CASE WHEN status='ERROR' THEN 1 ELSE 0 END) errors,
      SUM(CASE WHEN status='NO_FINANCIAL_IMPACT' THEN 1 ELSE 0 END) no_effect
      FROM erp_finance_source_events WHERE entity_code=?`, [f.entity]),
    first(c.env.DB, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) statement_balance,
      SUM(CASE WHEN status='UNMATCHED' THEN 1 ELSE 0 END) unmatched
      FROM erp_bank_transactions bt JOIN erp_bank_accounts b ON b.id=bt.bank_account_id
      JOIN erp_legal_entities e ON e.id=b.entity_id WHERE e.entity_code=?`, [f.entity]),
    first(c.env.DB, `SELECT * FROM vw_erp_inventory_gl_reconciliation`),
    first(c.env.DB, `SELECT COALESCE(SUM(open_balance),0) amount,COUNT(*) documents
      FROM erp_subledger_documents d JOIN erp_legal_entities e ON e.id=d.entity_id
      WHERE e.entity_code=? AND d.open_balance>0 AND d.due_date<? AND d.status IN ('SUBMITTED','POSTED')`,
      [f.entity, f.dateTo]),
  ]);
  return ok(c, {
    filters:f,
    balances:{
      ...balances,
      profit:round(Number(balances?.revenue || 0) - Number(balances?.expenses || 0)),
    },
    activity, worklist, events, bank, inventory, overdue,
  });
});

financeRoutes.get('/accounts', requirePermission('FINANCE', 'VIEW'), async c => {
  const q = `%${normalizeText(c.req.query('q'))}%`;
  const rows = await all(c.env.DB,
    `SELECT * FROM erp_chart_accounts
      WHERE (?='%%' OR account_code LIKE ? OR account_name LIKE ?)
      ORDER BY account_code`, [q, q, q]);
  return ok(c, { rows });
});

financeRoutes.post('/accounts', requirePermission('FINANCE', 'MANAGE'), async c => {
  const b = await jsonBody(c);
  const code = normalizeText(b.accountCode);
  const name = normalizeText(b.accountName);
  if (!code || !name) return fail(c, 'Account code and name are required.');
  const type = normalizeText(b.accountType).toUpperCase();
  if (!['ASSET','CONTRA_ASSET','LIABILITY','EQUITY','REVENUE','COGS','EXPENSE'].includes(type)) {
    return fail(c, 'Select a valid account type.');
  }
  await run(c.env.DB,
    `INSERT INTO erp_chart_accounts(
      account_code,account_name,account_type,financial_statement,normal_balance,parent_account_code,
      control_type,cash_flow_group,system_account,allow_manual_posting
    ) VALUES(?,?,?,?,?,?,?,?,0,?)`,
    [
      code, name, type, ['REVENUE','COGS','EXPENSE'].includes(type) ? 'INCOME_STATEMENT' : 'BALANCE_SHEET',
      ['LIABILITY','EQUITY','REVENUE'].includes(type) ? 'CREDIT' : 'DEBIT',
      normalizeText(b.parentAccountCode), normalizeText(b.controlType || 'NONE').toUpperCase(),
      normalizeText(b.cashFlowGroup), b.allowManualPosting === false ? 0 : 1,
    ]);
  const account = await first(c.env.DB, `SELECT * FROM erp_chart_accounts WHERE account_code=?`, [code]);
  await audit(c, { action:'CREATE', module:'FINANCE', recordType:'ACCOUNT', recordId:account.id, recordNo:code, after:account });
  return ok(c, { account }, 201);
});

financeRoutes.get('/periods', requirePermission('FINANCE', 'VIEW'), async c => {
  const entity = normalizeText(c.req.query('entity') || 'E88').toUpperCase();
  const year = Number(c.req.query('year') || new Date().getFullYear());
  const rows = await all(c.env.DB,
    `SELECT p.*,e.entity_code,e.entity_name FROM erp_accounting_periods p
      JOIN erp_legal_entities e ON e.id=p.entity_id
      WHERE e.entity_code=? AND p.fiscal_year=? ORDER BY p.period_no`,
    [entity, year]);
  return ok(c, { entity, year, rows });
});

financeRoutes.post('/periods/generate', requirePermission('FINANCE', 'MANAGE'), async c => {
  const b = await jsonBody(c);
  const entity = await entityByCode(c.env.DB, b.entityCode || 'E88');
  if (!entity) return fail(c, 'Entity not found.', 404);
  const year = Number(b.year || new Date().getFullYear());
  for (let month = 1; month <= 12; month += 1) {
    await ensureAccountingPeriod(c.env.DB, entity.id, `${year}-${String(month).padStart(2, '0')}-01`);
  }
  return ok(c, { generated:12, entityCode:entity.entity_code, year }, 201);
});

financeRoutes.post('/periods/:id/close-request', requirePermission('FINANCE', 'MANAGE'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const period = await first(c.env.DB,
    `SELECT p.*,e.entity_code FROM erp_accounting_periods p
      JOIN erp_legal_entities e ON e.id=p.entity_id WHERE p.id=?`, [id]);
  if (!period) return fail(c, 'Period not found.', 404);
  if (period.status === 'CLOSED') return fail(c, 'Period is already closed.', 409);
  const requestNo = await nextCode(c.env.DB, 'FINANCE_CHANGE_REQUEST', 'FCR', 8);
  await run(c.env.DB,
    `INSERT INTO erp_finance_change_requests(
      request_no,target_type,target_id,target_no,action_type,reason,requested_by
    ) VALUES(?,?,?,?,?,?,?)`,
    [requestNo, 'ACCOUNTING_PERIOD', id, `${period.entity_code}-${period.period_name}`, 'CLOSE_PERIOD',
      normalizeText(b.reason) || 'Month-end close completed', c.get('erpUser').email]);
  return ok(c, { requestNo }, 201);
});

financeRoutes.get('/journals', requirePermission('FINANCE', 'VIEW'), async c => {
  const entity = normalizeText(c.req.query('entity') || 'E88').toUpperCase();
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const q = `%${normalizeText(c.req.query('q'))}%`;
  const args = [entity, q, q, q];
  let statusSql = '';
  if (status) { statusSql = ' AND h.status=?'; args.push(status); }
  const rows = await all(c.env.DB,
    `SELECT h.*,e.entity_code,p.period_name,
      (SELECT COUNT(*) FROM erp_journal_lines l WHERE l.journal_id=h.id) line_count
      FROM erp_journal_headers h
      JOIN erp_legal_entities e ON e.id=h.entity_id
      LEFT JOIN erp_accounting_periods p ON p.id=h.period_id
      WHERE e.entity_code=? AND (?='%%' OR h.journal_no LIKE ? OR h.description LIKE ?)
      ${statusSql}
      ORDER BY h.journal_date DESC,h.id DESC LIMIT 1000`, args);
  return ok(c, { rows });
});

financeRoutes.post('/journals', requirePermission('FINANCE', 'CREATE'), async c => {
  const b = await jsonBody(c);
  try {
    const journal = await createJournal(c.env.DB, {
      entityCode:b.entityCode || 'E88', journalDate:b.journalDate, journalType:b.journalType || 'GENERAL',
      sourceModule:'FINANCE', sourceType:'MANUAL_JOURNAL', description:b.description,
      currency:b.currency || 'PHP', exchangeRate:numberValue(b.exchangeRate, 1),
      department:b.department, costCenter:b.costCenter, businessLine:b.businessLine,
      projectCode:b.projectCode, lines:b.lines,
    }, c.get('erpUser').email);
    await audit(c, { action:'CREATE', module:'FINANCE', recordType:'JOURNAL', recordId:journal.id, recordNo:journal.journal_no, after:journal });
    return ok(c, { journal }, 201);
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.get('/journals/:id', requirePermission('FINANCE', 'VIEW'), async c => {
  const data = await journalDetail(c.env.DB, Number(c.req.param('id')));
  if (!data) return fail(c, 'Journal not found.', 404);
  const changes = await all(c.env.DB,
    `SELECT * FROM erp_finance_change_requests WHERE target_type='JOURNAL' AND target_id=?
      ORDER BY requested_at DESC`, [data.header.id]);
  return ok(c, { ...data, changes });
});

financeRoutes.post('/journals/:id/action', requirePermission('FINANCE', 'EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const action = normalizeText(b.action).toUpperCase();
  try {
    let journal;
    if (action === 'SUBMIT') journal = await submitJournal(c.env.DB, id, c.get('erpUser').email);
    else if (action === 'APPROVE') {
      const permission = await permissionFor(c.env.DB,c.get('erpUser'),'FINANCE');
      if (!permission.can_approve) return fail(c, 'Approval permission is required.', 403);
      journal = await approveJournal(c.env.DB, id, c.get('erpUser').email);
    } else if (action === 'POST') {
      const permission = await permissionFor(c.env.DB,c.get('erpUser'),'FINANCE');
      if (!permission.can_post) return fail(c, 'Posting permission is required.', 403);
      journal = await postJournal(c.env.DB, id, c.get('erpUser').email);
    } else return fail(c, 'Unsupported journal action.');
    await audit(c, { action, module:'FINANCE', recordType:'JOURNAL', recordId:id, recordNo:journal.journal_no, after:journal });
    return ok(c, { journal });
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.post('/journals/:id/change-request', requirePermission('FINANCE', 'EDIT'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const journal = await first(c.env.DB, `SELECT * FROM erp_journal_headers WHERE id=?`, [id]);
  if (!journal) return fail(c, 'Journal not found.', 404);
  const action = normalizeText(b.actionType).toUpperCase();
  if (!['REVERSE','VOID'].includes(action)) return fail(c, 'Select reverse or void.');
  if (action === 'REVERSE' && journal.status !== 'POSTED') return fail(c, 'Only a posted journal can be reversed.', 409);
  if (action === 'VOID' && !['DRAFT','SUBMITTED','APPROVED'].includes(journal.status)) return fail(c, 'This journal cannot be voided.', 409);
  if (normalizeText(b.reason).length < 8) return fail(c, 'Provide a complete reason.');
  const pending = await first(c.env.DB,
    `SELECT * FROM erp_finance_change_requests
      WHERE target_type='JOURNAL' AND target_id=? AND action_type=? AND status='REQUESTED'`, [id, action]);
  if (pending) return fail(c, `${pending.request_no} is already awaiting approval.`, 409);
  const requestNo = await nextCode(c.env.DB, 'FINANCE_CHANGE_REQUEST', 'FCR', 8);
  await run(c.env.DB,
    `INSERT INTO erp_finance_change_requests(
      request_no,target_type,target_id,target_no,action_type,reason,requested_by
    ) VALUES(?,?,?,?,?,?,?)`,
    [requestNo, 'JOURNAL', id, journal.journal_no, action, normalizeText(b.reason), c.get('erpUser').email]);
  return ok(c, { requestNo }, 201);
});

financeRoutes.get('/change-requests', requirePermission('FINANCE', 'APPROVE'), async c => {
  const status = normalizeText(c.req.query('status') || 'REQUESTED').toUpperCase();
  const rows = await all(c.env.DB,
    `SELECT * FROM erp_finance_change_requests WHERE (?='' OR status=?)
      ORDER BY requested_at DESC,id DESC`, [status, status]);
  return ok(c, { rows });
});

financeRoutes.post('/change-requests/:id/decision', requirePermission('FINANCE', 'APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const decision = normalizeText(b.decision).toUpperCase();
  const request = await first(c.env.DB, `SELECT * FROM erp_finance_change_requests WHERE id=?`, [id]);
  if (!request) return fail(c, 'Change request not found.', 404);
  if (request.status !== 'REQUESTED') return fail(c, 'Change request was already decided.', 409);
  const user = c.get('erpUser').email;
  if (request.requested_by === user) return fail(c, 'The requester cannot approve the same change.', 409);
  if (!['APPROVE','REJECT'].includes(decision)) return fail(c, 'Decision must be approve or reject.');
  if (decision === 'REJECT') {
    await run(c.env.DB,
      `UPDATE erp_finance_change_requests
        SET status='REJECTED',decided_by=?,decided_at=datetime('now'),decision_notes=? WHERE id=?`,
      [user, normalizeText(b.notes), id]);
    return ok(c, { status:'REJECTED' });
  }
  try {
    if (request.target_type === 'JOURNAL') {
      if (request.action_type === 'REVERSE') {
        await reversePostedJournal(c.env.DB, request.target_id, user, request.request_no);
      } else {
        await run(c.env.DB,
          `UPDATE erp_journal_headers
            SET status='VOIDED',voided_by=?,voided_at=datetime('now'),updated_at=datetime('now')
            WHERE id=? AND status IN ('DRAFT','SUBMITTED','APPROVED')`, [user, request.target_id]);
      }
    } else if (request.target_type === 'ACCOUNTING_PERIOD' && request.action_type === 'CLOSE_PERIOD') {
      const unposted = await first(c.env.DB,
        `SELECT COUNT(*) n FROM erp_journal_headers
          WHERE period_id=? AND status IN ('DRAFT','SUBMITTED','APPROVED')`, [request.target_id]);
      if (Number(unposted?.n || 0) > 0) throw new Error('Post or void all journals before closing the period.');
      await run(c.env.DB,
        `UPDATE erp_accounting_periods
          SET status='CLOSED',closed_by=?,closed_at=datetime('now') WHERE id=?`, [user, request.target_id]);
    }
    await run(c.env.DB,
      `UPDATE erp_finance_change_requests
        SET status='APPROVED',decided_by=?,decided_at=datetime('now'),decision_notes=?,
            executed_at=datetime('now') WHERE id=?`,
      [user, normalizeText(b.notes), id]);
    await audit(c, { action:`APPROVE_${request.action_type}`, module:'FINANCE',
      recordType:request.target_type, recordId:request.target_id, recordNo:request.target_no, after:request });
    return ok(c, { status:'APPROVED' });
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.get('/source-events', requirePermission('FINANCE', 'VIEW'), async c => {
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const eventType = normalizeText(c.req.query('eventType')).toUpperCase();
  const args = []; const where = [];
  if (status) { where.push('ev.status=?'); args.push(status); }
  if (eventType) { where.push('ev.event_type=?'); args.push(eventType); }
  const rows = await all(c.env.DB,
    `SELECT ev.*,h.journal_no,h.status journal_status
       FROM erp_finance_source_events ev
       LEFT JOIN erp_journal_headers h ON h.id=ev.journal_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ev.event_date DESC,ev.id DESC LIMIT 2000`, args);
  return ok(c, { rows });
});

financeRoutes.post('/source-events/:id/retry', requirePermission('FINANCE', 'MANAGE'), async c => {
  try {
    const event = await retryFinanceEvent(c.env.DB, Number(c.req.param('id')), c.get('erpUser').email);
    if (event.status === 'ERROR') return fail(c, event.error_message, 409);
    return ok(c, { event });
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.post('/sync-operational', requirePermission('FINANCE', 'MANAGE'), async c => {
  const user = c.get('erpUser').email;
  const cutover = (await first(c.env.DB,
    `SELECT value FROM erp_settings WHERE key='FINANCE_CUTOVER_TIMESTAMP'`))?.value || '9999-12-31';
  let captured = 0; let noEffect = 0; let errors = 0;
  const process = async event => {
    const result = await captureFinanceEvent(c.env.DB, event, user);
    if (result.status === 'ERROR') errors += 1;
    else if (result.status === 'NO_FINANCIAL_IMPACT') noEffect += 1;
    else captured += 1;
  };
  const receipts = await all(c.env.DB, `SELECT r.id,r.receipt_no,r.received_at,s.purchase_order_ref,
    p.vendor_id,p.currency,COALESCE(SUM(a.unit_cost),0) amount
    FROM erp_receipts r JOIN erp_shipments s ON s.id=r.shipment_id
    LEFT JOIN erp_purchase_orders p ON p.purchase_order_no=s.purchase_order_ref
    LEFT JOIN erp_assets a ON a.receipt_id=r.id
    WHERE r.receiving_status='POSTED' AND r.created_at>=? GROUP BY r.id`, [cutover]);
  for (const row of receipts) await process({
    eventKey:`RECEIPT:${row.id}`, eventType:'GOODS_RECEIPT', sourceModule:'RECEIVING',
    sourceType:'RECEIPT', sourceId:row.id, sourceNo:row.receipt_no, eventDate:row.received_at,
    partnerId:row.vendor_id, amount:row.amount, currency:row.currency || 'PHP',
    description:`Goods receipt ${row.receipt_no} against ${row.purchase_order_ref || 'unlinked PO'}`,
  });
  const landed = await all(c.env.DB,
    `SELECT * FROM erp_landed_cost_headers WHERE status='POSTED' AND created_at>=?`, [cutover]);
  for (const row of landed) await process({
    eventKey:`LANDED_COST:${row.id}`, eventType:'LANDED_COST', sourceModule:'PROCUREMENT',
    sourceType:'LANDED_COST', sourceId:row.id, sourceNo:row.landed_cost_no,
    eventDate:(row.posted_at || row.created_at || '').slice(0, 10), amount:row.total_cost,
    currency:row.currency || 'PHP', description:`Landed cost ${row.landed_cost_no}`,
  });
  const deliveries = await all(c.env.DB, `SELECT d.id,d.delivery_no,d.actual_delivery_date,
    s.id sales_order_id,s.sales_order_no,s.transaction_type,s.customer_id,s.gross_amount,
    COALESCE(SUM(a.unit_cost),0) cost
    FROM erp_deliveries d
    LEFT JOIN erp_sales_orders s ON s.id=d.sales_order_id
    LEFT JOIN erp_delivery_assets da ON da.delivery_id=d.id
    LEFT JOIN erp_assets a ON a.id=da.asset_id
    WHERE d.status='DELIVERED' AND d.created_at>=? GROUP BY d.id`, [cutover]);
  for (const row of deliveries) {
    const alreadyConnected = await first(c.env.DB,`SELECT COUNT(*) n FROM erp_finance_source_events
      WHERE source_type='DELIVERY' AND source_id=? AND event_type IN (
        'CUSTOMER_INVOICE','SALE_COGS','CAPITALIZATION','INVENTORY_CONSUMPTION','WARRANTY_ISSUE','DONATION_ISSUE'
      )`,[row.id]);
    if(Number(alreadyConnected?.n||0)>0)continue;
    if (row.transaction_type === 'SALE') {
      await process({
        eventKey:`DELIVERY_REVENUE:${row.id}`, eventType:'CUSTOMER_INVOICE', sourceModule:'SALES',
        sourceType:'DELIVERY', sourceId:row.id, sourceNo:row.delivery_no,
        eventDate:row.actual_delivery_date, partnerId:row.customer_id, amount:row.gross_amount,
        businessLine:'SALE', description:`Delivered sale ${row.sales_order_no}`,
        payload:{ grossAmount:row.gross_amount, netAmount:round(row.gross_amount / 1.12),
          taxAmount:round(row.gross_amount - row.gross_amount / 1.12), businessLine:'SALE' },
      });
      await process({
        eventKey:`DELIVERY_COGS:${row.id}`, eventType:'SALE_COGS', sourceModule:'INVENTORY',
        sourceType:'DELIVERY', sourceId:row.id, sourceNo:row.delivery_no,
        eventDate:row.actual_delivery_date, partnerId:row.customer_id, amount:row.cost,
        businessLine:'SALE', description:`Cost of delivered sale ${row.sales_order_no}`,
        payload:{ costAmount:row.cost, businessLine:'SALE' },
      });
    } else {
      await process({
        eventKey:`DELIVERY_CUSTODY:${row.id}`, eventType:'INVENTORY_CUSTODY', sourceModule:'INVENTORY',
        sourceType:'DELIVERY', sourceId:row.id, sourceNo:row.delivery_no,
        eventDate:row.actual_delivery_date, partnerId:row.customer_id, amount:row.cost,
        businessLine:row.transaction_type || 'INTERNAL', financialEffect:'NONE',
        description:`Custody movement ${row.delivery_no} - no immediate accounting effect`,
      });
    }
  }
  const movements = await all(c.env.DB, `SELECT l.*,a.unit_cost,a.category
    FROM erp_stock_ledger l LEFT JOIN erp_assets a ON a.id=l.asset_id
    WHERE l.movement_type IN ('TRANSFER','PLACEMENT','DELIVERED','RETURN','GOODS_ISSUANCE',
      'WRITE_OFF','LOSS','DAMAGE','STATUS_CHANGE') AND l.created_at>=?`, [cutover]);
  for (const row of movements) {
    const writeOff = ['WRITE_OFF','LOSS','DAMAGE'].includes(row.movement_type);
    await process({
      eventKey:`STOCK_MOVEMENT:${row.id}`, eventType:writeOff ? 'INVENTORY_WRITE_OFF' : 'INVENTORY_MOVEMENT',
      sourceModule:'INVENTORY', sourceType:'STOCK_MOVEMENT', sourceId:row.id,
      sourceNo:row.movement_no, eventDate:row.movement_date, amount:row.unit_cost,
      financialEffect:writeOff ? 'ACCOUNTING' : 'NONE',
      description:`${row.movement_type.replaceAll('_',' ')} ${row.serial_no}`,
      payload:{ costAmount:row.unit_cost,category:row.category,assetId:row.asset_id,
        serialNo:row.serial_no,itemId:row.item_id },
    });
  }
  return ok(c, { captured, noEffect, errors, cutover, scanned:{
    receipts:receipts.length, landedCosts:landed.length, deliveries:deliveries.length, movements:movements.length,
  }});
});

financeRoutes.get('/subledger', requirePermission('FINANCE', 'VIEW'), async c => {
  const type = normalizeText(c.req.query('type')).toUpperCase();
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const where = []; const args = [];
  if (type) { where.push('d.document_type=?'); args.push(type); }
  if (status) { where.push('d.status=?'); args.push(status); }
  const rows = await all(c.env.DB,
    `SELECT d.*,e.entity_code,p.partner_code,p.name partner_name,p.partner_type,h.journal_no,h.status journal_status
       FROM erp_subledger_documents d
       JOIN erp_legal_entities e ON e.id=d.entity_id
       JOIN erp_partners p ON p.id=d.partner_id
       LEFT JOIN erp_journal_headers h ON h.id=d.journal_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.document_date DESC,d.id DESC LIMIT 2000`, args);
  return ok(c, { rows });
});

financeRoutes.post('/subledger', requirePermission('FINANCE', 'CREATE'), async c => {
  const b = await jsonBody(c);
  if (!b.documentDate || !b.partnerId || !b.documentType) return fail(c, 'Type, partner and document date are required.');
  try {
    const document = await createSubledgerDocument(c.env.DB, b, c.get('erpUser').email);
    await audit(c, { action:'CREATE', module:'FINANCE', recordType:'SUBLEDGER_DOCUMENT',
      recordId:document.id, recordNo:document.document_no, after:document });
    return ok(c, { document }, 201);
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.post('/subledger/:id/post', requirePermission('FINANCE', 'POST'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  try {
    const document = await postSubledgerDocument(c.env.DB, id, b, c.get('erpUser').email);
    return ok(c, { document });
  } catch (error) { return fail(c, error.message, 409); }
});

financeRoutes.post('/subledger/:id/apply', requirePermission('FINANCE', 'POST'), async c => {
  const paymentId = Number(c.req.param('id')); const b = await jsonBody(c);
  const payment = await first(c.env.DB, `SELECT * FROM erp_subledger_documents WHERE id=?`, [paymentId]);
  const target = await first(c.env.DB, `SELECT * FROM erp_subledger_documents WHERE id=?`, [Number(b.appliedDocumentId)]);
  if (!payment || !target) return fail(c, 'Payment or target document not found.', 404);
  if (payment.id === target.id) return fail(c, 'A document cannot be applied to itself.', 409);
  if (!['POSTED','CLOSED'].includes(payment.status) || !['POSTED','CLOSED'].includes(target.status)) {
    return fail(c, 'Post both accounting journals before applying the payment.', 409);
  }
  if (payment.partner_id !== target.partner_id) return fail(c, 'Payment and document must have the same customer or supplier.', 409);
  const validPair = (
    payment.document_type === 'CUSTOMER_RECEIPT'
      && ['CUSTOMER_INVOICE','LEASE_BILLING'].includes(target.document_type)
  ) || (
    payment.document_type === 'SUPPLIER_PAYMENT'
      && target.document_type === 'SUPPLIER_BILL'
  );
  if (!validPair) return fail(c, 'Select a receipt/payment and a compatible invoice/bill.', 409);
  const applied = await first(c.env.DB,
    `SELECT COALESCE(SUM(amount),0) total FROM erp_subledger_applications
      WHERE payment_document_id=?`, [paymentId]);
  const paymentRemaining = round(Number(payment.gross_amount || 0) - Number(applied?.total || 0));
  const amount = Math.min(numberValue(b.amount), Number(target.open_balance || 0), paymentRemaining);
  if (amount <= 0) return fail(c, 'Application amount must be greater than zero.');
  await run(c.env.DB,
    `INSERT INTO erp_subledger_applications(
      payment_document_id,applied_document_id,application_date,amount,created_by
    ) VALUES(?,?,?,?,?)`,
    [paymentId, target.id, b.applicationDate || new Date().toISOString().slice(0, 10), amount, c.get('erpUser').email]);
  await run(c.env.DB,
    `UPDATE erp_subledger_documents SET open_balance=MAX(0,open_balance-?),
      status=CASE WHEN open_balance-?<=0 THEN 'CLOSED' ELSE status END WHERE id=?`,
    [amount, amount, target.id]);
  if (round(paymentRemaining - amount) <= 0) {
    await run(c.env.DB, `UPDATE erp_subledger_documents SET status='CLOSED' WHERE id=?`, [paymentId]);
  }
  return ok(c, { applied:amount, paymentRemaining:round(paymentRemaining - amount) });
});

financeRoutes.get('/aging/:ledger', requirePermission('FINANCE', 'VIEW'), async c => {
  const ledger = normalizeText(c.req.param('ledger')).toUpperCase();
  const asOf = normalizeText(c.req.query('asOf') || new Date().toISOString().slice(0, 10));
  const customer = ledger === 'AR';
  const types = customer
    ? `('CUSTOMER_INVOICE','CUSTOMER_CREDIT','LEASE_BILLING')`
    : `('SUPPLIER_BILL','SUPPLIER_CREDIT')`;
  const rows = await all(c.env.DB,
    `SELECT d.*,p.partner_code,p.name partner_name,p.credit_status
       FROM erp_subledger_documents d JOIN erp_partners p ON p.id=d.partner_id
      WHERE d.document_type IN ${types} AND d.open_balance>0 AND d.document_date<=?
      ORDER BY p.name,d.due_date,d.document_date`, [asOf]);
  const enriched = rows.map(row => ({ ...row, aging_bucket:calculateAgingBucket(row.due_date, asOf) }));
  const totals = enriched.reduce((out, row) => {
    out.total = round(out.total + Number(row.open_balance || 0));
    out[row.aging_bucket] = round((out[row.aging_bucket] || 0) + Number(row.open_balance || 0));
    return out;
  }, { total:0, CURRENT:0, '1-30':0, '31-60':0, '61-90':0, OVER_90:0 });
  return ok(c, { ledger, asOf, rows:enriched, totals });
});

// Row-level privacy. A requestor only ever sees their own RFPs; a department
// manager/head sees their own department; only Finance and the CEO see everything.
// Controlled by erp_settings.RFP_PRIVACY_ENFORCED so it can be switched off for audit.
async function rfpVisibility(c){
  const user=c.get('erpUser')||{};
  const setting=await first(c.env.DB,`SELECT value FROM erp_settings WHERE key='RFP_PRIVACY_ENFORCED'`);
  if(String(setting?.value??'1')!=='1')return {where:'',args:[],level:'ALL'};
  const role=String(user.role_code||'').toUpperCase();
  if(['FINANCE','CEO'].includes(role))return {where:'',args:[],level:'ALL'};
  if(['DEPT_HEAD','DEPT_MANAGER','SCM_MANAGER'].includes(role)){
    return {where:' AND (r.requestor_email=? OR r.department=?)',args:[user.email,user.department||''],level:'DEPARTMENT'};
  }
  return {where:' AND r.requestor_email=?',args:[user.email],level:'OWN'};
}

financeRoutes.get('/payment-requests', requirePermission('FINANCE', 'VIEW'), async c => {
  const status=normalizeText(c.req.query('status')).toUpperCase();
  const vis=await rfpVisibility(c);
  const rows=await all(c.env.DB,`SELECT r.*,e.entity_code,p.partner_code,p.name partner_name,
    po.purchase_order_no,b.bank_name,b.account_name,
    (SELECT COUNT(*) FROM erp_attachments a WHERE a.record_type='PAYMENT_REQUEST' AND a.record_id=r.id AND a.active=1) attachment_count
    FROM erp_payment_requests r JOIN erp_legal_entities e ON e.id=r.entity_id
    LEFT JOIN erp_partners p ON p.id=r.payee_partner_id
    LEFT JOIN erp_purchase_orders po ON po.id=r.purchase_order_id
    LEFT JOIN erp_bank_accounts b ON b.id=r.bank_account_id
    WHERE (?='' OR r.status=?)${vis.where} ORDER BY r.request_date DESC,r.id DESC`,[status,status,...vis.args]);
  const purchaseOrders=await all(c.env.DB,`SELECT p.id,p.purchase_order_no,p.vendor_id,p.vendor_name,
    p.total_amount,p.tax_amount,p.payment_terms,p.status
    FROM erp_purchase_orders p WHERE p.status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED')
    ORDER BY p.order_date DESC,p.id DESC LIMIT 1000`);
  return ok(c,{rows,purchaseOrders,visibility:vis.level});
});

// One RFP with its Drive attachments and approval trail.
financeRoutes.get('/payment-requests/:id', requirePermission('FINANCE','VIEW'), async c=>{
  const id=Number(c.req.param('id'));
  const vis=await rfpVisibility(c);
  const row=await first(c.env.DB,`SELECT r.*,e.entity_code,p.name partner_name,po.purchase_order_no
    FROM erp_payment_requests r JOIN erp_legal_entities e ON e.id=r.entity_id
    LEFT JOIN erp_partners p ON p.id=r.payee_partner_id
    LEFT JOIN erp_purchase_orders po ON po.id=r.purchase_order_id
    WHERE r.id=?${vis.where}`,[id,...vis.args]);
  if(!row)return fail(c,'Payment request not found.',404);
  const attachments=await attachmentsFor(c.env.DB,'PAYMENT_REQUEST',id,row.request_no);
  const liquidation=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE payment_request_id=?`,[id]);
  const signatures=await all(c.env.DB,`SELECT stage,decision,actor,actor_name,reason,signature,created_at
    FROM erp_rfp_approvals WHERE rfp_ref=? ORDER BY id`,[row.request_no]);
  return ok(c,{request:row,attachments,liquidation:liquidation||null,signatures});
});

financeRoutes.post('/payment-requests', requirePermission('FINANCE','CREATE'), async c=>{
  const b=await jsonBody(c);
  const entity=await entityByCode(c.env.DB,b.entityCode||'E88');
  if(!entity)return fail(c,'Entity not found.',404);
  const po=b.purchaseOrderId?await first(c.env.DB,`SELECT * FROM erp_purchase_orders WHERE id=?`,[Number(b.purchaseOrderId)]):null;
  const landedCost=b.landedCostId?await first(c.env.DB,`SELECT * FROM erp_landed_cost_headers WHERE id=?`,[Number(b.landedCostId)]):null;
  const partner=b.payeePartnerId?await first(c.env.DB,`SELECT * FROM erp_partners WHERE id=?`,[Number(b.payeePartnerId)]):
    po?.vendor_id?await first(c.env.DB,`SELECT * FROM erp_partners WHERE id=?`,[po.vendor_id]):null;
  const payee=normalizeText(b.payeeName||partner?.name||po?.vendor_name);
  if(!payee||!b.department||!b.purpose)return fail(c,'Payee, department and purpose are required.');
  const gross=numberValue(b.grossAmount,landedCost?.invoice_total||po?.total_amount||0);
  const vat=numberValue(b.vatAmount,landedCost?.input_vat_amount||po?.tax_amount||0);
  const withholding=numberValue(b.withholdingAmount);
  const net=round(gross-withholding);
  if(gross<=0)return fail(c,'Gross amount must be greater than zero.');
  const rawType=normalizeText(b.requestType||'Payment to Vendor');
  const isCashAdvance=/cash\s*advance/i.test(rawType);
  const requestNo=await nextCode(c.env.DB,'PAYMENT_REQUEST','RFP',8);
  const inserted=await run(c.env.DB,`INSERT INTO erp_payment_requests(
    request_no,entity_id,request_date,requestor_email,payee_partner_id,payee_name,department,
    cost_center,project_code,purpose,request_type,purchase_order_id,purchase_order_no,landed_cost_id,
    supplier_invoice_no,invoice_date,gross_amount,vat_amount,withholding_amount,net_payable,
    due_date,payment_method,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT')`,[
    requestNo,entity.id,b.requestDate||new Date().toISOString().slice(0,10),c.get('erpUser').email,
    partner?.id||null,payee,normalizeText(b.department),normalizeText(b.costCenter),
    normalizeText(b.projectCode),normalizeText(b.purpose),normalizeText(b.requestType||'SUPPLIER_PAYMENT'),
    po?.id||null,po?.purchase_order_no||normalizeText(b.purchaseOrderNo),landedCost?.id||null,
    normalizeText(b.supplierInvoiceNo),b.invoiceDate||'',gross,vat,withholding,net,
    b.dueDate||'',normalizeText(b.modeOfPayment||b.paymentMethod),
  ]);
  const rfpId=inserted.meta.last_row_id;
  // Extra fields captured on the redesigned form live in the RFP settings-style
  // side table so no ALTER of erp_payment_requests is needed.
  const extras={requestorName:normalizeText(b.requestorName),requestorEmail:normalizeText(b.requestorEmail)||c.get('erpUser').email,
    contactNo:normalizeText(b.contactNo),paymentType:normalizeText(b.paymentType),modeOfPayment:normalizeText(b.modeOfPayment),
    bankName:normalizeText(b.bankName),accountName:normalizeText(b.accountName),accountNo:normalizeText(b.accountNo),
    payeeTin:normalizeText(b.payeeTin),payeeContact:normalizeText(b.payeeContact),payeeEmail:normalizeText(b.payeeEmail),
    glAccount:normalizeText(b.glAccount),currency:normalizeText(b.currency)||'PHP',remarks:normalizeText(b.remarks),
    requestType:rawType,cashAdvance:isCashAdvance?1:0,
    signature:normalizeText(b.requestorSignature),signatureType:normalizeText(b.signatureType)||'TYPE'};
  try{await run(c.env.DB,`INSERT OR REPLACE INTO erp_rfp_settings(key,value) VALUES(?,?)`,['rfp_doc:'+requestNo,JSON.stringify(extras)]);}catch(e){}
  // The requestor's e-signature opens the approval trail.
  if(normalizeText(b.requestorSignature)){
    await run(c.env.DB,`INSERT INTO erp_rfp_approvals(rfp_ref,stage,decision,actor,actor_name,signature,amount)
      VALUES(?,?,?,?,?,?,?)`,[requestNo,'REQUESTOR','SIGNED',c.get('erpUser').email,
      normalizeText(b.requestorName)||c.get('erpUser').display_name||'',
      String(b.requestorSignature).slice(0,300000),net]);
  }
  // Supporting documents -> Google Drive / Payables Management / <RFP no>
  const attach=await saveAttachments(c.env,c.env.DB,{moduleCode:'FINANCE',recordType:'PAYMENT_REQUEST',
    recordId:rfpId,recordNo:requestNo,files:b.attachments,uploadedBy:c.get('erpUser').email});
  await audit(c,{action:'CREATE',module:'FINANCE',recordType:'PAYMENT_REQUEST',
    recordId:rfpId,recordNo:requestNo,after:{gross,vat,withholding,net,cashAdvance:isCashAdvance}});
  return ok(c,{id:rfpId,requestNo,netPayable:net,cashAdvance:isCashAdvance,
    attachments:attach.saved,attachmentErrors:attach.failed},201);
});

// Who to email at each stage. Roles are resolved from erp_users so no addresses
// are hard-coded; APP_ADMIN_EMAIL is the safety net.
async function roleEmails(db,env,roles,department){
  const list=[];
  for(const role of roles){
    const rows=await all(db,`SELECT email FROM erp_users WHERE active=1 AND upper(role_code)=? AND (?='' OR department=? OR ?='ANY')`,
      [String(role).toUpperCase(),department||'',department||'',department?'':'ANY']);
    rows.forEach(r=>{if(r.email)list.push(String(r.email).toLowerCase());});
  }
  if(!list.length&&env.APP_ADMIN_EMAIL)list.push(String(env.APP_ADMIN_EMAIL).toLowerCase());
  return [...new Set(list)];
}

const rfpMoney=(v,cur)=>`${cur||'PHP'} ${Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2})}`;

async function notifyRfp(c,request,{to,cc,title,subject,intro,extraFacts,footer}){
  const recipients=(to||[]).filter(Boolean);
  if(!recipients.length)return {ok:false,skipped:true};
  const attachments=await attachmentsFor(c.env.DB,'PAYMENT_REQUEST',request.id,request.request_no);
  const facts=[['RFP',request.request_no],['Requestor',request.requestor_email],
    ['Department',request.department],['Payee',request.payee_name],
    ['Purpose',request.purpose],['Net payable',rfpMoney(request.net_payable)],
    ['Status',String(request.status||'').replace(/_/g,' ')]].concat(extraFacts||[]);
  const origin=new URL(c.req.url).origin;
  return await sendMailQuiet(c.env,{
    to:recipients,cc:(cc||[]).filter(Boolean),
    subject,
    html:mailLayout(title,
      `<p>${intro}</p>`+mailFacts(facts)+mailAttachments(attachments)
      +`<p style="margin-top:16px"><a href="${origin}/" style="color:#1669a7">Open Payables Management in Blitz - ERP</a></p>`,
      footer||'Request for payment workflow'),
  });
}

financeRoutes.post('/payment-requests/:id/action', requirePermission('FINANCE','EDIT'), async c=>{
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const action=normalizeText(b.action).toUpperCase();const user=c.get('erpUser').email;
  const request=await first(c.env.DB,`SELECT r.*,e.entity_code FROM erp_payment_requests r
    JOIN erp_legal_entities e ON e.id=r.entity_id WHERE r.id=?`,[id]);
  if(!request)return fail(c,'Payment request not found.',404);
  try{
    const permission=await permissionFor(c.env.DB,c.get('erpUser'),'FINANCE');
    if(['DEPARTMENT_APPROVE','FINANCE_VALIDATE','FINAL_APPROVE'].includes(action)&&!permission.can_approve){
      return fail(c,'Approval permission is required.',403);
    }
    if(action==='MARK_PAID'&&!permission.can_post)return fail(c,'Posting permission is required.',403);
    if(action==='SUBMIT'){
      if(request.status!=='DRAFT')throw new Error('Only a draft request can be submitted.');
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='SUBMITTED',updated_at=datetime('now') WHERE id=?`,[id]);
    }else if(action==='DEPARTMENT_APPROVE'){
      if(request.status!=='SUBMITTED')throw new Error('Request is not awaiting department approval.');
      if(request.requestor_email===user)throw new Error('The requester cannot approve the same request.');
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='DEPARTMENT_APPROVED',
        department_approved_by=?,department_approved_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[user,id]);
    }else if(action==='FINANCE_VALIDATE'){
      if(request.status!=='DEPARTMENT_APPROVED')throw new Error('Department approval is required first.');
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='FINANCE_VALIDATED',
        finance_validated_by=?,finance_validated_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[user,id]);
    }else if(action==='FINAL_APPROVE'){
      if(request.status!=='FINANCE_VALIDATED')throw new Error('Finance validation is required first.');
      if(request.requestor_email===user||request.finance_validated_by===user){
        throw new Error('Final approval must be performed by a different authorized user.');
      }
      let billId=request.supplier_bill_id;
      const advanceRequest=/ADVANCE|PREPAYMENT/.test(normalizeText(request.request_type).toUpperCase());
      if(!advanceRequest&&!normalizeText(request.supplier_invoice_no)){
        throw new Error('Supplier invoice number is required before final approval.');
      }
      if(normalizeText(request.supplier_invoice_no)){
        const duplicate=await first(c.env.DB,`SELECT id,request_no FROM erp_payment_requests
          WHERE id<>? AND payee_partner_id=? AND supplier_invoice_no=?
            AND status NOT IN ('REJECTED','CANCELLED','REVERSED') LIMIT 1`,[
          id,request.payee_partner_id,normalizeText(request.supplier_invoice_no),
        ]);
        if(duplicate)throw new Error(`Supplier invoice is already recorded in ${duplicate.request_no}.`);
      }
      let debitAccount=normalizeText(b.accountCode)||'6990';
      if(request.landed_cost_id)debitAccount='2060';
      else if(request.purchase_order_id){
        if(advanceRequest)debitAccount='1250';
        else{
          const received=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_receipts r
            JOIN erp_shipments s ON s.id=r.shipment_id
            JOIN erp_purchase_orders p ON p.purchase_order_no=s.purchase_order_ref
            WHERE p.id=?`,[request.purchase_order_id]);
          if(Number(received?.n||0)===0)throw new Error('Goods receipt is required before clearing the supplier invoice against GRNI. Use an advance request for prepayment.');
          debitAccount='2050';
        }
      }
      if(!billId&&request.payee_partner_id){
        const bill=await createSubledgerDocument(c.env.DB,{
          entityCode:request.entity_code,documentType:'SUPPLIER_BILL',partnerId:request.payee_partner_id,
          documentDate:request.invoice_date||request.request_date,dueDate:request.due_date,
          grossAmount:request.gross_amount,netAmount:round(request.gross_amount-request.vat_amount),
          taxAmount:request.vat_amount,withholdingAmount:request.withholding_amount,
          department:request.department,costCenter:request.cost_center,businessLine:'',
          sourceType:'PAYMENT_REQUEST',sourceId:id,sourceNo:request.request_no,
        },user);
        billId=bill.id;
        await postSubledgerDocument(c.env.DB,bill.id,{accountCode:debitAccount},user);
      }
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='APPROVED',
        final_approved_by=?,final_approved_at=datetime('now'),supplier_bill_id=?,
        updated_at=datetime('now') WHERE id=?`,[user,billId||null,id]);
    }else if(action==='MARK_PAID'){
      if(request.status!=='APPROVED')throw new Error('Only an approved request can be paid.');
      if(!b.bankAccountId||!normalizeText(b.paymentReference))throw new Error('Bank account and payment reference are required.');
      if(!request.payee_partner_id)throw new Error('A supplier master record is required before payment.');
      const supplierBill = request.supplier_bill_id ? await first(c.env.DB,
        `SELECT d.*,h.status journal_status FROM erp_subledger_documents d
          LEFT JOIN erp_journal_headers h ON h.id=d.journal_id WHERE d.id=?`,
        [request.supplier_bill_id]) : null;
      if (!supplierBill || supplierBill.journal_status !== 'POSTED') {
        throw new Error('Approve and post the supplier-bill journal before preparing payment.');
      }
      const bank=await first(c.env.DB,`SELECT b.*,a.account_code FROM erp_bank_accounts b
        JOIN erp_chart_accounts a ON a.id=b.gl_account_id WHERE b.id=?`,[Number(b.bankAccountId)]);
      if(!bank)throw new Error('Bank account not found.');
      const payment=await createSubledgerDocument(c.env.DB,{
        entityCode:request.entity_code,documentType:'SUPPLIER_PAYMENT',partnerId:request.payee_partner_id,
        documentDate:b.paymentDate||new Date().toISOString().slice(0,10),
        grossAmount:request.net_payable,netAmount:request.net_payable,taxAmount:0,withholdingAmount:0,
        department:request.department,costCenter:request.cost_center,sourceType:'PAYMENT_REQUEST',
        sourceId:id,sourceNo:request.request_no,
      },user);
      await postSubledgerDocument(c.env.DB,payment.id,{bankAccountCode:bank.account_code},user);
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='PAYMENT_PREPARED',bank_account_id=?,
        payment_document_id=?,payment_reference=?,
        updated_at=datetime('now') WHERE id=?`,[
        bank.id,payment.id,normalizeText(b.paymentReference),id,
      ]);
    }else if(action==='CONFIRM_PAID'){
      if(request.status!=='PAYMENT_PREPARED')throw new Error('Payment journal has not been prepared.');
      const payment=await first(c.env.DB,
        `SELECT d.*,h.status journal_status FROM erp_subledger_documents d
          LEFT JOIN erp_journal_headers h ON h.id=d.journal_id WHERE d.id=?`,
        [request.payment_document_id]);
      if(!payment||payment.journal_status!=='POSTED'){
        throw new Error('Approve and post the supplier-payment journal before confirming payment.');
      }
      // Proof of payment goes to Drive and is linked on the record before closing.
      if(Array.isArray(b.attachments)&&b.attachments.length){
        await saveAttachments(c.env,c.env.DB,{moduleCode:'FINANCE',recordType:'PAYMENT_REQUEST',
          recordId:id,recordNo:request.request_no,files:b.attachments,uploadedBy:user});
      }
      await run(c.env.DB,`INSERT INTO erp_rfp_proof_of_payment(rfp_ref,reference,paid_at,actor)
        VALUES(?,?,datetime('now'),?)`,[request.request_no,normalizeText(b.proofReference),user]);
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='PAID',paid_by=?,
        paid_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[user,id]);
    }else if(action==='RETURN'||action==='CANCEL'||action==='REJECT'){
      if(['PAID','REJECTED'].includes(request.status))throw new Error('This request can no longer be returned.');
      const reason=normalizeText(b.reason||b.notes)||'No reason given';
      await run(c.env.DB,`UPDATE erp_payment_requests SET status='REJECTED',updated_at=datetime('now') WHERE id=?`,[id]);
      await run(c.env.DB,`INSERT INTO erp_rfp_approvals(rfp_ref,stage,decision,actor,reason,amount)
        VALUES(?,?,?,?,?,?)`,[request.request_no,String(request.status),'RETURNED',user,reason,request.net_payable]);
      request.__returnReason=reason;
    }else return fail(c,'Unsupported payment-request action.');
    const after=await first(c.env.DB,`SELECT * FROM erp_payment_requests WHERE id=?`,[id]);
    // ---- e-signature trail ---------------------------------------------
    // Draw or type: DRAW arrives as a PNG data URL, TYPE as the signer's name.
    if(normalizeText(b.signature)){
      const stageMap={SUBMIT:'REQUESTOR',DEPARTMENT_APPROVE:'DEPARTMENT',FINANCE_VALIDATE:'FINANCE',
        FINAL_APPROVE:'FINAL',MARK_PAID:'PAYMENT',CONFIRM_PAID:'PROOF'};
      await run(c.env.DB,`INSERT INTO erp_rfp_approvals(rfp_ref,stage,decision,actor,actor_name,reason,signature,amount)
        VALUES(?,?,?,?,?,?,?,?)`,[request.request_no,stageMap[action]||action,'APPROVED',user,
        c.get('erpUser').display_name||user,normalizeText(b.notes),
        String(b.signature).slice(0,300000),after.net_payable]);
    }

    // ---- notifications -------------------------------------------------
    const dept=after.department||'';
    const requestor=[after.requestor_email];
    const deptHeads=await roleEmails(c.env.DB,c.env,['DEPT_HEAD','DEPT_MANAGER'],dept);
    const finance=await roleEmails(c.env.DB,c.env,['FINANCE'],'');
    const ceo=await roleEmails(c.env.DB,c.env,['CEO'],'');
    let notified=null;
    try{
      if(action==='SUBMIT'){
        notified=await notifyRfp(c,after,{to:normalizeText(b.departmentHeadEmail)?[normalizeText(b.departmentHeadEmail)]:deptHeads,cc:requestor,
          title:'Request for payment awaiting your approval',
          subject:`Approval needed: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:`${after.requestor_email} submitted a request for payment for your approval as Department Head. The supporting documents are linked below.`});
      }else if(action==='DEPARTMENT_APPROVE'){
        notified=await notifyRfp(c,after,{to:finance,cc:requestor,
          title:'Department approved - Finance review required',
          subject:`Finance review: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:`The Department Head approved this request. It is now with Finance for review.`});
      }else if(action==='FINANCE_VALIDATE'){
        notified=await notifyRfp(c,after,{to:ceo,cc:[...finance,...requestor],
          title:'Finance validated - CEO approval required',
          subject:`CEO approval: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:`Finance validated this request. It now needs final CEO approval.`});
      }else if(action==='FINAL_APPROVE'){
        notified=await notifyRfp(c,after,{to:finance,cc:[...requestor,...deptHeads],
          title:'CEO approved - ready for payment',
          subject:`Approved for payment: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:`The CEO gave final approval with all documents signed. Finance can now instruct the disbursing bank and upload the proof of payment.`});
      }else if(action==='MARK_PAID'&&normalizeText(b.bankInstructionEmail)){
        notified=await notifyRfp(c,after,{to:[normalizeText(b.bankInstructionEmail)],cc:finance,
          title:'Payment instruction',
          subject:`Payment instruction: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:normalizeText(b.message)||`Please process the payment below in favour of ${after.payee_name}.`,
          extraFacts:[['Payment reference',after.payment_reference]]});
      }else if(action==='CONFIRM_PAID'){
        notified=await notifyRfp(c,after,{to:requestor,cc:[...deptHeads,...finance],
          title:'Payment completed',
          subject:`Paid: ${after.request_no} · ${rfpMoney(after.net_payable)}`,
          intro:`Payment has been released and the proof of payment is attached below.`,
          extraFacts:[['Payment reference',after.payment_reference],['Proof reference',normalizeText(b.proofReference)]]});
      }else if(['RETURN','CANCEL','REJECT'].includes(action)){
        const audience=[...new Set([...requestor,...deptHeads,...finance])];
        notified=await notifyRfp(c,after,{to:audience,
          title:'Request for payment returned',
          subject:`Returned: ${after.request_no}`,
          intro:`${user} returned this request for payment.`,
          extraFacts:[['Reason',request.__returnReason||normalizeText(b.reason)]]});
      }
    }catch(mailError){notified={ok:false,error:String(mailError)};}
    await audit(c,{action,module:'FINANCE',recordType:'PAYMENT_REQUEST',recordId:id,
      recordNo:request.request_no,before:request,after:{...after,notified}});
    return ok(c,{request:after,notified});
  }catch(error){return fail(c,error.message,409);}
});

financeRoutes.get('/lease-billing', requirePermission('FINANCE','VIEW'), async c=>{
  const contracts=await all(c.env.DB,`SELECT lc.*,p.partner_code,p.name customer_name,
    COUNT(u.id) linked_units,COALESCE(SUM(u.daily_rate_vat_ex),0) daily_contract_value
    FROM erp_lease_contracts lc LEFT JOIN erp_partners p ON p.id=lc.customer_id
    LEFT JOIN erp_lease_contract_units u ON u.lease_contract_id=lc.id
    WHERE lc.status NOT IN ('TERMINATED','EXPIRED','VOIDED','REVERSED')
    GROUP BY lc.id ORDER BY lc.end_of_term,lc.lease_no`);
  const billings=await all(c.env.DB,`SELECT d.*,p.name partner_name FROM erp_subledger_documents d
    JOIN erp_partners p ON p.id=d.partner_id WHERE d.document_type='LEASE_BILLING'
    ORDER BY d.document_date DESC,d.id DESC LIMIT 1000`);
  return ok(c,{contracts,billings});
});

financeRoutes.post('/lease-billing/generate', requirePermission('FINANCE','CREATE'), async c=>{
  const b=await jsonBody(c);const id=Number(b.leaseContractId);
  const lease=await first(c.env.DB,`SELECT lc.*,p.name partner_name FROM erp_lease_contracts lc
    JOIN erp_partners p ON p.id=lc.customer_id WHERE lc.id=?`,[id]);
  if(!lease)return fail(c,'Lease contract not found.',404);
  const periodStart=b.periodStart;const periodEnd=b.periodEnd;
  if(!periodStart||!periodEnd)return fail(c,'Billing start and end dates are required.');
  const start=new Date(`${periodStart}T00:00:00Z`);const end=new Date(`${periodEnd}T00:00:00Z`);
  const days=Math.floor((end-start)/86400000)+1;
  if(!Number.isFinite(days)||days<=0)return fail(c,'Billing period is invalid.');
  const units=await all(c.env.DB,`SELECT * FROM erp_lease_contract_units WHERE lease_contract_id=?
    AND status NOT IN ('RETURNED','TERMINATED')`,[id]);
  const daily=units.length?units.reduce((sum,row)=>sum+Number(row.daily_rate_vat_ex||lease.daily_rate_vat_ex||0),0):
    Number(lease.daily_rate_vat_ex||0)*Number(lease.unit_count||0);
  const net=round(daily*days);const vat=round(net*0.12);const gross=round(net+vat);
  if(gross<=0)return fail(c,'The lease has no billable daily rate or active units.');
  const duplicate=await first(c.env.DB,`SELECT * FROM erp_subledger_documents
    WHERE document_type='LEASE_BILLING' AND source_type='LEASE_CONTRACT' AND source_id=?
      AND document_date=? AND due_date=?`,[id,periodStart,periodEnd]);
  if(duplicate)return fail(c,`${duplicate.document_no} already covers this billing period.`,409);
  const document=await createSubledgerDocument(c.env.DB,{
    entityCode:b.entityCode||'E88',documentType:'LEASE_BILLING',partnerId:lease.customer_id,
    documentDate:periodStart,dueDate:b.dueDate||periodEnd,grossAmount:gross,netAmount:net,
    taxAmount:vat,withholdingAmount:0,businessLine:'LEASE',sourceType:'LEASE_CONTRACT',
    sourceId:id,sourceNo:lease.lease_no,
  },c.get('erpUser').email);
  await postSubledgerDocument(c.env.DB,document.id,{accountCode:'4010'},c.get('erpUser').email);
  return ok(c,{documentNo:document.document_no,days,units:units.length,net,vat,gross},201);
});

financeRoutes.get('/bank-accounts', requirePermission('FINANCE', 'VIEW'), async c => {
  const rows = await all(c.env.DB,
    `SELECT b.*,e.entity_code,a.account_code,a.account_name,
      COALESCE((SELECT SUM(CASE WHEN t.direction='CREDIT' THEN t.amount ELSE -t.amount END)
        FROM erp_bank_transactions t WHERE t.bank_account_id=b.id),0)+b.opening_balance statement_balance,
      (SELECT COUNT(*) FROM erp_bank_transactions t WHERE t.bank_account_id=b.id AND t.status='UNMATCHED') unmatched
      FROM erp_bank_accounts b JOIN erp_legal_entities e ON e.id=b.entity_id
      JOIN erp_chart_accounts a ON a.id=b.gl_account_id ORDER BY b.bank_name,b.account_name`);
  return ok(c, { rows });
});

financeRoutes.get('/bank-transactions', requirePermission('FINANCE','VIEW'), async c=>{
  const bankAccountId=Number(c.req.query('bankAccountId')||0);
  const status=normalizeText(c.req.query('status')).toUpperCase();
  const rows=await all(c.env.DB,`SELECT t.*,b.bank_account_code,b.bank_name,b.account_name,
    h.journal_no,a.account_code
    FROM erp_bank_transactions t JOIN erp_bank_accounts b ON b.id=t.bank_account_id
    LEFT JOIN erp_journal_lines l ON l.id=t.matched_journal_line_id
    LEFT JOIN erp_journal_headers h ON h.id=l.journal_id
    LEFT JOIN erp_chart_accounts a ON a.id=l.account_id
    WHERE (?=0 OR t.bank_account_id=?) AND (?='' OR t.status=?)
    ORDER BY t.transaction_date DESC,t.id DESC LIMIT 3000`,[
    bankAccountId,bankAccountId,status,status,
  ]);
  return ok(c,{rows});
});

financeRoutes.post('/bank-accounts', requirePermission('FINANCE', 'MANAGE'), async c => {
  const b = await jsonBody(c);
  const entity = await entityByCode(c.env.DB, b.entityCode || 'E88');
  const account = await first(c.env.DB, `SELECT * FROM erp_chart_accounts WHERE account_code=?`, [b.glAccountCode || '1010']);
  if (!entity || !account) return fail(c, 'Entity or bank GL account not found.');
  const code = normalizeText(b.bankAccountCode);
  if (!code || !b.bankName || !b.accountName) return fail(c, 'Bank code, bank name and account name are required.');
  const inserted = await run(c.env.DB,
    `INSERT INTO erp_bank_accounts(
      bank_account_code,entity_id,bank_name,account_name,account_number_masked,currency,
      gl_account_id,opening_balance
    ) VALUES(?,?,?,?,?,?,?,?)`,
    [code, entity.id, normalizeText(b.bankName), normalizeText(b.accountName),
      normalizeText(b.accountNumberMasked), b.currency || 'PHP', account.id, numberValue(b.openingBalance)]);
  const openingBalance = numberValue(b.openingBalance);
  let openingJournalId = null;
  if (openingBalance > 0) {
    const event = await captureFinanceEvent(c.env.DB, {
      eventKey:`BANK_OPENING_BALANCE:${inserted.meta.last_row_id}`,
      eventType:'OPENING_BANK_BALANCE',
      sourceModule:'TREASURY',
      sourceType:'BANK_ACCOUNT',
      sourceId:inserted.meta.last_row_id,
      sourceNo:code,
      eventDate:b.openingDate || new Date().toISOString().slice(0, 10),
      entityCode:entity.entity_code,
      amount:openingBalance,
      description:`Opening balance ${code} ${normalizeText(b.bankName)}`,
      payload:{ grossAmount:openingBalance, bankAccountCode:account.account_code },
    }, c.get('erpUser').email);
    if (event.status === 'ERROR') return fail(c, event.error_message, 409);
    openingJournalId = event.journal_id;
  }
  return ok(c, { created:true, openingJournalId }, 201);
});

financeRoutes.post('/bank-transactions', requirePermission('FINANCE', 'CREATE'), async c => {
  const b = await jsonBody(c);
  const rows = Array.isArray(b.rows) ? b.rows : [b];
  let imported = 0;
  for (const row of rows) {
    if (!row.bankAccountId || !row.transactionDate || !row.direction || numberValue(row.amount) <= 0) continue;
    await run(c.env.DB,
      `INSERT OR IGNORE INTO erp_bank_transactions(
        bank_account_id,transaction_date,value_date,bank_reference,description,direction,
        amount,running_balance,import_batch
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
      [Number(row.bankAccountId), row.transactionDate, row.valueDate || '', normalizeText(row.bankReference),
        normalizeText(row.description), normalizeText(row.direction).toUpperCase(), numberValue(row.amount),
        row.runningBalance === undefined ? null : numberValue(row.runningBalance), normalizeText(b.importBatch)]);
    imported += 1;
  }
  return ok(c, { imported }, 201);
});

financeRoutes.post('/bank-transactions/:id/match', requirePermission('FINANCE', 'POST'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  const transaction = await first(c.env.DB,
    `SELECT t.*,b.gl_account_id FROM erp_bank_transactions t
      JOIN erp_bank_accounts b ON b.id=t.bank_account_id WHERE t.id=?`, [id]);
  const line = await first(c.env.DB,
    `SELECT l.*,h.status journal_status FROM erp_journal_lines l
      JOIN erp_journal_headers h ON h.id=l.journal_id
      WHERE l.id=?`, [Number(b.journalLineId)]);
  if (!transaction || !line) return fail(c, 'Bank transaction or journal line not found.', 404);
  if (transaction.status !== 'UNMATCHED') return fail(c, 'Only an unmatched bank transaction can be matched.', 409);
  if (line.journal_status !== 'POSTED' || Number(line.account_id) !== Number(transaction.gl_account_id)) {
    return fail(c, 'Match only to a posted journal line for the same bank GL account.', 409);
  }
  const existingMatch = await first(c.env.DB,
    `SELECT id FROM erp_bank_transactions WHERE matched_journal_line_id=? AND id<>?`, [line.id, id]);
  if (existingMatch) return fail(c, 'That journal line is already matched to another bank transaction.', 409);
  const lineAmount = Math.max(Number(line.base_debit || 0), Number(line.base_credit || 0));
  if (Math.abs(lineAmount - Number(transaction.amount || 0)) > 0.01) return fail(c, 'Bank amount does not match the journal line.', 409);
  await run(c.env.DB,
    `UPDATE erp_bank_transactions SET status='MATCHED',matched_journal_line_id=?,
      matched_by=?,matched_at=datetime('now') WHERE id=?`,
    [line.id, c.get('erpUser').email, id]);
  return ok(c, { matched:true });
});

financeRoutes.get('/bank-reconciliations', requirePermission('FINANCE', 'VIEW'), async c => {
  const rows = await all(c.env.DB,
    `SELECT r.*,b.bank_account_code,b.bank_name,b.account_name,e.entity_code
      FROM erp_bank_reconciliations r
      JOIN erp_bank_accounts b ON b.id=r.bank_account_id
      JOIN erp_legal_entities e ON e.id=b.entity_id
      ORDER BY r.statement_date DESC,r.id DESC LIMIT 1000`);
  return ok(c, { rows });
});

financeRoutes.post('/bank-reconciliations', requirePermission('FINANCE', 'CREATE'), async c => {
  const b = await jsonBody(c);
  const bank = await first(c.env.DB,
    `SELECT b.*,e.entity_code FROM erp_bank_accounts b
      JOIN erp_legal_entities e ON e.id=b.entity_id WHERE b.id=? AND b.active=1`,
    [Number(b.bankAccountId)]);
  if (!bank || !b.statementDate) return fail(c, 'Bank account and statement date are required.');
  const existing = await first(c.env.DB,
    `SELECT reconciliation_no FROM erp_bank_reconciliations
      WHERE bank_account_id=? AND statement_date=? AND status<>'REJECTED'`,
    [bank.id, b.statementDate]);
  if (existing) return fail(c, `${existing.reconciliation_no} already covers this statement date.`, 409);
  const book = await first(c.env.DB,
    `SELECT ?+COALESCE(SUM(l.base_debit-l.base_credit),0) balance
      FROM erp_journal_lines l
      JOIN erp_journal_headers h ON h.id=l.journal_id
      WHERE h.status='POSTED' AND h.entity_id=? AND h.journal_date<=? AND l.account_id=?`,
    [Number(bank.opening_balance || 0), bank.entity_id, b.statementDate, bank.gl_account_id]);
  const unmatched = await first(c.env.DB,
    `SELECT
      COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0) deposits,
      COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE 0 END),0) payments
      FROM erp_bank_transactions
      WHERE bank_account_id=? AND transaction_date<=? AND status='UNMATCHED'`,
    [bank.id, b.statementDate]);
  const statement = numberValue(b.statementEndingBalance);
  const bookBalance = round(Number(book?.balance || 0));
  const adjustments = numberValue(b.adjustments);
  const difference = round(statement - bookBalance - adjustments);
  const reconciliationNo = await nextCode(c.env.DB, 'BANK_RECON', 'BR', 8);
  const inserted = await run(c.env.DB,
    `INSERT INTO erp_bank_reconciliations(
      reconciliation_no,bank_account_id,statement_date,statement_ending_balance,
      book_ending_balance,outstanding_deposits,outstanding_payments,adjustments,difference,
      status,notes,prepared_by
    ) VALUES(?,?,?,?,?,?,?,?,?,'SUBMITTED',?,?)`,
    [reconciliationNo, bank.id, b.statementDate, statement, bookBalance,
      round(unmatched?.deposits), round(unmatched?.payments), adjustments, difference,
      normalizeText(b.notes), c.get('erpUser').email]);
  return ok(c, {
    id:inserted.meta.last_row_id, reconciliationNo, difference,
    status:'SUBMITTED',
  }, 201);
});

financeRoutes.post('/bank-reconciliations/:id/decision', requirePermission('FINANCE', 'APPROVE'), async c => {
  const id = Number(c.req.param('id')); const b = await jsonBody(c);
  const decision = normalizeText(b.decision).toUpperCase();
  const row = await first(c.env.DB, `SELECT * FROM erp_bank_reconciliations WHERE id=?`, [id]);
  if (!row) return fail(c, 'Bank reconciliation not found.', 404);
  if (row.status !== 'SUBMITTED') return fail(c, 'Only a submitted reconciliation can be decided.', 409);
  if (row.prepared_by === c.get('erpUser').email) return fail(c, 'The preparer cannot approve the same reconciliation.', 409);
  if (decision === 'APPROVE' && Math.abs(Number(row.difference || 0)) > 0.01) {
    return fail(c, 'Resolve the reconciliation difference before approval.', 409);
  }
  if (!['APPROVE','REJECT'].includes(decision)) return fail(c, 'Decision must be APPROVE or REJECT.');
  await run(c.env.DB,
    `UPDATE erp_bank_reconciliations
      SET status=?,approved_by=?,approved_at=datetime('now'),review_notes=?
      WHERE id=?`,
    [decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', c.get('erpUser').email,
      normalizeText(b.notes), id]);
  return ok(c, { status:decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' });
});

financeRoutes.get('/fixed-assets', requirePermission('FINANCE', 'VIEW'), async c => {
  const rows = await all(c.env.DB,
    `SELECT f.*,e.entity_code,a.asset_no,a.serial_no,a.item_code,a.item_name,a.category,
      a.current_location_code,a.current_status
      FROM erp_fixed_asset_books f JOIN erp_assets a ON a.id=f.asset_id
      JOIN erp_legal_entities e ON e.id=f.entity_id
      ORDER BY f.asset_class,a.item_name,a.serial_no`);
  const candidates = await all(c.env.DB,
    `SELECT a.* FROM erp_assets a WHERE a.active=1 AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)
      ORDER BY a.category,a.item_name,a.serial_no LIMIT 5000`);
  const runs=await all(c.env.DB,`SELECT r.*,e.entity_code,p.period_name,h.journal_no
    FROM erp_depreciation_runs r JOIN erp_legal_entities e ON e.id=r.entity_id
    JOIN erp_accounting_periods p ON p.id=r.period_id
    LEFT JOIN erp_journal_headers h ON h.id=r.journal_id
    ORDER BY r.run_date DESC,r.id DESC LIMIT 500`);
  return ok(c, { rows, candidates, runs });
});

financeRoutes.post('/fixed-assets/capitalize', requirePermission('FINANCE', 'POST'), async c => {
  const b = await jsonBody(c);
  const entity = await entityByCode(c.env.DB, b.entityCode || 'E88');
  const asset = await first(c.env.DB, `SELECT * FROM erp_assets WHERE id=? AND active=1`, [Number(b.assetId)]);
  if (!entity || !asset) return fail(c, 'Entity or inventory asset not found.', 404);
  const existing=await first(c.env.DB,`SELECT * FROM erp_fixed_asset_books WHERE asset_id=? AND status<>'REVERSED'`,[asset.id]);
  if(existing)return fail(c,`Asset is already registered in fixed assets with status ${existing.status}.`,409);
  const cost = numberValue(b.acquisitionCost, asset.unit_cost);
  const life = Number(b.usefulLifeMonths || (asset.category==='BSS'?60:36));
  if (cost <= 0 || life <= 0) return fail(c, 'An approved cost and useful life are required before capitalization.');
  const classAccounts=fixedAssetAccountsForCategory(asset.category);
  const assetAccountCode = b.assetAccountCode || classAccounts.assetAccountCode;
  const date=b.capitalizationDate || new Date().toISOString().slice(0, 10);
  const event = await captureFinanceEvent(c.env.DB, {
    eventKey:`FIXED_ASSET_CAPITALIZATION:${asset.id}:${date}`,
    eventType:'CAPITALIZATION',sourceModule:'FIXED_ASSETS',sourceType:'ASSET',sourceId:asset.id,
    sourceNo:asset.asset_no,eventDate:date,entityCode:entity.entity_code,
    department:b.department || '',costCenter:b.costCenter || '',businessLine:b.businessLine || 'LEASE',
    amount:cost,description:`Capitalize ${asset.asset_no} / ${asset.serial_no}`,
    payload:{costAmount:cost,assetAccountCode,
      inventoryAccountCode:inventoryAccountForCategory(asset.category),
      assetId:asset.id,serialNo:asset.serial_no,itemId:asset.item_id,category:asset.category},
  }, c.get('erpUser').email);
  if (event.status === 'ERROR') return fail(c, event.error_message, 409);
  const book=await registerPendingFixedAsset(c.env.DB,{
    assetId:asset.id,entityCode:entity.entity_code,assetClass:b.assetClass||classAccounts.assetClass,
    capitalizationDate:date,acquisitionCost:cost,residualValue:numberValue(b.residualValue),
    usefulLifeMonths:life,depreciationMethod:b.depreciationMethod||'STRAIGHT_LINE',assetAccountCode,
    accumulatedDepreciationAccountCode:b.accumulatedDepreciationAccountCode||classAccounts.accumulatedDepreciationAccountCode,
    depreciationExpenseAccountCode:b.depreciationExpenseAccountCode||classAccounts.depreciationExpenseAccountCode,
    capitalizationEventId:event.id,capitalizationJournalId:event.journal_id,
  },c.get('erpUser').email);
  return ok(c,{capitalized:false,pendingApproval:true,bookId:book.id,journalId:event.journal_id},201);
});

financeRoutes.post('/depreciation-runs', requirePermission('FINANCE', 'CREATE'), async c => {
  const b = await jsonBody(c);
  const entity = await entityByCode(c.env.DB, b.entityCode || 'E88');
  if (!entity) return fail(c, 'Entity not found.', 404);
  const period = await ensureAccountingPeriod(c.env.DB, entity.id, b.runDate);
  if (period.status === 'CLOSED') return fail(c, 'The accounting period is closed.', 409);
  const existing = await first(c.env.DB, `SELECT * FROM erp_depreciation_runs WHERE entity_id=? AND period_id=?`, [entity.id, period.id]);
  if (existing) return fail(c, `${existing.run_no} already covers this period.`, 409);
  const assets = await all(c.env.DB,
    `SELECT * FROM erp_fixed_asset_books WHERE entity_id=? AND status='ACTIVE'
      AND capitalization_date<=? AND net_book_value>residual_value`, [entity.id, period.end_date]);
  const runNo = await nextCode(c.env.DB, 'DEPRECIATION_RUN', 'DEP', 8);
  const inserted = await run(c.env.DB,
    `INSERT INTO erp_depreciation_runs(run_no,entity_id,period_id,run_date,created_by)
      VALUES(?,?,?,?,?)`, [runNo, entity.id, period.id, b.runDate || period.end_date, c.get('erpUser').email]);
  let total = 0;
  for (const asset of assets) {
    const monthly = round((Number(asset.acquisition_cost) - Number(asset.residual_value)) / Number(asset.useful_life_months));
    const amount = Math.min(monthly, round(Number(asset.net_book_value) - Number(asset.residual_value)));
    if (amount <= 0) continue;
    total = round(total + amount);
    await run(c.env.DB,
      `INSERT INTO erp_depreciation_lines(
        depreciation_run_id,fixed_asset_book_id,asset_id,depreciation_amount,
        accumulated_after,net_book_value_after
      ) VALUES(?,?,?,?,?,?)`,
      [inserted.meta.last_row_id, asset.id, asset.asset_id, amount,
        round(Number(asset.accumulated_depreciation) + amount), round(Number(asset.net_book_value) - amount)]);
  }
  await run(c.env.DB, `UPDATE erp_depreciation_runs SET total_depreciation=? WHERE id=?`,
    [total, inserted.meta.last_row_id]);
  return ok(c, { id:inserted.meta.last_row_id, runNo, assets:assets.length, total }, 201);
});

financeRoutes.post('/depreciation-runs/:id/approve', requirePermission('FINANCE', 'APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const runHeader = await first(c.env.DB, `SELECT * FROM erp_depreciation_runs WHERE id=?`, [id]);
  if (!runHeader) return fail(c, 'Depreciation run not found.', 404);
  if (runHeader.status !== 'DRAFT') return fail(c, 'Only a draft run can be approved.', 409);
  if (runHeader.created_by === c.get('erpUser').email) return fail(c, 'The preparer cannot approve the same depreciation run.', 409);
  await run(c.env.DB,
    `UPDATE erp_depreciation_runs SET status='APPROVED',approved_by=?,approved_at=datetime('now') WHERE id=?`,
    [c.get('erpUser').email, id]);
  return ok(c, { status:'APPROVED' });
});

financeRoutes.post('/depreciation-runs/:id/post', requirePermission('FINANCE', 'POST'), async c => {
  const id = Number(c.req.param('id'));
  const header = await first(c.env.DB,
    `SELECT r.*,e.entity_code,p.end_date FROM erp_depreciation_runs r
      JOIN erp_legal_entities e ON e.id=r.entity_id
      JOIN erp_accounting_periods p ON p.id=r.period_id WHERE r.id=?`, [id]);
  if (!header) return fail(c, 'Depreciation run not found.', 404);
  if (header.status !== 'APPROVED') return fail(c, 'Only an approved run can be posted.', 409);
  const event = await captureFinanceEvent(c.env.DB, {
    eventKey:`DEPRECIATION:${id}`, eventType:'DEPRECIATION', sourceModule:'FINANCE',
    sourceType:'DEPRECIATION_RUN', sourceId:id, sourceNo:header.run_no, eventDate:header.end_date,
    entityCode:header.entity_code, amount:header.total_depreciation,
    description:`Depreciation ${header.run_no}`,
  }, c.get('erpUser').email);
  if (event.status === 'ERROR') return fail(c, event.error_message, 409);
  const journal = await first(c.env.DB, `SELECT * FROM erp_journal_headers WHERE id=?`, [event.journal_id]);
  await run(c.env.DB, `UPDATE erp_journal_headers SET status='APPROVED',approved_by=?,
    approved_at=datetime('now') WHERE id=?`, [header.approved_by, journal.id]);
  await postJournal(c.env.DB, journal.id, c.get('erpUser').email);
  const lines = await all(c.env.DB, `SELECT * FROM erp_depreciation_lines WHERE depreciation_run_id=?`, [id]);
  for (const line of lines) {
    await run(c.env.DB,
      `UPDATE erp_fixed_asset_books SET accumulated_depreciation=?,net_book_value=?,
        last_depreciation_date=? WHERE id=?`,
      [line.accumulated_after, line.net_book_value_after, header.end_date, line.fixed_asset_book_id]);
  }
  await run(c.env.DB,
    `UPDATE erp_depreciation_runs SET status='POSTED',journal_id=?,posted_by=?,
      posted_at=datetime('now') WHERE id=?`,
    [journal.id, c.get('erpUser').email, id]);
  return ok(c, { status:'POSTED', journalNo:journal.journal_no });
});

financeRoutes.get('/reports/general-ledger', requirePermission('FINANCE', 'VIEW'), async c => {
  const f = filters(c);
  const rows = await all(c.env.DB,
    `SELECT h.journal_no,h.journal_date,h.source_type,h.source_no,h.description,
      a.account_code,a.account_name,p.name partner_name,l.department,l.cost_center,l.business_line,
      l.description line_description,l.base_debit debit,l.base_credit credit,l.serial_no
      FROM erp_journal_headers h JOIN erp_legal_entities e ON e.id=h.entity_id
      JOIN erp_journal_lines l ON l.journal_id=h.id JOIN erp_chart_accounts a ON a.id=l.account_id
      LEFT JOIN erp_partners p ON p.id=l.partner_id
      WHERE h.status='POSTED' AND ${f.where.join(' AND ')}
      ORDER BY h.journal_date,h.journal_no,l.line_no`, f.args);
  return ok(c, { filters:f, rows });
});

financeRoutes.get('/reports/trial-balance', requirePermission('FINANCE', 'VIEW'), async c => {
  const f = filters(c);
  const rows = await all(c.env.DB,
    `SELECT a.account_code,a.account_name,a.account_type,a.normal_balance,
      ROUND(COALESCE(SUM(l.base_debit),0),2) debit,
      ROUND(COALESCE(SUM(l.base_credit),0),2) credit,
      ROUND(COALESCE(SUM(CASE WHEN a.normal_balance='DEBIT'
        THEN l.base_debit-l.base_credit ELSE l.base_credit-l.base_debit END),0),2) balance
      FROM erp_chart_accounts a
      LEFT JOIN erp_journal_lines l ON l.account_id=a.id
      LEFT JOIN erp_journal_headers h ON h.id=l.journal_id AND h.status='POSTED'
      LEFT JOIN erp_legal_entities e ON e.id=h.entity_id
      WHERE a.active=1 AND (h.id IS NULL OR (${f.where.join(' AND ')}))
      GROUP BY a.id ORDER BY a.account_code`, f.args);
  const totals = rows.reduce((out, row) => {
    out.debit = round(out.debit + Number(row.debit || 0));
    out.credit = round(out.credit + Number(row.credit || 0));
    return out;
  }, { debit:0, credit:0 });
  return ok(c, { filters:f, rows, totals, balanced:Math.abs(totals.debit - totals.credit) <= 0.005 });
});

financeRoutes.get('/reports/financial-statements', requirePermission('FINANCE', 'VIEW'), async c => {
  const f = filters(c);
  const profitLossRows = await all(c.env.DB,
    `SELECT a.account_code,a.account_name,a.account_type,a.financial_statement,a.normal_balance,
      ROUND(COALESCE(SUM(CASE WHEN a.normal_balance='DEBIT'
        THEN l.base_debit-l.base_credit ELSE l.base_credit-l.base_debit END),0),2) balance
      FROM erp_chart_accounts a
      JOIN erp_journal_lines l ON l.account_id=a.id
      JOIN erp_journal_headers h ON h.id=l.journal_id
      JOIN erp_legal_entities e ON e.id=h.entity_id
      WHERE h.status='POSTED' AND a.account_type IN ('REVENUE','COGS','EXPENSE')
        AND ${f.where.join(' AND ')}
      GROUP BY a.id HAVING ABS(balance)>0.004 ORDER BY a.account_code`, f.args);
  const balanceWhere = ['e.entity_code=?', 'h.journal_date<=?'];
  const balanceArgs = [f.entity, f.dateTo];
  if (f.department) { balanceWhere.push('l.department=?'); balanceArgs.push(f.department); }
  if (f.costCenter) { balanceWhere.push('l.cost_center=?'); balanceArgs.push(f.costCenter); }
  if (f.businessLine) { balanceWhere.push('l.business_line=?'); balanceArgs.push(f.businessLine); }
  const balanceRows = await all(c.env.DB,
    `SELECT a.account_code,a.account_name,a.account_type,a.financial_statement,a.normal_balance,
      ROUND(COALESCE(SUM(CASE WHEN a.normal_balance='DEBIT'
        THEN l.base_debit-l.base_credit ELSE l.base_credit-l.base_debit END),0),2) balance
      FROM erp_chart_accounts a
      JOIN erp_journal_lines l ON l.account_id=a.id
      JOIN erp_journal_headers h ON h.id=l.journal_id
      JOIN erp_legal_entities e ON e.id=h.entity_id
      WHERE h.status='POSTED' AND ${balanceWhere.join(' AND ')}
      GROUP BY a.id HAVING ABS(balance)>0.004 ORDER BY a.account_code`, balanceArgs);
  const pnl = { revenue:0, cogs:0, operatingExpenses:0, netIncome:0 };
  const balanceSheet = { assets:0, liabilities:0, equity:0, currentYearEarnings:0, balanced:false };
  for (const row of profitLossRows) {
    const value = Number(row.balance || 0);
    if (row.account_type === 'REVENUE') pnl.revenue += value;
    else if (row.account_type === 'COGS') pnl.cogs += value;
    else if (row.account_type === 'EXPENSE') pnl.operatingExpenses += value;
  }
  let earningsToDate = 0;
  for (const row of balanceRows) {
    const value = Number(row.balance || 0);
    if (['ASSET','CONTRA_ASSET'].includes(row.account_type)) {
      balanceSheet.assets += row.account_type === 'CONTRA_ASSET' ? -value : value;
    } else if (row.account_type === 'LIABILITY') balanceSheet.liabilities += value;
    else if (row.account_type === 'EQUITY') balanceSheet.equity += value;
    else if (row.account_type === 'REVENUE') earningsToDate += value;
    else if (['COGS','EXPENSE'].includes(row.account_type)) earningsToDate -= value;
  }
  pnl.revenue = round(pnl.revenue); pnl.cogs = round(pnl.cogs);
  pnl.grossProfit = round(pnl.revenue - pnl.cogs);
  pnl.operatingExpenses = round(pnl.operatingExpenses);
  pnl.netIncome = round(pnl.grossProfit - pnl.operatingExpenses);
  balanceSheet.assets = round(balanceSheet.assets);
  balanceSheet.liabilities = round(balanceSheet.liabilities);
  balanceSheet.equity = round(balanceSheet.equity);
  balanceSheet.currentYearEarnings = round(earningsToDate);
  balanceSheet.totalLiabilitiesEquity = round(balanceSheet.liabilities + balanceSheet.equity + earningsToDate);
  balanceSheet.difference = round(balanceSheet.assets - balanceSheet.totalLiabilitiesEquity);
  balanceSheet.balanced = Math.abs(balanceSheet.difference) <= 0.01;
  const cashFlow = await all(c.env.DB,
    `SELECT COALESCE(a.cash_flow_group,'UNCLASSIFIED') cash_flow_group,
      ROUND(SUM(l.base_debit-l.base_credit),2) net_change
      FROM erp_journal_headers h JOIN erp_legal_entities e ON e.id=h.entity_id
      JOIN erp_journal_lines l ON l.journal_id=h.id JOIN erp_chart_accounts a ON a.id=l.account_id
      WHERE h.status='POSTED' AND a.control_type='BANK' AND ${f.where.join(' AND ')}
      GROUP BY a.cash_flow_group ORDER BY a.cash_flow_group`, f.args);
  return ok(c, { filters:f, accounts:profitLossRows, balanceAccounts:balanceRows, pnl, balanceSheet, cashFlow });
});

financeRoutes.get('/reports/tax-summary', requirePermission('FINANCE', 'VIEW'), async c => {
  const f = filters(c);
  const rows = await all(c.env.DB,
    `SELECT a.account_code,a.account_name,
      ROUND(SUM(l.base_debit),2) debit,ROUND(SUM(l.base_credit),2) credit,
      ROUND(SUM(l.base_debit-l.base_credit),2) net
      FROM erp_journal_headers h JOIN erp_legal_entities e ON e.id=h.entity_id
      JOIN erp_journal_lines l ON l.journal_id=h.id JOIN erp_chart_accounts a ON a.id=l.account_id
      WHERE h.status='POSTED' AND a.control_type='TAX' AND ${f.where.join(' AND ')}
      GROUP BY a.id ORDER BY a.account_code`, f.args);
  return ok(c, { filters:f, rows });
});

financeRoutes.get('/reports/inventory-reconciliation', requirePermission('FINANCE', 'VIEW'), async c => {
  const summary = await first(c.env.DB, `SELECT * FROM vw_erp_inventory_gl_reconciliation`);
  const byCategory = await all(c.env.DB,`
    SELECT class_code category,class_name,account_code,cogs_account_code,units,valued_units,unvalued_units,
      subledger_value,gl_value,difference,
      CASE WHEN ABS(difference)<=0.01 THEN 'RECONCILED' ELSE 'REVIEW_REQUIRED' END status
    FROM vw_erp_inventory_class_reconciliation
    ORDER BY CASE class_code WHEN 'MC' THEN 1 WHEN 'BAT' THEN 2 WHEN 'BSS' THEN 3 WHEN 'CHG' THEN 4 WHEN 'SP' THEN 5 ELSE 6 END`);
  const sourceEvents = await all(c.env.DB,
    `SELECT status,event_type,COUNT(*) events,ROUND(SUM(amount),2) amount
      FROM erp_finance_source_events
      WHERE event_type IN ('GOODS_RECEIPT','LANDED_COST','SALE_COGS','SALES_RETURN_INVENTORY','CAPITALIZATION',
        'INVENTORY_CONSUMPTION','WARRANTY_ISSUE','DONATION_ISSUE','INVENTORY_VALUATION_ADJUSTMENT',
        'INVENTORY_WRITE_OFF','CYCLE_COUNT_ADJUSTMENT')
      GROUP BY status,event_type ORDER BY status,event_type`);
  const difference = round(Number(summary?.inventory_subledger || 0) - Number(summary?.inventory_general_ledger || 0));
  // Reconciliation is judged PER CLASS against its own control account. A netted
  // total can hide an offsetting break (one class over, another under), so the
  // headline flag requires EVERY class to reconcile on its own.
  const reviewClasses = byCategory.filter(x => x.status !== 'RECONCILED');
  const reconciled = byCategory.length > 0 && reviewClasses.length === 0;
  return ok(c, {
    summary: {
      ...summary,
      netDifference: difference,
      reconciled,
      classesNeedingReview: reviewClasses.map(x => x.category),
    },
    byCategory, sourceEvents,
  });
});

financeRoutes.get('/reports/budget-actual', requirePermission('FINANCE', 'VIEW'), async c => {
  const year = Number(c.req.query('year') || new Date().getFullYear());
  const budget = await all(c.env.DB,
    `SELECT department,COALESCE(cost_center,'') cost_center,account_title,
      SUM(amount) budget_amount FROM erp_budget_plan WHERE year=?
      GROUP BY department,cost_center,account_title`, [year]);
  const actual = await all(c.env.DB,
    `SELECT l.department,COALESCE(l.cost_center,'') cost_center,a.account_name account_title,
      SUM(l.base_debit-l.base_credit) actual_amount
      FROM erp_journal_headers h JOIN erp_journal_lines l ON l.journal_id=h.id
      JOIN erp_chart_accounts a ON a.id=l.account_id
      WHERE h.status='POSTED' AND strftime('%Y',h.journal_date)=? AND a.account_type IN ('COGS','EXPENSE')
      GROUP BY l.department,l.cost_center,a.account_name`, [String(year)]);
  const key = row => `${row.department || ''}|${row.cost_center || ''}|${row.account_title || ''}`;
  const map = new Map();
  for (const row of budget) map.set(key(row), { ...row, actual_amount:0 });
  for (const row of actual) {
    const k = key(row);
    if (!map.has(k)) map.set(k, { ...row, budget_amount:0 });
    map.get(k).actual_amount = Number(row.actual_amount || 0);
  }
  const rows = [...map.values()].map(row => ({
    ...row, variance:round(Number(row.budget_amount || 0) - Number(row.actual_amount || 0)),
    utilizationPct:Number(row.budget_amount || 0)
      ? round(Number(row.actual_amount || 0) / Number(row.budget_amount || 0) * 100) : 0,
  })).sort((a, b) => String(a.department).localeCompare(String(b.department))
    || String(a.account_title).localeCompare(String(b.account_title)));
  return ok(c, { year, rows });
});


/* ===================================================================
 * Cash advance liquidation
 * A liquidation can only be opened against a Cash Advance RFP that is
 * fully approved (APPROVED / PAYMENT_PREPARED / PAID). The requestor adds
 * one line per expense with a receipt, the system totals them and shows the
 * variance against the advance, then Finance reviews.
 * =================================================================== */
async function rfpExtras(db,requestNo){
  const row=await first(db,`SELECT value FROM erp_rfp_settings WHERE key=?`,['rfp_doc:'+requestNo]);
  try{return row&&row.value?JSON.parse(row.value):{};}catch(e){return {};}
}
function liquidatable(status){
  return ['APPROVED','PAYMENT_PREPARED','PAID'].includes(String(status||'').toUpperCase());
}

// Cash-advance RFPs the signed-in user may liquidate.
financeRoutes.get('/liquidations/eligible', requirePermission('FINANCE','VIEW'), async c=>{
  const user=c.get('erpUser');
  const rows=await all(c.env.DB,`SELECT r.* FROM erp_payment_requests r
    WHERE r.requestor_email=? AND r.status IN ('APPROVED','PAYMENT_PREPARED','PAID')
    ORDER BY r.request_date DESC LIMIT 200`,[user.email]);
  const eligible=[];
  for(const row of rows){
    const extras=await rfpExtras(c.env.DB,row.request_no);
    const isAdvance=Number(extras.cashAdvance||0)===1||/ADVANCE/i.test(String(row.request_type||''));
    if(!isAdvance)continue;
    const existing=await first(c.env.DB,`SELECT id,liquidation_no,status FROM erp_rfp_liquidations WHERE payment_request_id=?`,[row.id]);
    eligible.push({id:row.id,requestNo:row.request_no,requestDate:row.request_date,purpose:row.purpose,
      amount:row.net_payable,status:row.status,liquidation:existing||null});
  }
  return ok(c,{rows:eligible});
});

financeRoutes.get('/liquidations', requirePermission('FINANCE','VIEW'), async c=>{
  const vis=await rfpVisibility(c);
  const where=vis.level==='ALL'?'':' WHERE l.requestor_email=?';
  const args=vis.level==='ALL'?[]:[c.get('erpUser').email];
  const rows=await all(c.env.DB,`SELECT l.*,r.purpose,r.department FROM erp_rfp_liquidations l
    LEFT JOIN erp_payment_requests r ON r.id=l.payment_request_id${where}
    ORDER BY l.id DESC LIMIT 300`,args);
  return ok(c,{rows});
});

financeRoutes.get('/liquidations/:id', requirePermission('FINANCE','VIEW'), async c=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE id=?`,[id]);
  if(!header)return fail(c,'Liquidation not found.',404);
  const user=c.get('erpUser');
  const role=String(user.role_code||'').toUpperCase();
  if(header.requestor_email!==user.email&&!['FINANCE','CEO'].includes(role))return fail(c,'You can only open your own liquidation.',403);
  const items=await all(c.env.DB,`SELECT * FROM erp_rfp_liquidation_items WHERE liquidation_id=? ORDER BY line_no`,[id]);
  const attachments=await attachmentsFor(c.env.DB,'LIQUIDATION',id,header.liquidation_no);
  return ok(c,{header,items,attachments});
});

// Open (or reopen) a liquidation for an approved cash advance.
financeRoutes.post('/liquidations', requirePermission('FINANCE','CREATE'), async c=>{
  const b=await jsonBody(c);
  const rfp=await first(c.env.DB,`SELECT * FROM erp_payment_requests WHERE id=?`,[Number(b.paymentRequestId)]);
  if(!rfp)return fail(c,'Select the cash-advance RFP to liquidate.',404);
  const user=c.get('erpUser');
  if(rfp.requestor_email!==user.email)return fail(c,'Only the requestor can liquidate their own cash advance.',403);
  const extras=await rfpExtras(c.env.DB,rfp.request_no);
  const isAdvance=Number(extras.cashAdvance||0)===1||/ADVANCE/i.test(String(rfp.request_type||''));
  if(!isAdvance)return fail(c,'This request is not tagged as a Cash Advance.',409);
  if(!liquidatable(rfp.status))return fail(c,'The cash advance must be fully approved before it can be liquidated.',409);
  const existing=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE payment_request_id=?`,[rfp.id]);
  if(existing)return ok(c,{id:existing.id,liquidationNo:existing.liquidation_no,reused:true});
  const no=await nextCode(c.env.DB,'LIQUIDATION','LIQ',6);
  const inserted=await run(c.env.DB,`INSERT INTO erp_rfp_liquidations(liquidation_no,payment_request_id,request_no,
    requestor_email,advance_amount,spent_amount,variance,status) VALUES(?,?,?,?,?,0,?, 'DRAFT')`,
    [no,rfp.id,rfp.request_no,user.email,rfp.net_payable,rfp.net_payable]);
  await audit(c,{action:'CREATE',module:'FINANCE',recordType:'LIQUIDATION',recordId:inserted.meta.last_row_id,recordNo:no,after:{rfp:rfp.request_no}});
  return ok(c,{id:inserted.meta.last_row_id,liquidationNo:no},201);
});

// Replace all lines and (optionally) attach receipts.
financeRoutes.post('/liquidations/:id/lines', requirePermission('FINANCE','CREATE'), async c=>{
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const header=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE id=?`,[id]);
  if(!header)return fail(c,'Liquidation not found.',404);
  const user=c.get('erpUser');
  if(header.requestor_email!==user.email)return fail(c,'Only the requestor can edit this liquidation.',403);
  if(header.status!=='DRAFT')return fail(c,'This liquidation has already been submitted.',409);
  const lines=(Array.isArray(b.lines)?b.lines:[]).filter(x=>numberValue(x.amount)>0);
  await run(c.env.DB,`DELETE FROM erp_rfp_liquidation_items WHERE liquidation_id=?`,[id]);
  let lineNo=0,spent=0;
  for(const line of lines){
    lineNo+=1;spent+=numberValue(line.amount);
    await run(c.env.DB,`INSERT INTO erp_rfp_liquidation_items(liquidation_id,line_no,expense_date,particulars,amount,receipt_no)
      VALUES(?,?,?,?,?,?)`,[id,lineNo,normalizeText(line.expenseDate),normalizeText(line.particulars),numberValue(line.amount),normalizeText(line.receiptNo)]);
  }
  spent=round(spent);
  const variance=round(Number(header.advance_amount||0)-spent);
  await run(c.env.DB,`UPDATE erp_rfp_liquidations SET spent_amount=?,variance=?,updated_at=datetime('now') WHERE id=?`,[spent,variance,id]);
  let attach={saved:[],failed:[]};
  if(Array.isArray(b.attachments)&&b.attachments.length){
    attach=await saveAttachments(c.env,c.env.DB,{moduleCode:'LIQUIDATION',recordType:'LIQUIDATION',
      recordId:id,recordNo:header.liquidation_no,files:b.attachments,uploadedBy:user.email});
  }
  return ok(c,{lines:lineNo,spent,variance,advance:header.advance_amount,attachments:attach.saved,attachmentErrors:attach.failed});
});

financeRoutes.post('/liquidations/:id/submit', requirePermission('FINANCE','CREATE'), async c=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE id=?`,[id]);
  if(!header)return fail(c,'Liquidation not found.',404);
  const user=c.get('erpUser');
  if(header.requestor_email!==user.email)return fail(c,'Only the requestor can submit this liquidation.',403);
  if(header.status!=='DRAFT')return fail(c,'Already submitted.',409);
  const items=await all(c.env.DB,`SELECT COUNT(*) n FROM erp_rfp_liquidation_items WHERE liquidation_id=?`,[id]);
  if(!Number(items[0]?.n||0))return fail(c,'Add at least one liquidation line.',409);
  await run(c.env.DB,`UPDATE erp_rfp_liquidations SET status='SUBMITTED',submitted_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[id]);
  const finance=await roleEmails(c.env.DB,c.env,['FINANCE'],'');
  const attachments=await attachmentsFor(c.env.DB,'LIQUIDATION',id,header.liquidation_no);
  await sendMailQuiet(c.env,{to:finance,cc:[user.email],
    subject:`Liquidation submitted: ${header.liquidation_no} (${header.request_no})`,
    html:mailLayout('Cash advance liquidation submitted',
      `<p>${user.email} submitted a liquidation for cash advance <b>${header.request_no}</b>.</p>`
      +mailFacts([['Liquidation',header.liquidation_no],['Cash advance',header.request_no],
        ['Advance amount',rfpMoney(header.advance_amount)],['Total spent',rfpMoney(header.spent_amount)],
        ['Variance',rfpMoney(header.variance)]])
      +mailAttachments(attachments),'Cash advance liquidation')});
  await audit(c,{action:'SUBMIT',module:'FINANCE',recordType:'LIQUIDATION',recordId:id,recordNo:header.liquidation_no,after:{spent:header.spent_amount,variance:header.variance}});
  return ok(c,{submitted:true});
});

financeRoutes.post('/liquidations/:id/review', requirePermission('FINANCE','APPROVE'), async c=>{
  const id=Number(c.req.param('id'));const b=await jsonBody(c);
  const header=await first(c.env.DB,`SELECT * FROM erp_rfp_liquidations WHERE id=?`,[id]);
  if(!header)return fail(c,'Liquidation not found.',404);
  if(header.status!=='SUBMITTED')return fail(c,'Only a submitted liquidation can be reviewed.',409);
  const approve=String(b.decision||'APPROVE').toUpperCase()!=='REJECT';
  const user=c.get('erpUser').email;
  await run(c.env.DB,`UPDATE erp_rfp_liquidations SET status=?,reviewed_by=?,reviewed_at=datetime('now'),
    remarks=?,updated_at=datetime('now') WHERE id=?`,[approve?'APPROVED':'REJECTED',user,normalizeText(b.remarks),id]);
  await sendMailQuiet(c.env,{to:[header.requestor_email],
    subject:`Liquidation ${approve?'approved':'returned'}: ${header.liquidation_no}`,
    html:mailLayout(`Liquidation ${approve?'approved':'returned'}`,
      `<p>Finance ${approve?'approved':'returned'} your liquidation for cash advance <b>${header.request_no}</b>.</p>`
      +mailFacts([['Liquidation',header.liquidation_no],['Advance',rfpMoney(header.advance_amount)],
        ['Spent',rfpMoney(header.spent_amount)],['Variance',rfpMoney(header.variance)],
        ['Remarks',normalizeText(b.remarks)]]),'Cash advance liquidation')});
  await audit(c,{action:approve?'APPROVE':'REJECT',module:'FINANCE',recordType:'LIQUIDATION',recordId:id,recordNo:header.liquidation_no,after:{decision:approve}});
  return ok(c,{status:approve?'APPROVED':'REJECTED'});
});
