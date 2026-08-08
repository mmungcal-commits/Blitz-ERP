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

  /*
   * A management report needs a period. Default to month-to-date, because that
   * is the question somebody actually opens this with; ?from=&to= overrides it.
   */
  const today = new Date().toISOString().slice(0,10);
  const monthStart = today.slice(0,8) + '01';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('from')||'') ? c.req.query('from') : monthStart;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('to')||'')   ? c.req.query('to')   : today;

  /*
   * The dashboard leads with what this department actually runs on. Permission
   * still decides what may be shown at all; department decides the order, so
   * Finance opens on the money and the warehouse opens on the stock.
   */
  const dept = String(user.department || '').toUpperCase();
  const FOCUS = {
    FINANCE:            ['management','finance','inventory','procurement','service'],
    ACCOUNTING:         ['management','finance','inventory','procurement'],
    'SUPPLY CHAIN':     ['inventory','procurement','service','management'],
    LOGISTICS:          ['inventory','procurement','service'],
    WAREHOUSE:          ['inventory','procurement'],
    OPERATIONS:         ['inventory','service','procurement','management'],
    'AFTER SALES':      ['service','inventory','procurement'],
    'SALES AND MARKETING':['service','inventory','finance'],
    SALES:              ['service','inventory','finance'],
    HR:                 ['management'],
    TECH:               ['inventory','service'],
  };
  const BY_ROLE = {
    CEO:      ['management','finance','inventory','procurement','service'],
    MANCOM:   ['management','finance','inventory'],
    FINANCE:  ['management','finance','inventory','procurement','service'],
    SCM_HEAD: ['inventory','procurement','service','management'],
  };
  const focus = FOCUS[dept] || BY_ROLE[role] || ['inventory','procurement','finance','service','management'];

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

  /*
   * Finance reads this as a management report, so it wants position and rate
   * side by side: what is out on lease, what has been sold, what is still
   * available, and how much of what was billed has actually come in.
   *
   * Collection % is cash against what was billed in the period. Receivables %
   * is what is still outstanding on it. They are two halves of the same number,
   * from the same rows, so they cannot disagree.
   *
   * Both read the Receivables Management register, because that is where E88
   * records customer invoices. Billed is the posted register; collected is the
   * receipts sitting against it. Drafts are excluded - an unposted row has not
   * billed anybody yet, and counting it would understate collection.
   */
  if (can.FINANCE) await attempt('management', async () => {
    const [units, billed, collected, overdue, aging,
           byStream, byCustomer, byMonth] = await Promise.all([
      first(db, `SELECT
          COUNT(CASE WHEN current_status IN ('AVAILABLE','IN_STOCK','AVAILABLE_FOR_SALE','AVAILABLE_FOR_LEASE') THEN 1 END) available,
          COUNT(CASE WHEN current_status IN ('LEASED','ON_LEASE') THEN 1 END) leased,
          COUNT(CASE WHEN current_status='SOLD' THEN 1 END) sold,
          COUNT(CASE WHEN current_status IN ('DEMO','PILOT_TEST','ASSIGNED','EMPLOYEE_ASSIGNED','INTERNAL_ASSIGNED') THEN 1 END) deployed
        FROM erp_assets WHERE active=1`),
      first(db, `SELECT COALESCE(SUM(gross_amount),0) v, COUNT(*) n FROM erp_ar_collections
        WHERE status='POSTED'`),
      first(db, `SELECT COALESCE(SUM(r.amount),0) v FROM erp_ar_receipts r
        JOIN erp_ar_collections c ON c.id=r.collection_id
        WHERE r.status='ACTIVE' AND c.status='POSTED'`),
      /*
       * The register carries no due date, so a receivable ages from the day it
       * was transacted. Anything still unpaid past thirty days is overdue.
       * Overdue and ageing look at the whole book, not the selected period - a
       * balance does not stop being overdue because the report window moved.
       */
      first(db, `SELECT COALESCE(SUM(bal),0) v, COUNT(*) n FROM (
          SELECT c.gross_amount - COALESCE((SELECT SUM(r.amount) FROM erp_ar_receipts r
            WHERE r.collection_id=c.id AND r.status='ACTIVE'),0) bal
          FROM erp_ar_collections c
          WHERE c.status='POSTED' AND c.txn_date < date('now','-30 days')
        ) WHERE bal > 0`),
      all(db, `SELECT
          CASE WHEN txn_date>=date('now','-30 days') THEN 'Current'
               WHEN txn_date>=date('now','-60 days') THEN '31-60 days'
               WHEN txn_date>=date('now','-90 days') THEN '61-90 days'
               ELSE 'Over 90 days' END label,
          COALESCE(SUM(bal),0) value
        FROM (
          SELECT c.txn_date, c.gross_amount - COALESCE((SELECT SUM(r.amount) FROM erp_ar_receipts r
            WHERE r.collection_id=c.id AND r.status='ACTIVE'),0) bal
          FROM erp_ar_collections c WHERE c.status='POSTED'
        ) WHERE bal > 0 GROUP BY label`),
      /*
       * What the revenue is made of, who it came from, and when.
       *
       * These three are the shape of the Receivables Center, and they belong on
       * the dashboard for the same reason they belong there: "7.4M" tells you
       * nothing a total could not, while "7.4M sold, 3.6M leased, 462K swapping"
       * tells you what business the company is in this month.
       *
       * Whole book rather than the selected period, matching the centre - a
       * customer does not stop being the largest because the window moved.
       */
      /*
       * Grouped on `stream` and scoped to everything not voided, which is what
       * the Receivables Center does. Getting either wrong makes the same card
       * on two screens disagree: `sales_type` is empty on the whole register,
       * so grouping by it collapsed twelve million into one slice labelled
       * OTHER, and POSTED-only would drop the drafts the centre counts.
       */
      all(db, `SELECT COALESCE(NULLIF(stream,''),'OTHER') label,
          COALESCE(SUM(gross_amount),0) value
        FROM erp_ar_collections WHERE status<>'VOID'
        GROUP BY 1 HAVING value>0 ORDER BY value DESC`),
      /*
       * Leasing customers only.
       *
       * Across every stream this chart was a list of one: a six-million-peso
       * motorcycle sale to Autoitalia dwarfed everyone and told you nothing
       * about the business that recurs. Leasing is the relationship the company
       * actually runs on, so that is what the chart ranks.
       */
      all(db, `SELECT COALESCE(NULLIF(customer_name,''),'Unnamed') label,
          COALESCE(SUM(gross_amount),0) value
        FROM erp_ar_collections WHERE status<>'VOID' AND stream='MC_LEASED'
        GROUP BY 1 HAVING value>0 ORDER BY value DESC LIMIT 8`),
      all(db, `SELECT substr(txn_date,1,7) label, COALESCE(SUM(gross_amount),0) value
        FROM erp_ar_collections WHERE status<>'VOID' AND COALESCE(txn_date,'')<>''
        GROUP BY 1 ORDER BY 1`),
    ]);
    /*
     * "Pending approval" means an RFP sitting in the chain - submitted, not yet
     * paid or rejected. A draft is not pending anybody; it is still being
     * written. Counting drafts would inflate the number Finance manages to.
     */
    const RFP_PENDING = `('SUBMITTED','DEPARTMENT_APPROVED','FINANCE_REVIEWED','FINANCE_VALIDATED','MANCOM_APPROVED','APPROVED','FOR_APPROVAL')`;
    const [rfpPending, rfpMine, rfpRaised, rfpPaid, slaRows, slaTarget, partPaid] = await Promise.all([
      first(db, `SELECT COUNT(*) n, COALESCE(SUM(gross_amount),0) v FROM erp_payment_requests
        WHERE status IN ${RFP_PENDING}`),
      first(db, `SELECT COUNT(*) n FROM erp_payment_requests WHERE status='FINANCE_REVIEWED'`),
      // What the company was asked to pay in the period, and what it paid.
      first(db, `SELECT COUNT(*) n, COALESCE(SUM(net_payable),0) v FROM erp_payment_requests
        WHERE status<>'REJECTED' AND status<>'CANCELLED'`),
      /*
       * What went out is the sum of the payments, not the count of the flags.
       * A request settled 30% down counts as 30% paid, which is the only
       * reading that makes the payable rate mean anything on a supply order
       * paid in instalments.
       */
      first(db, `SELECT COUNT(DISTINCT s.request_no) n, COALESCE(SUM(s.amount),0) v
        FROM erp_payment_settlements s
        JOIN erp_payment_requests r ON r.request_no=s.request_no
        WHERE s.status<>'VOID' AND r.status<>'REJECTED' AND r.status<>'CANCELLED'
`),
      // The service level is measured on money leaving, so it reads the same
      // settlements: a part payment is measured from when that part was paid.
      all(db, `SELECT r.request_date, s.paid_date paid_at
        FROM erp_payment_settlements s
        JOIN erp_payment_requests r ON r.request_no=s.request_no
        WHERE s.status<>'VOID' AND s.paid_date IS NOT NULL AND s.paid_date<>''
`),
      first(db, `SELECT target_days FROM erp_service_levels WHERE code='RFP_PAYMENT'`).catch(() => null),
      first(db, `SELECT COUNT(*) n, COALESCE(SUM(net_payable),0) v FROM erp_payment_requests
        WHERE status='PARTIALLY_PAID'`),
    ]);

    /*
     * Finance works to a service level: a vendor is paid within ten banking days
     * of the request. Banking days means weekdays - Philippine public holidays
     * are not in the system, so a run of holidays flatters the figure slightly,
     * and it is better to say so than to pretend a calendar we do not have.
     */
    const bankingDays = (a, b) => {
      const d1 = new Date(String(a).slice(0, 10) + 'T00:00:00Z');
      const d2 = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
      if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || d2 < d1) return null;
      let days = 0;
      const cur = new Date(d1);
      while (cur < d2) {
        cur.setUTCDate(cur.getUTCDate() + 1);
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) days += 1;
      }
      return days;
    };
    const targetDays = Number(slaTarget?.target_days) || 10;
    const measured = (slaRows || []).map(r => bankingDays(r.request_date, r.paid_at)).filter(d => d != null);
    const withinSla = measured.filter(d => d <= targetDays).length;
    const raisedV = Number(rfpRaised?.v || 0);
    const paidV = Number(rfpPaid?.v || 0);

    const billedV = Number(billed?.v || 0);
    const collectedValue = Math.min(billedV, Number(collected?.v || 0));
    const openV = Math.max(0, Math.round((billedV - collectedValue) * 100) / 100);
    sections.management = {
      period: { from, to },
      pendingApprovals: Number(rfpPending?.n || 0),
      pendingApprovalValue: Number(rfpPending?.v || 0),
      pendingMine: Number(rfpMine?.n || 0),
      availableUnits: Number(units?.available || 0),
      leasedUnits: Number(units?.leased || 0),
      soldUnits: Number(units?.sold || 0),
      deployedUnits: Number(units?.deployed || 0),
      billed: billedV, collected: collectedValue, outstanding: openV, invoices: Number(billed?.n || 0),
      // Undefined, not zero, when nothing was billed - 0% collection on no
      // invoices would read as a failure rather than as no activity.
      collectionPct: billedV > 0 ? (collectedValue / billedV) * 100 : null,
      receivablesPct: billedV > 0 ? (openV / billedV) * 100 : null,
      overdue: Number(overdue?.v || 0), overdueCount: Number(overdue?.n || 0),
      aging: aging || [],
      byStream: byStream || [], byCustomer: byCustomer || [], byMonth: byMonth || [],

      // The payable side of the same question: what was asked for, what went out.
      payableRaised: raisedV, payableRaisedCount: Number(rfpRaised?.n || 0),
      payablePaid: paidV, payablePaidCount: Number(rfpPaid?.n || 0),
      // Requests with money against them but not yet settled in full.
      payablePartial: Number(partPaid?.n || 0), payablePartialValue: Number(partPaid?.v || 0),
      payableOutstanding: Math.max(0, Math.round((raisedV - paidV) * 100) / 100),
      payablePct: raisedV > 0 ? (paidV / raisedV) * 100 : null,

      slaTargetDays: targetDays,
      slaMeasured: measured.length,
      slaWithin: withinSla,
      slaPct: measured.length ? (withinSla / measured.length) * 100 : null,
      slaAvgDays: measured.length
        ? Math.round((measured.reduce((s2, d) => s2 + d, 0) / measured.length) * 10) / 10 : null,
      slaWorstDays: measured.length ? Math.max(...measured) : null,
    };

    /*
     * The swapping network read on its own.
     *
     * RideBox builds and runs the stations, and its spend was mixed in with
     * everything else, so neither "what does the network cost" nor "what does
     * the rest of the company cost" could be answered. The rule for what
     * belongs to which line lives in erp_business_line_rules, and the view
     * applies it, so this reads the split rather than deciding it.
     */
    try {
      const lines = await all(db, `SELECT b.line_code, b.name, b.description, b.sort_order,
          COUNT(r.id) requests,
          ROUND(COALESCE(SUM(r.net_payable),0),2) raised,
          ROUND(COALESCE(SUM(CASE WHEN v.line_code IS NOT NULL THEN (
            SELECT COALESCE(SUM(s.amount),0) FROM erp_payment_settlements s
             WHERE s.request_no=r.request_no AND s.status<>'VOID') ELSE 0 END),0),2) settled
        FROM erp_business_lines b
        LEFT JOIN v_payment_request_line v ON v.line_code=b.line_code
        LEFT JOIN erp_payment_requests r ON r.request_no=v.request_no
             AND r.status NOT IN ('REJECTED','CANCELLED')

        WHERE b.active=1
        GROUP BY b.line_code ORDER BY b.sort_order, b.line_code`);
      sections.businessLines = (lines || []).map(l => {
        const raised = Number(l.raised || 0);
        const settled = Number(l.settled || 0);
        return {
          code: l.line_code, name: l.name, description: l.description,
          requests: Number(l.requests || 0),
          raised, settled,
          owed: Math.max(0, Math.round((raised - settled) * 100) / 100),
          paidPct: raised > 0 ? (settled / raised) * 100 : null,
        };
      });
      /*
       * Inside the swapping line: what the network cost to build against what
       * it costs to keep standing. The running cost is the site rents and the
       * station power, which are small, frequent and paid to the shops the
       * stations live in.
       */
      const kinds = await all(db, `SELECT k.cost_kind, COUNT(*) lines,
          ROUND(COALESCE(SUM(k.gross_amount),0),2) amount,
          COUNT(DISTINCT k.request_no) requests
        FROM v_bss_cost_kind k
        JOIN erp_payment_requests r ON r.request_no=k.request_no
        WHERE r.status NOT IN ('REJECTED','CANCELLED')
        GROUP BY k.cost_kind`);
      const kind = c => (kinds || []).find(k => k.cost_kind === c) || {};
      sections.swappingNetwork = {
        build: { amount: Number(kind('BUILD').amount || 0), lines: Number(kind('BUILD').lines || 0) },
        sites: { amount: Number(kind('SITES').amount || 0), lines: Number(kind('SITES').lines || 0),
          requests: Number(kind('SITES').requests || 0) },
        // Who the company pays to keep a station where it stands.
        hosts: await all(db, `SELECT r.payee_name label, COUNT(*) n,
            ROUND(SUM(k.gross_amount),2) value
          FROM v_bss_cost_kind k
          JOIN erp_payment_requests r ON r.request_no=k.request_no
          WHERE k.cost_kind='SITES' AND r.status NOT IN ('REJECTED','CANCELLED')
          GROUP BY r.payee_name ORDER BY value DESC LIMIT 8`),
      };
    } catch (e) {
      /*
       * The views arrive with migration 0057, so an older database has no split
       * to show and that is fine. Anything else is a fault, and a blank card
       * with nobody told is worse than a missing one: it reads as "no spend".
       */
      sections.businessLines = [];
      sections.swappingNetwork = null;
      failures.push({ section: 'businessLines', error: String(e && e.message || e) });
    }
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
    if (num(r)) waiting.push({ label:'Payment requests for your validation', count:num(r), module:'fa-receivables-payables#records' });
  });
  if (can.INVENTORY) await attempt('waiting.counts', async () => {
    const step = await first(db, `SELECT COUNT(*) n FROM erp_cycle_count_approvals a
      JOIN erp_cycle_counts cc ON cc.id=a.cycle_count_id
      WHERE a.status='PENDING' AND cc.status='SUBMITTED'
        AND a.step_no=(SELECT MIN(step_no) FROM erp_cycle_count_approvals p
                       WHERE p.cycle_count_id=a.cycle_count_id AND p.status='PENDING')`);
    if (num(step)) waiting.push({ label:'Physical counts awaiting approval', count:num(step), module:'ip-cycle-counting#approvals' });
  });
  if (can.PROCUREMENT) await attempt('waiting.po', async () => {
    const r = await first(db, `SELECT COUNT(*) n FROM erp_purchase_orders WHERE status='FOR_APPROVAL'`);
    if (num(r)) waiting.push({ label:'Purchase orders in the approval chain', count:num(r), module:'ip-inbound-logistics#records' });
  });
  if (can.RECEIVING) await attempt('waiting.variances', async () => {
    const r = await first(db, `SELECT COUNT(*) n FROM erp_receiving_variances WHERE status IN ('OPEN','RESOLVED')`);
    if (num(r)) waiting.push({ label:'Receiving discrepancies to clear', count:num(r), module:'ip-inbound-logistics#records' });
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

  /*
   * Completion of the counts actually in progress - a real percentage, not a
   * score.
   *
   * "Percent of expected" is the wrong question for an opening count. The first
   * count of a warehouse the system has never seen expects nothing, so the
   * denominator is nought: three hundred and forty-one units scanned reported
   * as "no count in progress, 0% counted" while the team was in the middle of
   * counting them. What is true in that case is the number of units on the
   * sheet and the fact that none of them are registered yet, so both are
   * carried and the screen picks the measure that fits.
   */
  const progress = await attempt('progress', async () => {
    const r = await first(db, `SELECT COALESCE(SUM(counted_units),0) counted,
        COALESCE(SUM(expected_units),0) expected,
        COUNT(*) sheets,
        COALESCE(SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END),0) open_sheets,
        COALESCE(SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END),0) submitted_sheets
      FROM erp_cycle_counts WHERE status IN ('OPEN','SUBMITTED')`);
    /*
     * Counted on the floor and not yet in inventory. It becomes stock when the
     * count is posted; until then it is neither missing nor on the books. A
     * line nobody has named yet cannot be posted as anything, so how many are
     * named is the real measure of how close an opening count is to done.
     */
    const pending = await first(db, `SELECT
        COUNT(*) n,
        COALESCE(SUM(CASE WHEN COALESCE(nu.item_code,'')<>'' THEN 1 ELSE 0 END),0) identified
      FROM erp_cycle_count_lines l
      JOIN erp_cycle_counts cc ON cc.id=l.cycle_count_id
      LEFT JOIN erp_cycle_count_new_units nu ON nu.line_id=l.id
      WHERE cc.status IN ('OPEN','SUBMITTED')
        AND l.variance_type='UNKNOWN_SERIAL' AND l.actual_serial_no IS NOT NULL`);
    const expected = Number(r?.expected||0), counted = Number(r?.counted||0);
    const awaiting = Number(pending?.n||0), identified = Number(pending?.identified||0);
    return { counted, expected,
      sheets: Number(r?.sheets||0),
      openSheets: Number(r?.open_sheets||0),
      submittedSheets: Number(r?.submitted_sheets||0),
      awaitingRegistration: awaiting,
      identified,
      toIdentify: Math.max(0, awaiting - identified),
      // Ready to post, for a count with nothing to count against.
      readyPct: awaiting ? Math.min(100,(identified/awaiting)*100) : null,
      pct: expected ? Math.min(100,(counted/expected)*100) : null };
  });

  return ok(c, { user:{ name:user.display_name||user.email, role, email:user.email },
    period:{from,to}, department:dept||null, focus, sections, waiting, activity, trends: trends||{}, progress: progress||null, failures });
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
