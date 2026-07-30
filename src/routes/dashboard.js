import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';

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
