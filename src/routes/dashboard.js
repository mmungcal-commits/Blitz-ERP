import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok } from '../lib/http.js';
import { requirePermission, permissionFor } from '../lib/auth.js';

export const dashboardRoutes = new Hono();
dashboardRoutes.use('*', requirePermission('DASHBOARD','VIEW'));

dashboardRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const [assetRows, shipmentRows, salesRows, recentRows] = await Promise.all([
    all(db, `SELECT kpi_category category,current_status status,COUNT(*) qty
             FROM vw_erp_serialized_assets GROUP BY kpi_category,current_status ORDER BY kpi_category,current_status`),
    all(db, `SELECT status,COUNT(*) qty FROM erp_shipments GROUP BY status`),
    all(db, `SELECT transaction_type,status,COUNT(*) qty,COALESCE(SUM(gross_amount),0) amount
             FROM erp_sales_orders GROUP BY transaction_type,status`),
    all(db, `SELECT event_at,user_email,action,module,record_no FROM erp_audit_log ORDER BY id DESC LIMIT 12`),
  ]);

  const byCategory = {};
  for (const row of assetRows) {
    if (!byCategory[row.category]) byCategory[row.category] = { total:0, statuses:{} };
    byCategory[row.category].total += row.qty;
    byCategory[row.category].statuses[row.status] = row.qty;
  }

  const [unreconciled, openRequisitions, pendingDeliveries, availableAssets, duplicateExceptions] = await Promise.all([
    first(db, `SELECT COUNT(*) n FROM erp_reconciliation_cases WHERE status='UNRECONCILED'`),
    first(db, `SELECT COUNT(*) n FROM erp_requisitions WHERE status NOT IN ('CLOSED','CANCELLED','DONE')`),
    first(db, `SELECT COUNT(*) n FROM erp_deliveries WHERE status NOT IN ('DELIVERED','CANCELLED')`),
    first(db, `SELECT COUNT(*) n FROM vw_erp_serialized_assets WHERE current_status IN ('AVAILABLE','IN_STOCK') AND reconciliation_status='CLEAR'`),
    first(db, `SELECT COUNT(*) n FROM erp_serial_exceptions WHERE status='OPEN'`),
  ]);

  return ok(c, {
    inventory: byCategory,
    shipments: shipmentRows,
    sales: salesRows,
    kpis: {
      availableAssets: availableAssets?.n || 0,
      unreconciledReturns: unreconciled?.n || 0,
      openRequisitions: openRequisitions?.n || 0,
      pendingDeliveries: pendingDeliveries?.n || 0,
      serialExceptions: duplicateExceptions?.n || 0,
    },
    recentActivity: recentRows,
  });
});

/*
 * The landing cockpit.
 *
 * What somebody wants the second they sign in is not a map of ninety modules -
 * it is "what is waiting on me, and is anything on fire". So this returns the
 * headline numbers plus the queue that has this person's name on it, and only
 * for the modules they can actually open. A section they have no rights to is
 * absent, not empty: an empty panel reads as "nothing to do" and that is a lie.
 */
dashboardRoutes.get('/home', async (c) => {
  const db = c.env.DB;
  const user = c.get('erpUser');
  const role = String(user.role_code || user.role || '').toUpperCase();
  const can = {};
  for (const m of ['INVENTORY','PROCUREMENT','FINANCE','CUSTOMERS','DELIVERIES','RECEIVING']) {
    can[m] = !!(await permissionFor(db, user, m)).can_view;
  }

  const sections = {};
  const num = r => Number((r && (r.n ?? r.total)) || 0);
  // A dashboard is a summary, not a transaction. If one panel's query fails -
  // a renamed column, a view that is not there yet - the rest still renders and
  // the failure is reported, rather than the whole screen hanging.
  const failures = [];
  const attempt = async (name, fn) => {
    try { return await fn(); }
    catch (err) { failures.push({ section:name, error:String(err && err.message || err) }); return null; }
  };

  if (can.INVENTORY) await attempt('inventory', async () => {
    const [avail, quarantine, unvalued, openCounts, variances, classes] = await Promise.all([
      first(db, `SELECT COUNT(*) n FROM vw_erp_serialized_assets WHERE current_status IN ('AVAILABLE','IN_STOCK')`),
      first(db, `SELECT COUNT(*) n FROM vw_erp_serialized_assets WHERE current_status='QUARANTINE'`),
      first(db, `SELECT COUNT(*) n FROM erp_assets WHERE active=1 AND COALESCE(unit_cost,0)=0`),
      first(db, `SELECT COUNT(*) n FROM erp_cycle_counts WHERE status='OPEN'`),
      first(db, `SELECT COALESCE(SUM(variance_units),0) n FROM erp_cycle_counts WHERE status<>'CANCELLED'`),
      all(db,   `SELECT kpi_category label, COUNT(*) value FROM vw_erp_serialized_assets
                 GROUP BY kpi_category ORDER BY value DESC`),
    ]);
    sections.inventory = { available:num(avail), quarantine:num(quarantine), unvalued:num(unvalued),
      openCounts:num(openCounts), variances:num(variances), byClass:classes||[] };
  });

  if (can.PROCUREMENT) await attempt('procurement', async () => {
    const [forApproval, approved, spend] = await Promise.all([
      first(db, `SELECT COUNT(*) n FROM erp_purchase_orders WHERE status='FOR_APPROVAL'`),
      first(db, `SELECT COUNT(*) n FROM erp_purchase_orders WHERE status='APPROVED'`),
      all(db,   `SELECT vendor_name label, COALESCE(SUM(total_amount),0) value FROM erp_purchase_orders
                 WHERE status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED')
                 GROUP BY vendor_name ORDER BY value DESC LIMIT 6`),
    ]);
    sections.procurement = { forApproval:num(forApproval), approved:num(approved), topVendors:spend||[] };
  });

  if (can.FINANCE) await attempt('finance', async () => {
    const [rfpOpen, rfpMine, byStage] = await Promise.all([
      first(db, `SELECT COUNT(*) n FROM erp_payment_requests WHERE status NOT IN ('PAID','REJECTED','CANCELLED')`),
      first(db, `SELECT COUNT(*) n FROM erp_payment_requests WHERE LOWER(COALESCE(requestor_email,''))=?`,
        [String(user.email).toLowerCase()]),
      all(db,   `SELECT status label, COUNT(*) value FROM erp_payment_requests GROUP BY status ORDER BY value DESC`),
    ]);
    sections.finance = { open:num(rfpOpen), mine:num(rfpMine), byStage:byStage||[] };
  });

  if (can.CUSTOMERS) await attempt('service', async () => {
    const jobs = await all(db, `SELECT status label, COUNT(*) value FROM erp_service_jobs GROUP BY status`);
    sections.service = { byStatus: jobs || [] };
  });

  // The queue with this person's name on it. Cheap counts, not full rows -
  // the landing page says how many and where, the module says which.
  const waiting = [];
  if (can.FINANCE) await attempt('waiting.finance', async () => {
    const r = await first(db, `SELECT COUNT(*) n FROM erp_payment_requests WHERE status='FINANCE_REVIEWED'`);
    if (num(r)) waiting.push({ label:'Payment requests for your validation', count:num(r), module:'fa-receivables-payables' });
  });
  if (can.INVENTORY) await attempt('waiting.counts', async () => {
    const step = await first(db, `SELECT COUNT(*) n FROM erp_cycle_count_approvals a
      JOIN erp_cycle_counts cc ON cc.id=a.cycle_count_id
      WHERE a.status='PENDING' AND cc.status='SUBMITTED'
        AND a.step_no=(SELECT MIN(step_no) FROM erp_cycle_count_approvals p
                       WHERE p.cycle_count_id=a.cycle_count_id AND p.status='PENDING')`);
    if (num(step)) waiting.push({ label:'Physical counts awaiting approval', count:num(step), module:'ip-cycle-counting' });
  });
  if (can.PROCUREMENT) await attempt('waiting.po', async () => {
    const r = await first(db, `SELECT COUNT(*) n FROM erp_purchase_orders WHERE status='FOR_APPROVAL'`);
    if (num(r)) waiting.push({ label:'Purchase orders in the approval chain', count:num(r), module:'ip-inbound-logistics' });
  });
  if (can.RECEIVING) await attempt('waiting.variances', async () => {
    const r = await first(db, `SELECT COUNT(*) n FROM erp_receiving_variances WHERE status IN ('OPEN','RESOLVED')`);
    if (num(r)) waiting.push({ label:'Receiving discrepancies to clear', count:num(r), module:'ip-inbound-logistics' });
  });

  const activity = await attempt('activity', () => all(db, `SELECT event_at,user_email,action,module,record_no
    FROM erp_audit_log ORDER BY id DESC LIMIT 10`)) || [];

  /*
   * Real seven-day trend, from the audit log. A sparkline on a stat tile is
   * only worth drawing if it is the actual shape of the last week - a
   * decorative squiggle is worse than no chart, so anything without history
   * simply gets no spark.
   */
  const trends = await attempt('trends', async () => {
    const rows = await all(db, `SELECT module, date(event_at) d, COUNT(*) n
      FROM erp_audit_log
      WHERE event_at >= date('now','-6 days')
      GROUP BY module, date(event_at)`);
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dt = new Date(Date.now() - i*86400000).toISOString().slice(0,10);
      days.push(dt);
    }
    const shape = (mod) => {
      const hit = {};
      rows.filter(r => !mod || r.module === mod).forEach(r => { hit[r.d] = (hit[r.d]||0) + Number(r.n||0); });
      const series = days.map(d => ({ label:d, value: hit[d] || 0 }));
      return series.some(p => p.value > 0) ? series : null;
    };
    // Week on week, from the same source, so the delta and the spark agree.
    const half = (series, from, to) => series.slice(from,to).reduce((t,p)=>t+p.value,0);
    const withDelta = (series) => {
      if (!series) return null;
      const recent = half(series,3,7), prior = half(series,0,3);
      const delta = prior > 0 ? ((recent - prior) / prior) * 100 : null;
      return { series, delta };
    };
    return { all: withDelta(shape(null)), inventory: withDelta(shape('INVENTORY')),
      finance: withDelta(shape('FINANCE')), procurement: withDelta(shape('PROCUREMENT')) };
  });

  // Completion of the counts actually in progress - a real percentage, not a score.
  const progress = await attempt('progress', async () => {
    const r = await first(db, `SELECT COALESCE(SUM(counted_units),0) counted, COALESCE(SUM(expected_units),0) expected
      FROM erp_cycle_counts WHERE status IN ('OPEN','SUBMITTED')`);
    const expected = Number(r?.expected||0), counted = Number(r?.counted||0);
    return { counted, expected, pct: expected ? Math.min(100,(counted/expected)*100) : null };
  });

  return ok(c, { user:{ name:user.display_name||user.email, role, email:user.email },
    sections, waiting, activity, trends: trends||{}, progress: progress||null, failures });
});

dashboardRoutes.get('/detail/:metric', async (c) => {
  const db = c.env.DB;
  const metric = c.req.param('metric');
  let rows = [];
  if (metric === 'available-assets') rows = await all(db, `SELECT serial_no,item_code,item_name,kpi_category category,current_status,current_location_code FROM vw_erp_serialized_assets WHERE current_status IN ('AVAILABLE','IN_STOCK') AND reconciliation_status='CLEAR' ORDER BY category,item_code LIMIT 500`);
  else if (metric === 'unreconciled') rows = await all(db, `SELECT case_no,case_type,expected_serial,actual_serial,related_motorcycle_serial,current_location_code,status,opened_at FROM erp_reconciliation_cases WHERE status='UNRECONCILED' ORDER BY opened_at DESC LIMIT 500`);
  else if (metric === 'requisitions') rows = await all(db, `SELECT requisition_no,request_date,requestor_name,department,purpose,destination,status FROM erp_requisitions WHERE status NOT IN ('CLOSED','CANCELLED','DONE') ORDER BY request_date DESC LIMIT 500`);
  else if (metric === 'deliveries') rows = await all(db, `SELECT delivery_no,scheduled_date,destination,recipient_name,status,source_system,source_key FROM erp_deliveries WHERE status NOT IN ('DELIVERED','CANCELLED') ORDER BY scheduled_date LIMIT 500`);
  else if (metric === 'serial-exceptions') rows = await all(db, `SELECT exception_no,serial_no,exception_type,source_system,source_sheet,source_row,status,created_at FROM erp_serial_exceptions WHERE status='OPEN' ORDER BY created_at DESC LIMIT 500`);
  else if (metric.startsWith('inventory-')) {
    const [, category, status] = metric.split('-');
    rows = await all(db, `SELECT serial_no,item_code,item_name,kpi_category category,current_status,current_location_code,current_holder_name,reconciliation_status FROM vw_erp_serialized_assets WHERE kpi_category=? AND current_status=? ORDER BY item_name,serial_no LIMIT 1000`, [category.toUpperCase(), status.toUpperCase()]);
  }
  return ok(c, { metric, rows });
});
