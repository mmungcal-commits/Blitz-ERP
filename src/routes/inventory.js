import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeSerial, normalizeText, ensureLocation, nextCode } from '../lib/codes.js';
import { postMovement, createAssetFromReceipt } from '../lib/inventory.js';
import { captureFinanceEvent } from '../lib/finance.js';
import { inventoryAccountForCategory } from '../lib/transaction-rules.js';

export const inventoryRoutes = new Hono();

inventoryRoutes.get('/', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c);
  const q=`%${normalizeText(c.req.query('q'))}%`; const category=normalizeText(c.req.query('category')); const status=normalizeText(c.req.query('status')); const location=normalizeText(c.req.query('location')); const recon=normalizeText(c.req.query('reconciliation'));
  const includeExceptions=String(c.req.query('includeExceptions')||'').toLowerCase()==='true';
  const source=includeExceptions?'erp_assets':'vw_erp_serialized_assets';
  const where=['a.active=1']; const args=[];
  if(q!=='%%'){where.push('(a.serial_no LIKE ? OR a.secondary_serial LIKE ? OR a.item_code LIKE ? OR a.item_name LIKE ? OR a.current_holder_name LIKE ?)');args.push(q,q,q,q,q);}
  if(category){where.push(includeExceptions?'a.category=?':'a.kpi_category=?');args.push(category);}
  if(status){where.push('a.current_status=?');args.push(status);}
  if(location){where.push('a.current_location_code=?');args.push(location);}
  if(recon){where.push('a.reconciliation_status=?');args.push(recon);}
  const sqlWhere=where.join(' AND ');
  const rows=await all(c.env.DB,`SELECT a.* FROM ${source} a WHERE ${sqlWhere} ORDER BY a.category,a.item_name,a.serial_no LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM ${source} a WHERE ${sqlWhere}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

/*
 * What actually governs an inventory module.
 *
 * These screens used to name the concepts a module works with and stop there.
 * A name is not a control: it cannot tell you whether anything is on hand
 * against it, whether a count found the units, or whether a location has ever
 * been used. So each panel counts real rows, and an empty one is a finding.
 */
inventoryRoutes.get('/module-setup/:code', requirePermission('INVENTORY','VIEW'), async c => {
  const code = normalizeText(c.req.param('code'));
  const out = { code, panels: [] };
  const panel = (title, columns, rows, note) => out.panels.push({ title, columns, rows, note });
  const attempt = async fn => { try { return await fn(); } catch { return []; } };

  if (code === 'ip-cycle-counting') {
    // The vocabulary, with the number of times each has actually happened.
    const variance = await attempt(() => all(c.env.DB, `SELECT variance_type label, COUNT(*) n,
        COUNT(CASE WHEN status='OPEN' THEN 1 END) open,
        COUNT(CASE WHEN status='CLEARED' THEN 1 END) cleared
      FROM erp_cycle_count_variances GROUP BY label ORDER BY n DESC`));
    panel('Variance types found on counts', ['Type', 'Raised', 'Open', 'Cleared'],
      variance.map(v => [String(v.label || '').replace(/_/g, ' '), v.n, v.open, v.cleared]),
      variance.length ? 'A type with nothing against it has never been raised on a count.'
        : 'No count has raised a variance yet.');
    const plans = await attempt(() => all(c.env.DB, `SELECT status label, COUNT(*) n,
        COALESCE(SUM(expected_units),0) expected, COALESCE(SUM(counted_units),0) counted
      FROM erp_cycle_counts GROUP BY label ORDER BY n DESC`));
    panel('Count plans by state', ['State', 'Plans', 'Expected units', 'Counted'],
      plans.map(p => [p.label, p.n, p.expected, p.counted]));
    const chain = await attempt(() => all(c.env.DB, `SELECT step_no, role, COUNT(*) n,
        COUNT(CASE WHEN status='PENDING' THEN 1 END) pending
      FROM erp_cycle_count_approvals GROUP BY step_no, role ORDER BY step_no`));
    panel('Who signs a count off', ['Step', 'Role', 'Signatures', 'Still pending'],
      chain.map(x => [x.step_no, String(x.role || '').replace(/_/g, ' '), x.n, x.pending]),
      'Submit signs the first step. Only Finance posts.');
    const locations = await attempt(() => all(c.env.DB, `SELECT COALESCE(NULLIF(location_name,''),location_code) label,
        COUNT(*) plans, MAX(count_date) last FROM erp_cycle_counts GROUP BY label ORDER BY last DESC LIMIT 30`));
    panel('Locations counted', ['Location', 'Counts', 'Last counted'],
      locations.map(l => [l.label, l.plans, l.last]));
  }

  if (code === 'ip-inventory-analysis' || code === 'ip-warehouse-management') {
    const sources = [];
    const onHand = await attempt(() => first(c.env.DB, `SELECT COUNT(*) n FROM erp_assets WHERE active=1`));
    const incoming = await attempt(() => first(c.env.DB,
      `SELECT COALESCE(SUM(expected_qty-COALESCE(received_qty,0)),0) n FROM erp_shipments
       WHERE status NOT IN ('RECEIVED','CANCELLED')`));
    const openPo = await attempt(() => first(c.env.DB,
      `SELECT COALESCE(SUM(l.ordered_qty-COALESCE(l.received_qty,0)),0) n
       FROM erp_purchase_order_lines l JOIN erp_purchase_orders p ON p.id=l.purchase_order_id
       WHERE p.status IN ('APPROVED','PARTIALLY_RECEIVED')`));
    const deployed = await attempt(() => first(c.env.DB,
      `SELECT COUNT(*) n FROM erp_assets WHERE active=1 AND current_holder_name IS NOT NULL AND current_holder_name<>''`));
    sources.push(['On hand', 'Confirmed by goods receipt, by serial and location', Number(onHand?.n || 0)]);
    sources.push(['Incoming', 'On an expected shipment and not yet received', Number(incoming?.n || 0)]);
    sources.push(['Open purchase order', 'Approved and not yet shipped', Number(openPo?.n || 0)]);
    sources.push(['Deployed', 'With a customer, site, employee or station', Number(deployed?.n || 0)]);
    panel('Where planning gets its numbers', ['Source', 'What it counts', 'Units'], sources);

    const byClass = await attempt(() => all(c.env.DB, `SELECT COALESCE(NULLIF(category,''),'Unclassified') label,
        COUNT(*) units, COUNT(CASE WHEN COALESCE(unit_cost,0)<=0 THEN 1 END) unvalued,
        ROUND(SUM(COALESCE(unit_cost,0)),2) value FROM erp_assets WHERE active=1
      GROUP BY label ORDER BY units DESC`));
    panel('Stock by class', ['Class', 'Units', 'Without a cost', 'Value'],
      byClass.map(x => [x.label, x.units, x.unvalued, x.value]),
      byClass.some(x => x.unvalued > 0) ? 'Units with no cost cannot be valued or capitalised.' : '');

    const statuses = await attempt(() => all(c.env.DB, `SELECT COALESCE(NULLIF(current_status,''),'(not set)') label,
        COUNT(*) units FROM erp_assets WHERE active=1 GROUP BY label ORDER BY units DESC`));
    panel('Unit states in use', ['Status', 'Units'], statuses.map(x => [x.label, x.units]));

    const locations = await attempt(() => all(c.env.DB, `SELECT l.code, l.name, l.location_type,
        (SELECT COUNT(*) FROM erp_assets a WHERE a.current_location_id=l.id AND a.active=1) units
      FROM erp_locations l WHERE l.active=1 ORDER BY units DESC, l.code LIMIT 40`));
    panel('Locations holding stock', ['Code', 'Location', 'Type', 'Units'],
      locations.map(l => [l.code, l.name, l.location_type, l.units]),
      'A location with no units has been set up but never used.');
  }

  if (code === 'ip-inbound-logistics') {
    const shipments = await attempt(() => all(c.env.DB, `SELECT status label, COUNT(*) n,
        COALESCE(SUM(expected_qty),0) expected, COALESCE(SUM(received_qty),0) received
      FROM erp_shipments GROUP BY label ORDER BY n DESC`));
    panel('Shipments by state', ['State', 'Shipments', 'Expected', 'Received'],
      shipments.map(s => [s.label, s.n, s.expected, s.received]));
    const variances = await attempt(() => all(c.env.DB, `SELECT variance_type label, COUNT(*) n,
        COUNT(CASE WHEN status='OPEN' THEN 1 END) open FROM erp_receiving_variances
      GROUP BY label ORDER BY n DESC`));
    panel('Receiving discrepancies', ['Type', 'Raised', 'Still open'],
      variances.map(v => [String(v.label || '').replace(/_/g, ' '), v.n, v.open]),
      variances.length ? 'Only Finance clears one, and somebody else acknowledges it.'
        : 'Every shipment received so far has matched its manifest.');
    const vendors = await attempt(() => all(c.env.DB, `SELECT vendor_name label, COUNT(*) orders,
        ROUND(SUM(total_amount),2) value FROM erp_purchase_orders
      WHERE status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED') GROUP BY label ORDER BY value DESC LIMIT 30`));
    panel('Suppliers under commitment', ['Supplier', 'Orders', 'Committed'],
      vendors.map(v => [v.label, v.orders, v.value]));
  }

  return ok(c, out);
});

inventoryRoutes.get('/by-class', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT class_code cls,class_name,COUNT(DISTINCT item_id) item_count,
      COALESCE(SUM(on_hand_quantity),0) total,COALESCE(SUM(available_quantity),0) available,COALESCE(SUM(leased_quantity),0) leased,COALESCE(SUM(sold_quantity),0) sold,
      COALESCE(SUM(deployed_quantity),0) deployed,COALESCE(SUM(quarantine_quantity),0) quarantine,
      COALESCE(SUM(unvalued_quantity),0) unvalued,ROUND(COALESCE(SUM(inventory_value),0),2) inventory_value
    FROM vw_erp_inventory_by_item_class
    GROUP BY class_code,class_name
    ORDER BY CASE class_code WHEN 'D400' THEN 1 WHEN 'R280' THEN 2 WHEN 'RSPORT' THEN 3 WHEN 'BAT' THEN 4 WHEN 'BSS' THEN 5 WHEN 'CHG' THEN 6 WHEN 'SP' THEN 7 ELSE 8 END`);
  const items=await all(c.env.DB,`
    SELECT class_code,class_name,item_id,item_code,item_name,
      COALESCE(SUM(on_hand_quantity),0) total,COALESCE(SUM(available_quantity),0) available,COALESCE(SUM(leased_quantity),0) leased,COALESCE(SUM(sold_quantity),0) sold,
      COALESCE(SUM(deployed_quantity),0) deployed,COALESCE(SUM(quarantine_quantity),0) quarantine,
      COALESCE(SUM(unvalued_quantity),0) unvalued,ROUND(COALESCE(SUM(inventory_value),0),2) inventory_value
    FROM vw_erp_inventory_by_item_class
    GROUP BY class_code,class_name,item_id,item_code,item_name
    HAVING COALESCE(SUM(quantity),0)>0
    ORDER BY CASE class_code WHEN 'D400' THEN 1 WHEN 'R280' THEN 2 WHEN 'RSPORT' THEN 3 WHEN 'BAT' THEN 4 WHEN 'BSS' THEN 5 WHEN 'CHG' THEN 6 WHEN 'SP' THEN 7 ELSE 8 END,item_name`);
  const from=(c.req.query('from')||'').trim();const to=(c.req.query('to')||'').trim();
  if(from&&to){
    const mv=await all(c.env.DB,`
      SELECT v.class_code cls,
        SUM(CASE WHEN upper(so.transaction_type) LIKE 'SALE%' THEN 1 ELSE 0 END) sold,
        SUM(CASE WHEN upper(so.transaction_type) LIKE 'LEASE%' OR upper(so.transaction_type) LIKE 'RENT%' THEN 1 ELSE 0 END) leased
      FROM erp_sales_lines sl
      JOIN erp_sales_orders so ON so.id=sl.sales_order_id
      JOIN (SELECT DISTINCT item_id,class_code FROM vw_erp_inventory_by_item_class) v ON v.item_id=sl.item_id
      WHERE so.order_date IS NOT NULL AND date(so.order_date) BETWEEN date(?) AND date(?)
      GROUP BY v.class_code`,[from,to]);
    return ok(c,{rows,items,totalItems:items.length,movement:mv,from,to});
  }
  return ok(c,{rows,items,totalItems:items.length});
});

inventoryRoutes.get('/summary', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`SELECT kpi_category category,current_status,reconciliation_status,current_location_code,COUNT(*) qty FROM vw_erp_serialized_assets WHERE active=1 GROUP BY kpi_category,current_status,reconciliation_status,current_location_code ORDER BY kpi_category,current_location_code,current_status`);
  return ok(c,{rows});
});

inventoryRoutes.get('/visibility', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c);
  const locationId=Number(c.req.query('locationId')||0);
  const status=normalizeText(c.req.query('status'));
  const category=normalizeText(c.req.query('category')).toUpperCase();
  const q=`%${normalizeText(c.req.query('q'))}%`;
  const args=[]; const where=['a.active=1'];
  if(locationId){where.push('a.current_location_id=?');args.push(locationId);}
  if(status){where.push('a.current_status=?');args.push(status);}
  if(category){where.push('a.category=?');args.push(category);}
  if(q!=='%%'){
    where.push('(a.serial_no LIKE ? OR a.secondary_serial LIKE ? OR a.item_code LIKE ? OR a.item_name LIKE ? OR l.code LIKE ? OR l.name LIKE ? OR a.current_holder_name LIKE ?)');
    args.push(q,q,q,q,q,q,q);
  }
  const whereSql=where.join(' AND ');
  const rows=await all(c.env.DB,`
    SELECT a.id,a.asset_no,a.serial_no,a.secondary_serial,a.item_code,a.item_name,a.category,
      a.current_status,a.condition_code,a.reconciliation_status,a.current_holder_type,a.current_holder_name,
      a.unit_cost,a.landed_cost,a.cost_source,a.valuation_status,
      l.id location_id,l.code location_code,l.name location_name,l.location_type,a.updated_at
    FROM erp_assets a
    LEFT JOIN erp_locations l ON l.id=a.current_location_id
    WHERE ${whereSql}
    ORDER BY CASE a.category WHEN 'MC' THEN 1 WHEN 'BAT' THEN 2 WHEN 'BSS' THEN 3 WHEN 'CHG' THEN 4 WHEN 'SP' THEN 5 ELSE 6 END,
      a.item_name,a.serial_no
    LIMIT ? OFFSET ?`,[...args,size,offset]);
  const count=await first(c.env.DB,`SELECT COUNT(*) total FROM erp_assets a LEFT JOIN erp_locations l ON l.id=a.current_location_id WHERE ${whereSql}`,args);
  const summary=await first(c.env.DB,`
    SELECT COUNT(*) total_units,
      SUM(CASE WHEN a.current_status='AVAILABLE' THEN 1 ELSE 0 END) available_units,
      SUM(CASE WHEN a.current_status='QUARANTINE' THEN 1 ELSE 0 END) quarantine_units,
      SUM(CASE WHEN a.current_holder_name IS NOT NULL OR a.current_status IN ('ASSIGNED','LEASED','DEMO','PILOT_TEST','EMPLOYEE_ASSIGNED','INTERNAL_ASSIGNED') THEN 1 ELSE 0 END) assigned_units,
      SUM(CASE WHEN a.reconciliation_status!='CLEAR' THEN 1 ELSE 0 END) unreconciled_units,
      SUM(CASE WHEN COALESCE(a.unit_cost,0)<=0 THEN 1 ELSE 0 END) unvalued_units,
      ROUND(COALESCE(SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id) AND a.current_status NOT IN ('SOLD','WRITTEN_OFF') THEN a.unit_cost ELSE 0 END),0),2) inventory_value
    FROM erp_assets a LEFT JOIN erp_locations l ON l.id=a.current_location_id WHERE ${whereSql}`,args);
  const byLocation=await all(c.env.DB,`
    SELECT l.id location_id,l.code location_code,l.name location_name,l.location_type,
      COUNT(a.id) total_units,
      SUM(CASE WHEN a.current_status='AVAILABLE' THEN 1 ELSE 0 END) available_units,
      SUM(CASE WHEN a.current_status='QUARANTINE' THEN 1 ELSE 0 END) quarantine_units,
      SUM(CASE WHEN a.reconciliation_status!='CLEAR' THEN 1 ELSE 0 END) unreconciled_units
    FROM erp_locations l
    LEFT JOIN erp_assets a ON a.current_location_id=l.id AND a.active=1
    WHERE l.active=1 AND l.name NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND COALESCE(l.code,'') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    GROUP BY l.id ORDER BY l.name`);
  return ok(c,{rows,byLocation,summary,page,size,total:Number(count?.total||0)});
});

inventoryRoutes.get('/analysis', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT i.id item_id,i.item_code,i.item_name,i.category,i.standard_cost,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1) on_hand_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND a.current_status='AVAILABLE') available_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND a.current_status='QUARANTINE') quarantine_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND (a.current_holder_id IS NOT NULL OR a.current_status IN ('ASSIGNED','LEASED','DEMO','PILOT_TEST','EMPLOYEE_ASSIGNED','INTERNAL_ASSIGNED'))) deployed_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND COALESCE(a.unit_cost,0)<=0) unvalued_qty,
      (SELECT ROUND(COALESCE(SUM(a.unit_cost),0),2) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1
        AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
        AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)) inventory_value,
      (SELECT COUNT(*) FROM erp_expected_assets e
        JOIN erp_shipments s ON s.id=e.shipment_id
        WHERE e.item_id=i.id AND e.expected_status IN ('EXPECTED','EXPECTED_EXCEPTION')
          AND s.status NOT IN ('CANCELLED','CLOSED')) incoming_qty,
      (SELECT COALESCE(SUM(pol.ordered_qty-pol.received_qty),0)
        FROM erp_purchase_order_lines pol JOIN erp_purchase_orders po ON po.id=pol.purchase_order_id
        WHERE pol.item_id=i.id AND po.status IN ('APPROVED','PARTIALLY_RECEIVED')) open_po_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND a.current_status='LEASED') leased_qty,
      (SELECT COUNT(*) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1 AND a.current_status='SOLD') sold_qty,
      (SELECT l.name FROM erp_assets a JOIN erp_locations l ON l.id=a.current_location_id WHERE a.item_id=i.id AND a.active=1 AND l.name NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' GROUP BY l.id ORDER BY COUNT(*) DESC LIMIT 1) primary_location,
      (SELECT COUNT(DISTINCT a.current_location_id) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1) location_count
    FROM erp_items i
    WHERE i.active=1
    ORDER BY CASE i.category WHEN 'MC' THEN 1 WHEN 'BAT' THEN 2 WHEN 'BSS' THEN 3 WHEN 'CHG' THEN 4 WHEN 'SP' THEN 5 ELSE 6 END,i.item_name`);
  const byStatus=await all(c.env.DB,`
    SELECT current_status status,COUNT(*) qty
    FROM erp_assets WHERE active=1 GROUP BY current_status ORDER BY qty DESC`);
  const totals=rows.reduce((out,row)=>{
    out.items+=1;out.onHand+=Number(row.on_hand_qty||0);out.available+=Number(row.available_qty||0);out.leased+=Number(row.leased_qty||0);out.sold+=Number(row.sold_qty||0);
    out.incoming+=Number(row.incoming_qty||0);out.openPO+=Number(row.open_po_qty||0);
    out.quarantine+=Number(row.quarantine_qty||0);out.unvalued+=Number(row.unvalued_qty||0);
    out.inventoryValue+=Number(row.inventory_value||0);return out;
  },{items:0,onHand:0,available:0,leased:0,sold:0,incoming:0,openPO:0,quarantine:0,unvalued:0,inventoryValue:0});
  return ok(c,{rows,byStatus,totals});
});

inventoryRoutes.get('/valuation', requirePermission('INVENTORY','VIEW'), async c=>{
  const q=`%${normalizeText(c.req.query('q'))}%`;
  const readiness=normalizeText(c.req.query('readiness')).toUpperCase();
  const where=['v.active=1'];const args=[];
  if(q!=='%%'){where.push('(v.serial_no LIKE ? OR v.item_code LIKE ? OR v.item_name LIKE ?)');args.push(q,q,q);}
  if(readiness){where.push('v.finance_readiness=?');args.push(readiness);}
  const rows=await all(c.env.DB,`SELECT v.*,
    x.id exception_id,x.exception_type,x.status exception_status,x.proposed_unit_cost,x.current_unit_cost,
    x.requested_by,x.requested_at,x.approved_by,x.approved_at,x.journal_id
    FROM vw_erp_inventory_valuation_status v
    LEFT JOIN erp_inventory_valuation_exceptions x ON x.id=(
      SELECT x2.id FROM erp_inventory_valuation_exceptions x2
      WHERE x2.asset_id=v.id AND x2.status IN ('OPEN','PENDING_POSTING')
      ORDER BY x2.id DESC LIMIT 1)
    WHERE ${where.join(' AND ')}
    ORDER BY CASE v.finance_readiness WHEN 'BLOCKED_MISSING_COST' THEN 0
      WHEN 'PROVISIONAL_REVIEW_REQUIRED' THEN 1 ELSE 2 END,v.category,v.item_name,v.serial_no LIMIT 5000`,args);
  const summary=await first(c.env.DB,`SELECT COUNT(*) total_assets,
    SUM(CASE WHEN unit_cost>0 THEN 1 ELSE 0 END) valued_assets,
    SUM(CASE WHEN unit_cost<=0 THEN 1 ELSE 0 END) unvalued_assets,
    SUM(CASE WHEN valuation_status='PROVISIONAL_STANDARD' THEN 1 ELSE 0 END) provisional_assets,
    ROUND(COALESCE(SUM(CASE WHEN fixed_asset_book_id IS NULL AND current_status NOT IN ('SOLD','WRITTEN_OFF') THEN unit_cost ELSE 0 END),0),2) inventory_value,
    ROUND(COALESCE(SUM(CASE WHEN fixed_asset_book_id IS NOT NULL THEN net_book_value ELSE 0 END),0),2) fixed_asset_nbv
    FROM vw_erp_inventory_valuation_status WHERE active=1`);
  const exceptions=await first(c.env.DB,`SELECT
    SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) open_exceptions,
    SUM(CASE WHEN status='PENDING_POSTING' THEN 1 ELSE 0 END) pending_posting
    FROM erp_inventory_valuation_exceptions`);
  return ok(c,{rows,summary:{...summary,...exceptions}});
});

inventoryRoutes.post('/valuation/:assetId/request', requirePermission('INVENTORY','EDIT'), async c=>{
  const assetId=Number(c.req.param('assetId'));const b=await jsonBody(c);const user=c.get('erpUser').email;
  const proposed=numberValue(b.proposedUnitCost);const reason=normalizeText(b.reason);
  if(proposed<=0)return fail(c,'Proposed unit cost must be greater than zero.');
  if(reason.length<8)return fail(c,'Provide the invoice, landed-cost basis, or reason for the proposed value.');
  const asset=await first(c.env.DB,`SELECT a.*,f.id fixed_asset_book_id FROM erp_assets a
    LEFT JOIN erp_fixed_asset_books f ON f.asset_id=a.id WHERE a.id=? AND a.active=1`,[assetId]);
  if(!asset)return fail(c,'Serialized asset not found.',404);
  if(asset.fixed_asset_book_id)return fail(c,'This serial is already a fixed asset. Use the fixed-asset revaluation workflow.',409);
  let exception=await first(c.env.DB,`SELECT * FROM erp_inventory_valuation_exceptions
    WHERE asset_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1`,[assetId]);
  if(exception){
    await run(c.env.DB,`UPDATE erp_inventory_valuation_exceptions SET proposed_unit_cost=?,current_unit_cost=?,
      exception_message=?,requested_by=?,requested_at=datetime('now'),resolution_notes=? WHERE id=?`,[
      proposed,Number(asset.unit_cost||0),`Proposed valuation for ${asset.serial_no}: ${reason}`,user,
      `Source: ${normalizeText(b.costSource||'SUPPORTING_DOCUMENT')}`,exception.id,
    ]);
  }else{
    const inserted=await run(c.env.DB,`INSERT INTO erp_inventory_valuation_exceptions(
      asset_id,item_id,serial_no,item_code,exception_type,exception_message,status,proposed_unit_cost,
      current_unit_cost,requested_by,resolution_notes)
      VALUES(?,?,?,?,?,?,'OPEN',?,?,?,?)`,[
      asset.id,asset.item_id,asset.serial_no,asset.item_code,
      Number(asset.unit_cost||0)>0?'VALUATION_CHANGE':'MISSING_UNIT_COST',
      `Proposed valuation for ${asset.serial_no}: ${reason}`,proposed,Number(asset.unit_cost||0),user,
      `Source: ${normalizeText(b.costSource||'SUPPORTING_DOCUMENT')}`,
    ]);
    exception=await first(c.env.DB,`SELECT * FROM erp_inventory_valuation_exceptions WHERE id=?`,[inserted.meta.last_row_id]);
  }
  exception=await first(c.env.DB,`SELECT * FROM erp_inventory_valuation_exceptions WHERE id=?`,[exception.id]);
  await audit(c,{action:'REQUEST_VALUATION',module:'INVENTORY',recordType:'VALUATION_EXCEPTION',
    recordId:exception.id,recordNo:asset.serial_no,after:exception});
  return ok(c,{exception},201);
});

inventoryRoutes.post('/valuation/exceptions/:id/decision', requirePermission('INVENTORY','APPROVE'), async c=>{
  const id=Number(c.req.param('id'));const b=await jsonBody(c);const user=c.get('erpUser').email;
  const decision=normalizeText(b.decision).toUpperCase();
  if(!['APPROVE','REJECT'].includes(decision))return fail(c,'Decision must be approve or reject.');
  const exception=await first(c.env.DB,`SELECT x.*,a.category,a.unit_cost,a.item_id,a.serial_no,a.item_code,
    f.id fixed_asset_book_id FROM erp_inventory_valuation_exceptions x
    JOIN erp_assets a ON a.id=x.asset_id LEFT JOIN erp_fixed_asset_books f ON f.asset_id=a.id
    WHERE x.id=?`,[id]);
  if(!exception)return fail(c,'Valuation request not found.',404);
  if(exception.status!=='OPEN')return fail(c,'Valuation request was already decided.',409);
  if(exception.requested_by===user)return fail(c,'The valuation requester cannot approve the same request.',409);
  if(decision==='REJECT'){
    await run(c.env.DB,`UPDATE erp_inventory_valuation_exceptions SET status='REJECTED',approved_by=?,
      approved_at=datetime('now'),resolution_notes=trim(COALESCE(resolution_notes,'')||' Rejected: '||?) WHERE id=?`,[
      user,normalizeText(b.notes),id,
    ]);
    return ok(c,{status:'REJECTED'});
  }
  if(exception.fixed_asset_book_id)return fail(c,'This serial is already a fixed asset. Use the fixed-asset revaluation workflow.',409);
  const proposed=Number(exception.proposed_unit_cost||0);const current=Number(exception.unit_cost||0);
  if(proposed<=0)return fail(c,'Approved cost must be greater than zero.',409);
  const delta=Math.round((proposed-current)*100)/100;
  if(Math.abs(delta)<0.005){
    await run(c.env.DB,`UPDATE erp_assets SET unit_cost=?,acquisition_cost=?,landed_cost=?,cost_source='APPROVED_VALUATION',
      valuation_status='VALUED',updated_at=datetime('now') WHERE id=?`,[proposed,proposed,proposed,exception.asset_id]);
    await run(c.env.DB,`UPDATE erp_inventory_valuation_exceptions SET status='RESOLVED',approved_by=?,approved_at=datetime('now'),
      resolved_by=?,resolved_at=datetime('now'),resolution_notes=trim(COALESCE(resolution_notes,'')||' No GL delta.') WHERE id=?`,[
      user,user,id,
    ]);
    return ok(c,{status:'RESOLVED',journalRequired:false});
  }
  const event=await captureFinanceEvent(c.env.DB,{
    eventKey:`INVENTORY_VALUATION:${id}`,eventType:'INVENTORY_VALUATION_ADJUSTMENT',sourceModule:'INVENTORY',
    sourceType:'VALUATION_EXCEPTION',sourceId:id,sourceNo:exception.serial_no,
    eventDate:new Date().toISOString().slice(0,10),amount:Math.abs(delta),businessLine:'INVENTORY',
    description:`Approved valuation adjustment for ${exception.serial_no}: ${current.toFixed(2)} to ${proposed.toFixed(2)}`,
    payload:{costAmount:Math.abs(delta),adjustmentDirection:delta>0?'INCREASE':'DECREASE',category:exception.category,
      inventoryAccountCode:inventoryAccountForCategory(exception.category),assetId:exception.asset_id,
      itemId:exception.item_id,serialNo:exception.serial_no,offsetAccountCode:'6900'},
  },user);
  if(event.status==='ERROR')return fail(c,event.error_message||'Valuation journal could not be prepared.',409);
  await run(c.env.DB,`UPDATE erp_inventory_valuation_exceptions SET status='PENDING_POSTING',current_unit_cost=?,
    approved_by=?,approved_at=datetime('now'),finance_event_id=?,journal_id=?,resolution_notes=trim(COALESCE(resolution_notes,'')||' Approved: '||?)
    WHERE id=?`,[current,user,event.id,event.journal_id,normalizeText(b.notes),id]);
  await audit(c,{action:'APPROVE_VALUATION',module:'INVENTORY',recordType:'VALUATION_EXCEPTION',
    recordId:id,recordNo:exception.serial_no,before:exception,after:{status:'PENDING_POSTING',eventId:event.id,journalId:event.journal_id}});
  return ok(c,{status:'PENDING_POSTING',eventId:event.id,journalId:event.journal_id,journalStatus:'SUBMITTED'});
});

inventoryRoutes.get('/plans', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT p.*,sl.code source_location_code,sl.name source_location_name,
      dl.code destination_location_code,dl.name destination_location_name,
      (SELECT COUNT(*) FROM erp_inventory_plan_lines l WHERE l.inventory_plan_id=p.id) line_count,
      (SELECT COALESCE(SUM(planned_qty),0) FROM erp_inventory_plan_lines l WHERE l.inventory_plan_id=p.id) planned_units
    FROM erp_inventory_plans p
    LEFT JOIN erp_locations sl ON sl.id=p.source_location_id
    LEFT JOIN erp_locations dl ON dl.id=p.destination_location_id
    ORDER BY p.plan_date DESC,p.id DESC`);
  return ok(c,{rows,total:rows.length});
});

inventoryRoutes.post('/plans', requirePermission('INVENTORY','CREATE'), async(c)=>{
  const b=await jsonBody(c);
  const planType=normalizeText(b.planType);
  if(!['ORDERING','DEPLOYMENT','REPLENISHMENT'].includes(planType))return fail(c,'Select Ordering, Deployment, or Replenishment.');
  const lines=(Array.isArray(b.lines)?b.lines:[]).filter(line=>numberValue(line.plannedQty)>0);
  if(!lines.length)return fail(c,'Add at least one planned item and quantity.');
  if(planType!=='ORDERING'&&!b.destinationLocationId)return fail(c,'Destination location is required for deployment or replenishment.');
  const planNo=await nextCode(c.env.DB,'INVENTORY_PLAN','IP',7);
  const user=c.get('erpUser').email;
  const created=await run(c.env.DB,`
    INSERT INTO erp_inventory_plans(
      plan_no,plan_type,plan_date,horizon_end,source_location_id,destination_location_id,status,purpose,created_by)
    VALUES(?,?,?,?,?,?,'DRAFT',?,?)`,
    [planNo,planType,b.planDate||new Date().toISOString().slice(0,10),b.horizonEnd||'',
     b.sourceLocationId||null,b.destinationLocationId||null,b.purpose||'',user]);
  let lineNo=0;
  for(const line of lines){
    lineNo+=1;
    const item=await first(c.env.DB,`SELECT * FROM erp_items WHERE id=? AND active=1`,[Number(line.itemId)]);
    if(!item)return fail(c,`Inventory plan line ${lineNo} has an invalid item.`);
    await run(c.env.DB,`
      INSERT INTO erp_inventory_plan_lines(
        inventory_plan_id,line_no,item_id,item_code,description,available_qty,incoming_qty,
        planned_qty,action_type,priority,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [created.meta.last_row_id,lineNo,item.id,item.item_code,item.item_name,numberValue(line.availableQty),
       numberValue(line.incomingQty),numberValue(line.plannedQty),planType,
       normalizeText(line.priority||'NORMAL'),line.reason||'']);
  }
  await audit(c,{action:'CREATE_INVENTORY_PLAN',module:'INVENTORY',recordType:'INVENTORY_PLAN',
    recordId:created.meta.last_row_id,recordNo:planNo,after:{planType,lineCount:lines.length}});
  return ok(c,{id:created.meta.last_row_id,planNo,status:'DRAFT'},201);
});

inventoryRoutes.get('/plans/:id', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`
    SELECT p.*,sl.code source_location_code,sl.name source_location_name,
      dl.code destination_location_code,dl.name destination_location_name
    FROM erp_inventory_plans p
    LEFT JOIN erp_locations sl ON sl.id=p.source_location_id
    LEFT JOIN erp_locations dl ON dl.id=p.destination_location_id
    WHERE p.id=?`,[id]);
  if(!header)return fail(c,'Inventory plan not found',404);
  const lines=await all(c.env.DB,`
    SELECT l.*,i.category FROM erp_inventory_plan_lines l
    LEFT JOIN erp_items i ON i.id=l.item_id
    WHERE l.inventory_plan_id=? ORDER BY l.line_no`,[id]);
  return ok(c,{header,lines});
});

inventoryRoutes.post('/plans/:id/approve', requirePermission('INVENTORY','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const plan=await first(c.env.DB,`SELECT * FROM erp_inventory_plans WHERE id=?`,[id]);
  if(!plan)return fail(c,'Inventory plan not found',404);
  if(plan.status!=='DRAFT')return fail(c,'Only a draft inventory plan can be approved.',409);
  await run(c.env.DB,`
    UPDATE erp_inventory_plans SET status='APPROVED',approved_by=?,approved_at=datetime('now') WHERE id=?`,
    [c.get('erpUser').email,id]);
  await audit(c,{action:'APPROVE_INVENTORY_PLAN',module:'INVENTORY',recordType:'INVENTORY_PLAN',
    recordId:id,recordNo:plan.plan_no});
  return ok(c,{status:'APPROVED'});
});

inventoryRoutes.get('/movements', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT sl.*,i.item_name,fl.name from_location_name,tl.name to_location_name
    FROM erp_stock_ledger sl
    LEFT JOIN erp_items i ON i.id=sl.item_id
    LEFT JOIN erp_locations fl ON fl.id=sl.from_location_id
    LEFT JOIN erp_locations tl ON tl.id=sl.to_location_id
    ORDER BY sl.movement_date DESC,sl.id DESC LIMIT 1000`);
  return ok(c,{rows,total:rows.length});
});

inventoryRoutes.get('/cycle-counts', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`
    SELECT cc.*,l.code location_code,l.name location_name,l.location_type
    FROM erp_cycle_counts cc
    JOIN erp_locations l ON l.id=cc.location_id
    WHERE (cc.status<>'CANCELLED' OR ?='1')
    ORDER BY cc.count_date DESC,cc.id DESC`,
    [normalizeText(c.req.query('includeCancelled'))==='1'?'1':'0']);
  return ok(c,{rows,total:rows.length});
});

inventoryRoutes.post('/cycle-counts', requirePermission('INVENTORY','CREATE'), async(c)=>{
  const b=await jsonBody(c);
  const location=await first(c.env.DB,`SELECT * FROM erp_locations WHERE id=? AND active=1`,[Number(b.locationId)]);
  if(!location)return fail(c,'Select an active warehouse or retail location.');
  const category=normalizeText(b.category);
  const args=[location.id];
  const categorySql=category?' AND category=?':'';
  if(category)args.push(category);
  const assets=await all(c.env.DB,`
    SELECT * FROM erp_assets
    WHERE active=1 AND current_location_id=?
      AND current_status NOT IN ('SOLD','LEASED','DELIVERED','RETURNED_TO_VENDOR')
      ${categorySql}
    ORDER BY category,item_name,serial_no`,args);
  const countNo=await nextCode(c.env.DB,'CYCLE_COUNT','CC',7);
  const user=c.get('erpUser').email;
  const countDate=b.countDate||new Date().toISOString().slice(0,10);
  const created=await run(c.env.DB,`
    INSERT INTO erp_cycle_counts(count_no,location_id,category,count_date,status,assigned_to,instructions,expected_units,created_by)
    VALUES(?,?,?,?, 'OPEN',?,?,?,?)`,
    [countNo,location.id,category,countDate,b.assignedTo||'',b.instructions||'',assets.length,user]);
  const countId=created.meta.last_row_id;
  for(const asset of assets){
    await run(c.env.DB,`
      INSERT INTO erp_cycle_count_lines(
        cycle_count_id,expected_asset_id,expected_serial_no,expected_item_id,expected_location_id,count_status)
      VALUES(?,?,?,?,?,'NOT_COUNTED')`,
      [countId,asset.id,asset.serial_no,asset.item_id,location.id]);
  }
  await audit(c,{action:'CREATE_CYCLE_COUNT',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:countId,recordNo:countNo,after:{locationCode:location.code,category,expectedUnits:assets.length}});
  return ok(c,{id:countId,countNo,expectedUnits:assets.length,location},201);
});

inventoryRoutes.get('/cycle-counts/:id', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const header=await first(c.env.DB,`
    SELECT cc.*,l.code location_code,l.name location_name,l.location_type
    FROM erp_cycle_counts cc JOIN erp_locations l ON l.id=cc.location_id
    WHERE cc.id=?`,[id]);
  if(!header)return fail(c,'Cycle count not found',404);
  const lines=await all(c.env.DB,`
    SELECT ccl.*,COALESCE(NULLIF(i.item_code,''),NULLIF(nu.item_code,'')) item_code,
      -- A counted unit identified only by its code still shows the master's
      -- description: ni resolves nu.item_code against the item master.
      COALESCE(NULLIF(i.item_name,''),NULLIF(nu.item_name,''),NULLIF(ni.item_name,'')) item_name,
      a.current_status,COALESCE(a.condition_code,nu.condition_code) condition_code,
      al.code actual_location_code,al.name actual_location_name,
      COALESCE(NULLIF(nu.category,''),ni.category) new_category,
      nu.serial_type new_serial_type,nu.motor_no new_motor_no,
      nu.secondary_serial new_secondary_serial,
      COALESCE(NULLIF(nu.unit_cost,0),ni.standard_cost) new_unit_cost,
      nu.status new_status,
      CASE WHEN nu.line_id IS NOT NULL THEN 1 ELSE 0 END is_new_unit,
      -- A serial nobody can find on the shelf is not missing if it is standing
      -- in a customer's yard. The count has to be told, or it reports a loss
      -- every cycle against a unit the company knows the whereabouts of.
      dep.customer_name deployed_customer,
      dep.deployed_at deployed_at,
      dl.lease_no deployed_lease_no
    FROM erp_cycle_count_lines ccl
    LEFT JOIN erp_asset_deployments dep
      ON dep.serial_no=COALESCE(ccl.expected_serial_no,ccl.actual_serial_no)
     AND dep.returned_at IS NULL
    LEFT JOIN erp_lease_contracts dl ON dl.id=dep.lease_contract_id
    LEFT JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
    LEFT JOIN erp_items i ON i.id=COALESCE(ccl.expected_item_id,a.item_id)
    LEFT JOIN erp_cycle_count_new_units nu ON nu.line_id=ccl.id
    -- erp_items.item_code is UNIQUE, but that constraint is case-sensitive, so
    -- matching on UPPER() could in principle hit two rows and duplicate every
    -- line on the sheet. Collapse to one id first: a count sheet must never
    -- grow rows just because the master has odd casing.
    LEFT JOIN (SELECT UPPER(item_code) k,MIN(id) id FROM erp_items GROUP BY UPPER(item_code)) nik
      ON nik.k=UPPER(nu.item_code)
    LEFT JOIN erp_items ni ON ni.id=nik.id
    LEFT JOIN erp_locations al ON al.id=ccl.actual_location_id
    WHERE ccl.cycle_count_id=?
    ORDER BY CASE ccl.count_status WHEN 'VARIANCE' THEN 0 WHEN 'NOT_COUNTED' THEN 1 ELSE 2 END,
      i.item_name,COALESCE(ccl.expected_serial_no,ccl.actual_serial_no)`,[id]);
  const summary=lines.reduce((out,row)=>{
    out.expected+=row.expected_asset_id?1:0;
    if(row.actual_serial_no)out.counted+=1;
    if(row.variance_type)out.variances+=1;
    // Not found on the shelf but out with a customer is an explained absence.
    // It is still a variance against this location; it is not a loss, and the
    // two are counted apart so the missing figure means what it says.
    if(row.variance_type==='MISSING')row.deployed_customer?out.withCustomer+=1:out.missing+=1;
    if(['UNEXPECTED_SERIAL','UNKNOWN_SERIAL'].includes(row.variance_type))out.unexpected+=1;
    if(row.variance_type==='LOCATION_MISMATCH')out.locationMismatch+=1;
    return out;
  },{expected:0,counted:0,variances:0,missing:0,withCustomer:0,unexpected:0,locationMismatch:0});
  return ok(c,{header,lines,summary});
});

// A counted line is editable and removable until the count is submitted: the
// counter scans first and identifies the unit afterwards, and a mis-scan has to
// be removable rather than left to pollute the opening balance.
async function openCountLine(c,id,lineId){
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return {error:'Cycle count not found',code:404};
  if(count.status!=='OPEN')
    return {error:`This count is ${String(count.status).toLowerCase()} and can no longer be edited.`,code:409};
  const line=await first(c.env.DB,`SELECT * FROM erp_cycle_count_lines WHERE id=? AND cycle_count_id=?`,[lineId,id]);
  if(!line)return {error:'Count line not found on this sheet.',code:404};
  return {count,line};
}

/*
 * An item code that already exists in the master carries its own name, class and
 * standard cost. Somebody counting on the floor should only ever have to type
 * the code - anything the master already knows is filled in for them, and only
 * what they type themselves overrides it.
 */
async function fillFromItemMaster(db,supplied){
  const code=normalizeText(supplied.itemCode);
  const out={itemCode:code,itemName:normalizeText(supplied.itemName),
    category:normalizeText(supplied.category),unitCost:Number(supplied.unitCost)||0,itemId:null};
  if(!code)return out;
  const row=await first(db,
    // An exact match wins over a case-insensitive one, so a code typed exactly
    // as the master holds it always resolves to that row.
    `SELECT id,item_code,item_name,category,standard_cost FROM erp_items
     WHERE UPPER(item_code)=UPPER(?) ORDER BY CASE WHEN item_code=? THEN 0 ELSE 1 END,id LIMIT 1`,[code,code]);
  if(!row)return out;
  out.itemId=row.id;
  out.itemCode=row.item_code;
  if(!out.itemName)out.itemName=row.item_name||'';
  if(!out.category)out.category=row.category||'';
  if(!(out.unitCost>0))out.unitCost=Number(row.standard_cost||0);
  return out;
}

async function refreshCountTotals(db,id){
  const t=await first(db,`
    SELECT COUNT(CASE WHEN actual_serial_no IS NOT NULL THEN 1 END) counted,
      COUNT(CASE WHEN variance_type IS NOT NULL AND variance_type!='' THEN 1 END) variances
    FROM erp_cycle_count_lines WHERE cycle_count_id=?`,[id]);
  await run(db,`UPDATE erp_cycle_counts SET counted_units=?,variance_units=? WHERE id=?`,
    [t?.counted||0,t?.variances||0,id]);
  return t;
}

// ---------------------------------------------------------------------------
// Count sheet upload.
//
// Not everyone counts with a phone. A team with a clipboard types the serials
// into a spreadsheet, and this takes that file. One row per physical unit, which
// is the same shape a scan produces, so there is no second code path to keep in
// step with scanning.
//
//   serial_no,item_code,item_name,category,serial_type,secondary_serial,motor_no,unit_cost,condition,remarks
//
// Only serial_no is required. Everything else fills in what the "identify this
// unit" dialog would have asked for.
// ---------------------------------------------------------------------------
export const COUNT_IMPORT_COLUMNS = ['serial_no','item_code','item_name','category',
  'serial_type','secondary_serial','motor_no','unit_cost','condition','remarks'];

function parseCsv(text){
  const rows=[];let row=[];let cell='';let quoted=false;
  const src=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(quoted){
      if(ch==='"'){ if(src[i+1]==='"'){cell+='"';i++;} else quoted=false; }
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','||ch===';'&&false){row.push(cell);cell='';}
    else if(ch==='\r'){/* ignore */}
    else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(v=>String(v).trim()!==''));
}

const headerKey=h=>String(h||'').trim().toLowerCase().replace(/[\s-]+/g,'_');

// A plan raised by mistake can be removed while it is still OPEN.
//
// Nothing is actually destroyed: the plan is marked CANCELLED and drops out of
// the register. A count sheet is a record of what somebody physically did, and
// deleting the rows would take that away along with who scanned what and when.
// Cancelling keeps it recoverable and keeps the audit trail intact.
inventoryRoutes.delete('/cycle-counts/:id', requirePermission('INVENTORY','EDIT'), async(c)=>{
  const id=Number(c.req.param('id'));
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='OPEN')
    return fail(c,`Only an open count plan can be removed. ${count.count_no} is ${String(count.status).toLowerCase()}.`,409);
  await run(c.env.DB,`UPDATE erp_cycle_counts SET status='CANCELLED' WHERE id=?`,[id]);
  await audit(c,{action:'CANCEL_CYCLE_COUNT',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no,before:count,after:{status:'CANCELLED'}});
  return ok(c,{deleted:true,cancelled:true,countNo:count.count_no,
    note:'The plan is cancelled and hidden from the register. Nothing was erased.'});
});

inventoryRoutes.post('/cycle-counts/:id/import', requirePermission('INVENTORY','CREATE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const b=await jsonBody(c);
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='OPEN')return fail(c,`This count is ${String(count.status).toLowerCase()} and can no longer be added to.`,409);

  const grid=parseCsv(b.csv);
  if(!grid.length)return fail(c,'The file is empty.');
  const header=grid[0].map(headerKey);
  if(!header.includes('serial_no')){
    return fail(c,'The first row must be a header containing serial_no. Download the template from this screen and fill it in.');
  }
  const idx=Object.fromEntries(COUNT_IMPORT_COLUMNS.map(k=>[k,header.indexOf(k)]));
  const at=(r,k)=>idx[k]>=0?normalizeText(r[idx[k]]):'';

  const commit=b.commit===true;
  const user=c.get('erpUser').email;
  const seen=new Set();
  const results=[];
  let added=0;

  for(let n=1;n<grid.length;n++){
    const r=grid[n];
    const rowNo=n+1;
    const serial=normalizeSerial(at(r,'serial_no'));
    if(!serial){results.push({rowNo,serial:'',status:'SKIPPED',message:'No serial on this row.'});continue;}
    if(seen.has(serial)){results.push({rowNo,serial,status:'DUPLICATE',message:'This serial appears more than once in the file.'});continue;}
    seen.add(serial);

    const already=await first(c.env.DB,
      `SELECT id FROM erp_cycle_count_lines WHERE cycle_count_id=? AND actual_serial_no=?`,[id,serial]);
    if(already){results.push({rowNo,serial,status:'ALREADY_COUNTED',message:'Already on this count sheet.'});continue;}

    const expected=await first(c.env.DB,
      `SELECT * FROM erp_cycle_count_lines WHERE cycle_count_id=? AND expected_serial_no=?`,[id,serial]);
    const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[serial]);
    const itemCode=at(r,'item_code');
    const status=expected
      ? (Number(asset?.current_location_id||0)!==Number(count.location_id)?'LOCATION_MISMATCH':'COUNTED')
      : (asset?'LOCATION_MISMATCH':'NEW_UNIT');
    const note=status==='NEW_UNIT'&&!itemCode?'Will be registered, flagged for review (no item code).':'';

    if(!commit){results.push({rowNo,serial,status,itemCode,message:note});continue;}

    if(expected){
      await run(c.env.DB,`UPDATE erp_cycle_count_lines SET actual_asset_id=?,actual_serial_no=?,
        actual_location_id=?,count_status=?,variance_type=?,scan_method='UPLOAD',scanned_by=?,
        scanned_at=datetime('now'),notes=? WHERE id=?`,
        [asset?.id||null,serial,asset?.current_location_id||null,
         status==='COUNTED'?'COUNTED':'VARIANCE',status==='COUNTED'?null:'LOCATION_MISMATCH',
         user,at(r,'remarks'),expected.id]);
    }else{
      const ins=await run(c.env.DB,`INSERT INTO erp_cycle_count_lines(
        cycle_count_id,actual_asset_id,actual_serial_no,actual_location_id,count_status,variance_type,
        scan_method,scanned_by,scanned_at,notes)
        VALUES(?,?,?,?,'VARIANCE',?,'UPLOAD',?,datetime('now'),?)`,
        [id,asset?.id||null,serial,asset?.current_location_id||null,
         asset?'LOCATION_MISMATCH':'UNKNOWN_SERIAL',user,at(r,'remarks')]);
      if(!asset){
        const m=await fillFromItemMaster(c.env.DB,{itemCode,itemName:at(r,'item_name'),
          category:at(r,'category'),unitCost:at(r,'unit_cost')});
        await run(c.env.DB,`INSERT OR REPLACE INTO erp_cycle_count_new_units(
          line_id,item_code,item_name,category,serial_type,secondary_serial,motor_no,
          unit_cost,condition_code,status,captured_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [ins.meta.last_row_id,m.itemCode,m.itemName,
           m.category||count.category||'OTH',at(r,'serial_type')||'SERIAL',
           at(r,'secondary_serial'),at(r,'motor_no'),m.unitCost,
           at(r,'condition')||'GOOD','AVAILABLE',user]);
      }
    }
    added+=1;
    results.push({rowNo,serial,status,itemCode,message:note});
  }

  const summary=results.reduce((o,x)=>{o[x.status]=(o[x.status]||0)+1;return o;},{});
  if(commit){
    await refreshCountTotals(c.env.DB,id);
    await audit(c,{action:'IMPORT_COUNT_SHEET',module:'INVENTORY',recordType:'CYCLE_COUNT',
      recordId:id,recordNo:count.count_no,after:{added,summary}});
  }
  return ok(c,{preview:!commit,added,rows:results,summary,
    totalRows:grid.length-1,columns:COUNT_IMPORT_COLUMNS});
});

inventoryRoutes.patch('/cycle-counts/:id/lines/:lineId', requirePermission('INVENTORY','EDIT'), async(c)=>{
  const id=Number(c.req.param('id'));const lineId=Number(c.req.param('lineId'));
  const {line,error,code}=await openCountLine(c,id,lineId);
  if(error)return fail(c,error,code);
  const b=await jsonBody(c);

  // Correcting a mis-typed serial re-tests it against the sheet.
  let serial=line.actual_serial_no;
  if(normalizeSerial(b.serialNo)&&normalizeSerial(b.serialNo)!==serial){
    serial=normalizeSerial(b.serialNo);
    const clash=await first(c.env.DB,
      `SELECT id FROM erp_cycle_count_lines WHERE cycle_count_id=? AND actual_serial_no=? AND id<>?`,[id,serial,lineId]);
    if(clash)return fail(c,`Serial ${serial} is already on this count sheet.`,409);
    const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[serial]);
    await run(c.env.DB,`UPDATE erp_cycle_count_lines SET actual_serial_no=?,actual_asset_id=?,
      actual_location_id=?,variance_type=CASE WHEN ?='' THEN variance_type ELSE ? END WHERE id=?`,
      [serial,asset?.id||null,asset?.current_location_id||null,
       asset?'':'UNKNOWN_SERIAL',asset?'LOCATION_MISMATCH':'UNKNOWN_SERIAL',lineId]);
  }

  const known=await first(c.env.DB,`SELECT actual_asset_id FROM erp_cycle_count_lines WHERE id=?`,[lineId]);
  if(!known?.actual_asset_id){
    // Identify what the unit actually is, so posting can register it properly.
    const prev=await first(c.env.DB,`SELECT * FROM erp_cycle_count_new_units WHERE line_id=?`,[lineId])||{};
    const pick=(k,fallback)=>b[k]===undefined?fallback:normalizeText(b[k]);
    const m=await fillFromItemMaster(c.env.DB,{
      itemCode:pick('itemCode',prev.item_code),
      itemName:pick('itemName',prev.item_name),
      category:pick('category',prev.category),
      unitCost:b.unitCost===undefined?Number(prev.unit_cost||0):Number(b.unitCost)||0});
    await run(c.env.DB,`INSERT OR REPLACE INTO erp_cycle_count_new_units(
      line_id,item_code,item_name,category,serial_type,secondary_serial,motor_no,
      unit_cost,condition_code,status,captured_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [lineId,m.itemCode,m.itemName,
       m.category||'OTH',pick('serialType',prev.serial_type)||'SERIAL',
       pick('secondarySerial',prev.secondary_serial),pick('motorNo',prev.motor_no),
       m.unitCost,
       pick('conditionCode',prev.condition_code)||'GOOD',
       pick('status',prev.status)||'AVAILABLE',c.get('erpUser').email]);
  }
  if(b.notes!==undefined)await run(c.env.DB,`UPDATE erp_cycle_count_lines SET notes=? WHERE id=?`,[normalizeText(b.notes),lineId]);

  const after=await first(c.env.DB,`SELECT * FROM erp_cycle_count_lines WHERE id=?`,[lineId]);
  const detail=await first(c.env.DB,`SELECT * FROM erp_cycle_count_new_units WHERE line_id=?`,[lineId]);
  await audit(c,{action:'EDIT_COUNT_LINE',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:String(lineId),after:{serial:after?.actual_serial_no,item:detail?.item_code}});
  return ok(c,{line:after,detail:detail||null});
});

inventoryRoutes.delete('/cycle-counts/:id/lines/:lineId', requirePermission('INVENTORY','EDIT'), async(c)=>{
  const id=Number(c.req.param('id'));const lineId=Number(c.req.param('lineId'));
  const {line,error,code}=await openCountLine(c,id,lineId);
  if(error)return fail(c,error,code);
  if(line.expected_serial_no){
    // The sheet expected this unit. Removing the row would hide the fact that it
    // was not found, so the scan is undone and the line goes back to NOT_COUNTED.
    await run(c.env.DB,`UPDATE erp_cycle_count_lines SET actual_asset_id=NULL,actual_serial_no=NULL,
      actual_location_id=NULL,count_status='NOT_COUNTED',variance_type=NULL,scan_method=NULL,
      scanned_by=NULL,scanned_at=NULL,notes='' WHERE id=?`,[lineId]);
    await run(c.env.DB,`DELETE FROM erp_cycle_count_new_units WHERE line_id=?`,[lineId]);
    const totals=await refreshCountTotals(c.env.DB,id);
    await audit(c,{action:'UNDO_COUNT_SCAN',module:'INVENTORY',recordType:'CYCLE_COUNT',
      recordId:id,recordNo:String(lineId),before:{serial:line.actual_serial_no}});
    return ok(c,{removed:false,reset:true,serial:line.actual_serial_no,totals});
  }
  await run(c.env.DB,`DELETE FROM erp_cycle_count_new_units WHERE line_id=?`,[lineId]);
  await run(c.env.DB,`DELETE FROM erp_cycle_count_lines WHERE id=?`,[lineId]);
  const totals=await refreshCountTotals(c.env.DB,id);
  await audit(c,{action:'DELETE_COUNT_LINE',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:String(lineId),before:{serial:line.actual_serial_no}});
  return ok(c,{removed:true,serial:line.actual_serial_no,totals});
});

inventoryRoutes.post('/cycle-counts/:id/scan', requirePermission('INVENTORY','CREATE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const b=await jsonBody(c);
  const serial=normalizeSerial(b.serialNo||b.qrPayload);
  if(!serial)return fail(c,'Scan or enter a serial number.');
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='OPEN')return fail(c,`Cycle count is ${count.status}.`,409);
  const already=await first(c.env.DB,`
    SELECT id,count_status,variance_type FROM erp_cycle_count_lines
    WHERE cycle_count_id=? AND actual_serial_no=?`,[id,serial]);
  if(already)return fail(c,`Serial ${serial} was already counted.`,409);
  const user=c.get('erpUser').email;
  const method=normalizeText(b.scanMethod||'QR');
  const expected=await first(c.env.DB,`
    SELECT * FROM erp_cycle_count_lines
    WHERE cycle_count_id=? AND expected_serial_no=?`,[id,serial]);
  let result;
  if(expected){
    const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE id=?`,[expected.expected_asset_id]);
    const mismatch=Number(asset?.current_location_id||0)!==Number(count.location_id);
    await run(c.env.DB,`
      UPDATE erp_cycle_count_lines
      SET actual_asset_id=?,actual_serial_no=?,actual_location_id=?,
        count_status=?,variance_type=?,scan_method=?,scanned_by=?,scanned_at=datetime('now'),notes=?
      WHERE id=?`,
      [asset?.id||null,serial,asset?.current_location_id||null,mismatch?'VARIANCE':'COUNTED',
       mismatch?'LOCATION_MISMATCH':null,method,user,
       mismatch?'Serial is registered in a different location.':'',expected.id]);
    result={lineId:expected.id,serial,countStatus:mismatch?'VARIANCE':'COUNTED',
      varianceType:mismatch?'LOCATION_MISMATCH':null};
  }else{
    const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[serial]);
    const varianceType=asset?'LOCATION_MISMATCH':'UNKNOWN_SERIAL';
    const inserted=await run(c.env.DB,`
      INSERT INTO erp_cycle_count_lines(
        cycle_count_id,actual_asset_id,actual_serial_no,actual_location_id,count_status,variance_type,
        scan_method,scanned_by,scanned_at,notes)
      VALUES(?,?,?,?, 'VARIANCE',?,?,?,datetime('now'),?)`,
      [id,asset?.id||null,serial,asset?.current_location_id||null,varianceType,method,user,
       asset?'Serial belongs to another registered location.':'Counted on the floor but not yet registered - will be created when the count is posted.']);
    const lineId=inserted.meta.last_row_id;
    // A unit that is not in the system at all is what a first physical count is
    // mostly made of. Keep whatever the counter can tell us about it so that
    // posting the count registers it rather than discarding it.
    if(!asset){
      const m=await fillFromItemMaster(c.env.DB,
        {itemCode:b.itemCode,itemName:b.itemName,category:b.category,unitCost:b.unitCost});
      await run(c.env.DB,`INSERT OR REPLACE INTO erp_cycle_count_new_units(
        line_id,item_code,item_name,category,serial_type,secondary_serial,motor_no,
        unit_cost,condition_code,status,captured_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [lineId,m.itemCode,m.itemName,
         m.category||normalizeText(count.category)||'OTH',
         normalizeText(b.serialType)||'SERIAL',normalizeText(b.secondarySerial),normalizeText(b.motorNo),
         m.unitCost,normalizeText(b.conditionCode)||'GOOD',
         normalizeText(b.status)||'AVAILABLE',user]);
    }
    result={lineId,serial,countStatus:'VARIANCE',varianceType,
      willRegister:!asset,needsItemDetail:!asset&&!normalizeText(b.itemCode)};
  }
  const totals=await first(c.env.DB,`
    SELECT COUNT(CASE WHEN actual_serial_no IS NOT NULL THEN 1 END) counted,
      COUNT(CASE WHEN variance_type IS NOT NULL AND variance_type!='' THEN 1 END) variances
    FROM erp_cycle_count_lines WHERE cycle_count_id=?`,[id]);
  await run(c.env.DB,`
    UPDATE erp_cycle_counts SET counted_units=?,variance_units=? WHERE id=?`,
    [totals?.counted||0,totals?.variances||0,id]);
  await audit(c,{action:'CYCLE_COUNT_SCAN',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no,after:result});
  return ok(c,{result,totals});
});

inventoryRoutes.post('/cycle-counts/:id/submit', requirePermission('INVENTORY','POST'), async(c)=>{
  const id=Number(c.req.param('id'));
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='OPEN')return fail(c,`Cycle count is ${count.status}.`,409);
  // Counting is open to the floor, but closing the sheet is not. The first
  // approver initiates the submit, which is also their signature on step one.
  const submitUser=c.get('erpUser');
  const submitRole=String(submitUser.role_code||submitUser.role||'').toUpperCase();
  const chainOn=await countChainOn(c.env.DB);
  if(chainOn&&!COUNT_CHAIN_ROLES.DEPT_MANAGER.includes(submitRole)){
    return fail(c,'Only the department manager or department head can submit a count for approval.',403);
  }
  await run(c.env.DB,`
    UPDATE erp_cycle_count_lines
    SET count_status='VARIANCE',variance_type='MISSING',notes='Expected serial was not physically counted.'
    WHERE cycle_count_id=? AND count_status='NOT_COUNTED'`,[id]);
  const totals=await first(c.env.DB,`
    SELECT COUNT(CASE WHEN actual_serial_no IS NOT NULL THEN 1 END) counted,
      COUNT(CASE WHEN variance_type IS NOT NULL AND variance_type!='' THEN 1 END) variances
    FROM erp_cycle_count_lines WHERE cycle_count_id=?`,[id]);
  await run(c.env.DB,`
    UPDATE erp_cycle_counts
    SET status='SUBMITTED',counted_units=?,variance_units=?,submitted_by=?,submitted_at=datetime('now')
    WHERE id=?`,[totals?.counted||0,totals?.variances||0,c.get('erpUser').email,id]);
  // Submitting starts the chain rather than handing the count straight to one
  // approver. A resubmitted count gets a clean set of steps.
  if(chainOn){
    await run(c.env.DB,`DELETE FROM erp_cycle_count_approvals WHERE cycle_count_id=?`,[id]);
    for(let i=0;i<COUNT_CHAIN.length;i+=1){
      await run(c.env.DB,`INSERT INTO erp_cycle_count_approvals(cycle_count_id,step_no,stage)
        VALUES(?,?,?)`,[id,i+1,COUNT_CHAIN[i]]);
    }
    // Submitting IS the first approval, so it is recorded as one rather than
    // asking the same person to press approve straight afterwards.
    await run(c.env.DB,`UPDATE erp_cycle_count_approvals
      SET status='APPROVED',decided_by=?,decided_at=datetime('now'),remarks='Initiated the submit'
      WHERE cycle_count_id=? AND stage='DEPT_MANAGER'`,[submitUser.email,id]);
  }
  const waiting=chainOn?await currentCountStep(c.env.DB,id):null;
  await audit(c,{action:'SUBMIT_CYCLE_COUNT',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no,after:{...totals,submittedBy:submitUser.email}});
  return ok(c,{status:'SUBMITTED',totals,chain:chainOn?COUNT_CHAIN:null,
    waitingOn:waiting?waiting.stage:null});
});

/*
 * A submitted count is signed by three people before anything posts:
 * Department Manager, then Department Head, then Finance. The count only
 * becomes APPROVED - and therefore postable - when the last step signs.
 */
const COUNT_CHAIN = ['DEPT_MANAGER','DEPT_HEAD','FINANCE'];
const COUNT_CHAIN_ROLES = {
  DEPT_MANAGER:['DEPT_MANAGER','DEPARTMENT_MANAGER','SCM_MANAGER','SCM_HEAD','DEPTHEAD','DEPT_HEAD','DEPARTMENT_HEAD'],
  DEPT_HEAD:['DEPTHEAD','DEPT_HEAD','DEPARTMENT_HEAD','SCM_HEAD'],
  FINANCE:['FINANCE','FINANCE_MANAGER','CONTROLLER','ACCOUNTING'],
};
async function countChainOn(db){
  const row=await first(db,`SELECT value FROM erp_settings WHERE key='cycle_count_chain'`);
  return String(row&&row.value!=null?row.value:'1')==='1';
}
async function currentCountStep(db,id){
  return await first(db,`SELECT * FROM erp_cycle_count_approvals
    WHERE cycle_count_id=? AND status='PENDING' ORDER BY step_no LIMIT 1`,[id]);
}
inventoryRoutes.get('/cycle-counts/:id/chain', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const steps=await all(c.env.DB,`SELECT * FROM erp_cycle_count_approvals
    WHERE cycle_count_id=? ORDER BY step_no`,[id]);
  return ok(c,{steps,pending:steps.find(s=>s.status==='PENDING')||null});
});

inventoryRoutes.post('/cycle-counts/:id/approve', requirePermission('INVENTORY','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const b=await jsonBody(c).catch(()=>({}));
  const user=c.get('erpUser');
  const role=String(user.role_code||user.role||'').toUpperCase();
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='SUBMITTED')return fail(c,'Only a submitted cycle count can be approved.',409);

  if(await countChainOn(c.env.DB)){
    const step=await currentCountStep(c.env.DB,id);
    if(!step)return fail(c,'This count has no pending approval step.',409);
    const allowed=COUNT_CHAIN_ROLES[step.stage]||[];
    if(!allowed.includes(role))
      return fail(c,`This count is waiting on ${step.stage.replace(/_/g,' ').toLowerCase()} approval.`,403);
    // Nobody signs their own count, and nobody signs twice in the same chain.
    if(String(count.submitted_by||'').toLowerCase()===String(user.email).toLowerCase())
      return fail(c,'You submitted this count, so you cannot approve it.',409);
    const already=await first(c.env.DB,`SELECT id FROM erp_cycle_count_approvals
      WHERE cycle_count_id=? AND LOWER(COALESCE(decided_by,''))=? AND status='APPROVED'`,
      [id,String(user.email).toLowerCase()]);
    if(already)return fail(c,'You have already signed this count at an earlier step.',409);

    await run(c.env.DB,`UPDATE erp_cycle_count_approvals
      SET status='APPROVED',decided_by=?,decided_at=datetime('now'),remarks=? WHERE id=?`,
      [user.email,normalizeText(b.remarks),step.id]);
    const next=await currentCountStep(c.env.DB,id);
    if(next){
      await audit(c,{action:'APPROVE_CYCLE_COUNT_STEP',module:'INVENTORY',recordType:'CYCLE_COUNT',
        recordId:id,recordNo:count.count_no,after:{signed:step.stage,waitingOn:next.stage}});
      return ok(c,{status:'SUBMITTED',signed:step.stage,waitingOn:next.stage});
    }
  }

  await run(c.env.DB,`
    UPDATE erp_cycle_counts SET status='APPROVED',approved_by=?,approved_at=datetime('now') WHERE id=?`,
    [c.get('erpUser').email,id]);
  await captureFinanceEvent(c.env.DB,{
    eventKey:`CYCLE_COUNT_REVIEW:${id}`,eventType:'CYCLE_COUNT_REVIEW',sourceModule:'INVENTORY',
    sourceType:'CYCLE_COUNT',sourceId:id,sourceNo:count.count_no,
    eventDate:new Date().toISOString().slice(0,10),amount:0,financialEffect:'NONE',
    description:`Approved physical count ${count.count_no}; adjustments pending posting`,
  },c.get('erpUser').email);
  await audit(c,{action:'APPROVE_CYCLE_COUNT',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no});
  return ok(c,{status:'APPROVED'});
});

inventoryRoutes.post('/cycle-counts/:id/post-adjustments', requirePermission('INVENTORY','POST'), async(c)=>{
  const id=Number(c.req.param('id'));
  const count=await first(c.env.DB,`SELECT cc.*,l.code location_code FROM erp_cycle_counts cc
    JOIN erp_locations l ON l.id=cc.location_id WHERE cc.id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='APPROVED')return fail(c,'Only an approved cycle count can post inventory adjustments.',409);
  // Posting writes the count into inventory and into the ledger, so Finance
  // does it - the same hand that signs the last approval.
  const postRole=String(c.get('erpUser').role_code||c.get('erpUser').role||'').toUpperCase();
  if(await countChainOn(c.env.DB)&&!COUNT_CHAIN_ROLES.FINANCE.includes(postRole)){
    return fail(c,'Only Finance can post a physical count to inventory.',403);
  }
  const lines=await all(c.env.DB,`SELECT ccl.*,a.unit_cost,a.category,a.item_id,
      dep.customer_name deployed_customer,dl.lease_no deployed_lease_no
    FROM erp_cycle_count_lines ccl
    LEFT JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
    LEFT JOIN erp_asset_deployments dep
      ON dep.serial_no=COALESCE(ccl.expected_serial_no,ccl.actual_serial_no)
     AND dep.returned_at IS NULL
    LEFT JOIN erp_lease_contracts dl ON dl.id=dep.lease_contract_id
    WHERE ccl.cycle_count_id=? AND ccl.variance_type IS NOT NULL AND ccl.variance_type!=''`,[id]);
  let decrease=0;let moved=0;let unresolved=0;let registered=0;let withCustomer=0;const registeredSerials=[];
  const user=c.get('erpUser').email;
  for(const line of lines){
    const assetId=line.actual_asset_id||line.expected_asset_id;
    const asset=assetId?await first(c.env.DB,`SELECT * FROM erp_assets WHERE id=?`,[assetId]):null;
    // A unit counted on the floor that the system has never seen. This is the
    // whole point of an opening count: register it, at the location where it was
    // actually found, so the physical count becomes the system record.
    if(!asset&&line.actual_serial_no&&line.variance_type==='UNKNOWN_SERIAL'){
      const detail=await first(c.env.DB,`SELECT * FROM erp_cycle_count_new_units WHERE line_id=?`,[line.id])||{};
      const itemRow=detail.item_code
        ? await first(c.env.DB,`SELECT id,item_name,category FROM erp_items WHERE item_code=?`,[detail.item_code])
        : null;
      const outcome=await createAssetFromReceipt(c.env.DB,{
        serialNo:line.actual_serial_no,
        serialType:detail.serial_type||'SERIAL',
        itemId:itemRow?.id||null,
        itemCode:detail.item_code||'',
        itemName:detail.item_name||itemRow?.item_name||'',
        category:detail.category||itemRow?.category||count.category||'OTH',
        secondarySerial:detail.secondary_serial||'',
        motorNo:detail.motor_no||'',
        locationId:count.location_id,
        locationCode:count.location_code,
        status:detail.status||'AVAILABLE',
        unitCost:Number(detail.unit_cost||0),
        conditionCode:detail.condition_code||'GOOD',
        // Anything counted without an item code is real stock with incomplete
        // master data: it must be visible for cleanup, not quietly "CLEAR".
        reconciliationStatus:detail.item_code?'CLEAR':'FOR_REVIEW',
        sourceSystem:'PHYSICAL_COUNT',
        sourceKey:count.count_no,
      });
      if(!outcome.duplicate){
        await run(c.env.DB,`UPDATE erp_cycle_count_lines SET actual_asset_id=?,
          notes='Registered from the physical count.' WHERE id=?`,[outcome.asset.id,line.id]);
        registered+=1;
        if(registeredSerials.length<50)registeredSerials.push(outcome.asset.serial_no);
      }
      continue;
    }
    /*
     * A unit that is out with a customer is absent from the shelf on purpose.
     * Writing it off as MISSING would take its cost out of inventory and put a
     * loss in the ledger against a unit the company can name the holder of, so
     * the count records where it is instead and leaves the value alone.
     */
    if(line.variance_type==='MISSING'&&asset&&line.deployed_customer){
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no,movementType:'CYCLE_COUNT_ADJUSTMENT',
        movementDate:new Date().toISOString(),toLocationId:count.location_id,
        toLocationCode:count.location_code,toStatus:'LEASED',
        reasonCode:'DEPLOYED_TO_CUSTOMER',
        sourceDocType:'CYCLE_COUNT',sourceDocId:id,sourceDocNo:count.count_no,
        notes:`Not on the shelf because it is out with ${line.deployed_customer}`
          +(line.deployed_lease_no?` on ${line.deployed_lease_no}`:'')+'.',
      },user);
      withCustomer+=1;
    }else if(line.variance_type==='MISSING'&&asset){
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no,movementType:'CYCLE_COUNT_ADJUSTMENT',
        movementDate:new Date().toISOString(),toLocationId:count.location_id,
        toLocationCode:count.location_code,toStatus:'MISSING',reasonCode:'PHYSICAL_COUNT_MISSING',
        sourceDocType:'CYCLE_COUNT',sourceDocId:id,sourceDocNo:count.count_no,
        notes:'Approved physical count variance: expected serial was not counted.',
      },user);
      decrease+=Number(asset.unit_cost||0);
    }else if(['LOCATION_MISMATCH','UNEXPECTED_SERIAL'].includes(line.variance_type)&&asset){
      await postMovement(c.env.DB,{
        serialNo:asset.serial_no,movementType:'CYCLE_COUNT_ADJUSTMENT',
        movementDate:new Date().toISOString(),toLocationId:count.location_id,
        toLocationCode:count.location_code,toStatus:asset.current_status,
        reasonCode:'PHYSICAL_LOCATION_CONFIRMED',sourceDocType:'CYCLE_COUNT',
        sourceDocId:id,sourceDocNo:count.count_no,
        notes:'Approved physical count corrected the registered location.',
      },user);
      moved+=1;
    }else unresolved+=1;
  }
  if(decrease>0){
    await captureFinanceEvent(c.env.DB,{
      eventKey:`CYCLE_COUNT_ADJUSTMENT:${id}`,eventType:'CYCLE_COUNT_ADJUSTMENT',
      sourceModule:'INVENTORY',sourceType:'CYCLE_COUNT',sourceId:id,sourceNo:count.count_no,
      eventDate:new Date().toISOString().slice(0,10),amount:decrease,
      description:`Approved physical-count shortage ${count.count_no}`,
      payload:{costAmount:decrease,adjustmentDirection:'DECREASE'},
    },user);
  }
  await run(c.env.DB,`UPDATE erp_cycle_counts SET status='POSTED' WHERE id=?`,[id]);
  await audit(c,{action:'POST_CYCLE_COUNT_ADJUSTMENTS',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no,after:{decrease,moved,unresolved,registered,withCustomer}});
  return ok(c,{status:'POSTED',financialDecrease:decrease,locationCorrections:moved,unresolved,
    registered,registeredSerials,withCustomer});
});

inventoryRoutes.get('/cycle-counts/:id/variances', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const id=Number(c.req.param('id'));
  const rows=await all(c.env.DB,`
    SELECT * FROM vw_erp_cycle_count_variances
    WHERE cycle_count_id=? ORDER BY variance_type,item_name,COALESCE(expected_serial_no,actual_serial_no)`,[id]);
  return ok(c,{rows,total:rows.length});
});

inventoryRoutes.get('/qr-lookup', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const serial=normalizeSerial(c.req.query('serial'));
  if(!serial)return fail(c,'Serial is required');
  const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=? OR secondary_serial=? LIMIT 1`,[serial,serial]);
  const expected=asset?null:await first(c.env.DB,`SELECT e.*,s.shipment_no,s.status shipment_status FROM erp_expected_assets e JOIN erp_shipments s ON s.id=e.shipment_id WHERE e.serial_no=? OR e.secondary_serial=? LIMIT 1`,[serial,serial]);
  const exception=await first(c.env.DB,`SELECT * FROM erp_serial_exceptions WHERE serial_no=? AND status='OPEN' ORDER BY id DESC LIMIT 1`,[serial]);
  return ok(c,{serial,asset,expected,exception,found:!!(asset||expected)});
});

inventoryRoutes.get('/:serial/history', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const serial=normalizeSerial(c.req.param('serial'));
  const asset=await first(c.env.DB,`SELECT * FROM erp_assets WHERE serial_no=?`,[serial]);
  if(!asset)return fail(c,'Serial not found',404);
  const [movements,assignments,returns,deliveries,reconciliation]=await Promise.all([
    all(c.env.DB,`SELECT * FROM erp_stock_ledger WHERE serial_no=? ORDER BY movement_date DESC,id DESC`,[serial]),
    all(c.env.DB,`SELECT a.assignment_no,a.assignment_type,a.holder_name,a.start_date,a.expected_return_date,a.actual_return_date,a.status,aa.role_code FROM erp_assignment_assets aa JOIN erp_assignments a ON a.id=aa.assignment_id WHERE aa.serial_no=? ORDER BY a.start_date DESC`,[serial]),
    all(c.env.DB,`SELECT r.return_no,r.return_date,r.status,rl.expected_serial,rl.actual_serial,rl.acceptance_status,rl.condition_code FROM erp_return_lines rl JOIN erp_return_orders r ON r.id=rl.return_id WHERE rl.expected_serial=? OR rl.actual_serial=? ORDER BY r.return_date DESC`,[serial,serial]),
    all(c.env.DB,`SELECT d.delivery_no,d.scheduled_date,d.actual_delivery_date,d.destination,d.status FROM erp_delivery_assets da JOIN erp_deliveries d ON d.id=da.delivery_id WHERE da.serial_no=? ORDER BY d.scheduled_date DESC`,[serial]),
    all(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE expected_serial=? OR actual_serial=? OR related_motorcycle_serial=? ORDER BY opened_at DESC`,[serial,serial,serial])
  ]);
  return ok(c,{asset,movements,assignments,returns,deliveries,reconciliation});
});

inventoryRoutes.post('/move', requirePermission('INVENTORY','POST'), async(c)=>{
  const b=await jsonBody(c); if(!b.serialNo)return fail(c,'Serial is required'); if(!b.movementType)return fail(c,'Movement type is required');
  let location=null;
  if(b.toLocationName||b.toLocationCode) location=await ensureLocation(c.env.DB,b.toLocationName||b.toLocationCode,b.toLocationType||'OTHER',b.toLocationCode||'');
  try{
    const result=await postMovement(c.env.DB,{
      serialNo:b.serialNo,movementType:b.movementType,movementDate:b.movementDate,toLocationId:location?.id,toLocationCode:location?.code,
      toStatus:b.toStatus,holderType:b.holderType,holderId:b.holderId,holderName:b.holderName,reasonCode:b.reasonCode,notes:b.notes,
      requireAvailable:!!b.requireAvailable,conditionCode:b.conditionCode,reconciliationStatus:b.reconciliationStatus,
      sourceDocType:b.sourceDocType||'MANUAL',sourceDocId:b.sourceDocId,sourceDocNo:b.sourceDocNo
    },c.get('erpUser').email);
    await audit(c,{action:'POST_MOVEMENT',module:'INVENTORY',recordType:'ASSET',recordId:result.assetId,recordNo:result.serialNo,after:result});
    return ok(c,{movement:result},201);
  }catch(e){return fail(c,e.message,409);}
});


/* ===================================================================
 * Stock-movement requisition slips
 * Users no longer post a movement directly. They raise a slip that runs the
 * approval chain (Department Manager -> Department Head), and only an approved
 * slip is posted to the stock ledger. A serial in a terminal status (SOLD)
 * cannot be moved or requested at all.
 * =================================================================== */

async function movementStatus(db, code) {
  return await first(db, `SELECT * FROM erp_movement_statuses WHERE code=? AND active=1`, [String(code || '').toUpperCase()]);
}

// Status registry, with the restricted / terminal rules the UI enforces.
inventoryRoutes.get('/movement-statuses', requirePermission('INVENTORY','VIEW'), async c => {
  const rows = await all(c.env.DB, `SELECT code,label,restricted,terminal,sort_order FROM erp_movement_statuses WHERE active=1 ORDER BY sort_order,code`);
  return ok(c, { rows });
});

inventoryRoutes.post('/movement-statuses', requirePermission('INVENTORY','MANAGE'), async c => {
  const b = await jsonBody(c);
  const code = normalizeText(b.code).toUpperCase().replace(/\s+/g, '_');
  if (!code) return fail(c, 'Status code is required');
  await run(c.env.DB, `INSERT INTO erp_movement_statuses(code,label,restricted,terminal,sort_order,created_by)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET label=excluded.label,restricted=excluded.restricted,
      terminal=excluded.terminal,active=1`,
    [code, normalizeText(b.label) || code.replace(/_/g, ' '), b.restricted ? 1 : 0, b.terminal ? 1 : 0,
     numberValue(b.sortOrder, 500), c.get('erpUser').email]);
  await audit(c, { action: 'CREATE', module: 'INVENTORY', recordType: 'MOVEMENT_STATUS', recordNo: code, after: b });
  return ok(c, { code }, 201);
});

inventoryRoutes.get('/move-requests', requirePermission('INVENTORY','VIEW'), async c => {
  const status = normalizeText(c.req.query('status')).toUpperCase();
  const rows = await all(c.env.DB,
    `SELECT * FROM erp_stock_move_requests WHERE (?='' OR status=?) ORDER BY id DESC LIMIT 300`, [status, status]);
  return ok(c, { rows });
});

// Raise the slip. This is what the Post Stock Movement form now calls.
inventoryRoutes.post('/move-requests', requirePermission('INVENTORY','CREATE'), async c => {
  const b = await jsonBody(c);
  const serial = normalizeSerial(b.serialNo);
  if (!serial) return fail(c, 'Serial is required');
  if (!b.toLocationCode && !b.toLocationId && !b.toLocationName) return fail(c, 'Destination location is required');
  const asset = await first(c.env.DB, `SELECT * FROM erp_assets WHERE serial_no=? AND active=1`, [serial]);
  if (!asset) return fail(c, `Serial ${serial} is not registered`, 404);

  const currentStatus = await movementStatus(c.env.DB, asset.current_status);
  if (currentStatus?.terminal) {
    return fail(c, `Serial ${serial} is tagged ${asset.current_status} and can no longer be moved.`, 409);
  }
  const open = await first(c.env.DB,
    `SELECT request_no FROM erp_stock_move_requests WHERE serial_no=? AND status IN ('SUBMITTED','DEPT_MANAGER_APPROVED','APPROVED')`, [serial]);
  if (open) return fail(c, `Serial ${serial} already has an open movement slip (${open.request_no}).`, 409);

  const target = await movementStatus(c.env.DB, b.toStatus);
  if (normalizeText(b.toStatus) && !target) return fail(c, `Unknown movement status ${b.toStatus}.`, 400);

  const no = await nextCode(c.env.DB, 'STOCK_MOVE_REQUEST', 'MRQ', 6);
  const inserted = await run(c.env.DB,
    `INSERT INTO erp_stock_move_requests(request_no,serial_no,item_code,item_name,movement_type,
      from_location_code,to_location_id,to_location_code,to_location_name,to_location_type,to_status,
      notes,department,status,requested_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'SUBMITTED',?)`,
    [no, serial, asset.item_code, asset.item_name, normalizeText(b.movementType) || 'TRANSFER',
     asset.current_location_code || '', b.toLocationId || null, normalizeText(b.toLocationCode),
     normalizeText(b.toLocationName), normalizeText(b.toLocationType), normalizeText(b.toStatus),
     normalizeText(b.notes), normalizeText(b.department) || c.get('erpUser').department || '',
     c.get('erpUser').email]);
  await audit(c, { action: 'CREATE', module: 'INVENTORY', recordType: 'STOCK_MOVE_REQUEST',
    recordId: inserted.meta.last_row_id, recordNo: no, after: { serial, to: b.toLocationCode, toStatus: b.toStatus } });
  return ok(c, { id: inserted.meta.last_row_id, requestNo: no, status: 'SUBMITTED' }, 201);
});

// Approve one step. Two steps by default; the second approval posts the movement.
inventoryRoutes.post('/move-requests/:id/approve', requirePermission('INVENTORY','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const slip = await first(c.env.DB, `SELECT * FROM erp_stock_move_requests WHERE id=?`, [id]);
  if (!slip) return fail(c, 'Movement slip not found', 404);
  const user = c.get('erpUser');
  if (slip.requested_by === user.email) return fail(c, 'The requestor cannot approve their own movement slip.', 409);

  if (slip.status === 'SUBMITTED') {
    await run(c.env.DB, `UPDATE erp_stock_move_requests SET status='DEPT_MANAGER_APPROVED',
      manager_approved_by=?,manager_approved_at=datetime('now'),updated_at=datetime('now') WHERE id=?`, [user.email, id]);
    await audit(c, { action: 'APPROVAL_STEP', module: 'INVENTORY', recordType: 'STOCK_MOVE_REQUEST', recordId: id, recordNo: slip.request_no, after: { step: 1 } });
    return ok(c, { status: 'DEPT_MANAGER_APPROVED', posted: false, pending: 'Department Head' });
  }
  if (slip.status !== 'DEPT_MANAGER_APPROVED') return fail(c, `This slip is ${slip.status} and cannot be approved.`, 409);
  if (slip.manager_approved_by === user.email) return fail(c, 'The second approval must come from a different person.', 409);

  // Final approval: post the movement to the ledger.
  let location = null;
  if (slip.to_location_name || slip.to_location_code) {
    location = await ensureLocation(c.env.DB, slip.to_location_name || slip.to_location_code,
      slip.to_location_type || 'OTHER', slip.to_location_code || '');
  }
  try {
    const result = await postMovement(c.env.DB, {
      serialNo: slip.serial_no, movementType: slip.movement_type,
      toLocationId: location?.id, toLocationCode: location?.code, toStatus: slip.to_status,
      notes: slip.notes, sourceDocType: 'STOCK_MOVE_REQUEST', sourceDocId: slip.id, sourceDocNo: slip.request_no,
    }, user.email);
    await run(c.env.DB, `UPDATE erp_stock_move_requests SET status='POSTED',head_approved_by=?,
      head_approved_at=datetime('now'),posted_by=?,posted_at=datetime('now'),movement_id=?,updated_at=datetime('now')
      WHERE id=?`, [user.email, user.email, result.movementId || null, id]);
    await audit(c, { action: 'POST_MOVEMENT', module: 'INVENTORY', recordType: 'STOCK_MOVE_REQUEST', recordId: id, recordNo: slip.request_no, after: result });
    return ok(c, { status: 'POSTED', posted: true, movement: result });
  } catch (e) {
    return fail(c, e.message, 409);
  }
});

inventoryRoutes.post('/move-requests/:id/reject', requirePermission('INVENTORY','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c).catch(() => ({}));
  const slip = await first(c.env.DB, `SELECT * FROM erp_stock_move_requests WHERE id=?`, [id]);
  if (!slip) return fail(c, 'Movement slip not found', 404);
  if (['POSTED', 'REJECTED'].includes(slip.status)) return fail(c, `This slip is already ${slip.status}.`, 409);
  await run(c.env.DB, `UPDATE erp_stock_move_requests SET status='REJECTED',rejected_by=?,rejected_at=datetime('now'),
    reject_reason=?,updated_at=datetime('now') WHERE id=?`, [c.get('erpUser').email, normalizeText(b.reason), id]);
  await audit(c, { action: 'REJECT', module: 'INVENTORY', recordType: 'STOCK_MOVE_REQUEST', recordId: id, recordNo: slip.request_no, after: { reason: b.reason } });
  return ok(c, { status: 'REJECTED' });
});


/* ===================================================================
 * Finance-only cycle-count override
 * "Should there be discrepancies, only finance has the control to override
 *  and provide remarks of discrepancies to correct the count."
 * =================================================================== */
inventoryRoutes.post('/cycle-counts/:id/override', requirePermission('INVENTORY','APPROVE'), async c => {
  const id = Number(c.req.param('id'));
  const b = await jsonBody(c);
  const user = c.get('erpUser');
  if (String(user.role_code || '').toUpperCase() !== 'FINANCE') {
    return fail(c, 'Only Finance can override a physical count variance.', 403);
  }
  const count = await first(c.env.DB, `SELECT * FROM erp_cycle_counts WHERE id=?`, [id]);
  if (!count) return fail(c, 'Cycle count not found', 404);
  if (!['SUBMITTED','APPROVED'].includes(count.status)) {
    return fail(c, 'A variance can only be overridden on a submitted or approved count.', 409);
  }
  const remarks = normalizeText(b.remarks);
  if (!remarks) return fail(c, 'Remarks explaining the correction are required.');

  const lines = (Array.isArray(b.lines) ? b.lines : [b]).filter(x => x && x.lineId);
  if (!lines.length) return fail(c, 'Select the variance lines to correct.');
  let corrected = 0;
  for (const entry of lines) {
    const line = await first(c.env.DB, `SELECT * FROM erp_cycle_count_lines WHERE id=? AND cycle_count_id=?`,
      [Number(entry.lineId), id]);
    if (!line) continue;
    const resolution = String(entry.resolution || 'ACCEPT_SYSTEM').toUpperCase();
    // ACCEPT_SYSTEM  : the system record was right, clear the variance
    // ACCEPT_COUNT   : the physical count was right, keep the variance for posting
    if (resolution === 'ACCEPT_SYSTEM') {
      await run(c.env.DB, `UPDATE erp_cycle_count_lines
        SET count_status='COUNTED',variance_type=NULL,
            notes=COALESCE(notes,'')||' | Finance override ('||?||'): '||?
        WHERE id=?`, [user.email, remarks, line.id]);
    } else {
      await run(c.env.DB, `UPDATE erp_cycle_count_lines
        SET notes=COALESCE(notes,'')||' | Finance confirmed variance ('||?||'): '||?
        WHERE id=?`, [user.email, remarks, line.id]);
    }
    corrected += 1;
  }
  const totals = await first(c.env.DB, `SELECT
      COUNT(CASE WHEN actual_serial_no IS NOT NULL THEN 1 END) counted,
      COUNT(CASE WHEN variance_type IS NOT NULL AND variance_type!='' THEN 1 END) variances
    FROM erp_cycle_count_lines WHERE cycle_count_id=?`, [id]);
  await run(c.env.DB, `UPDATE erp_cycle_counts SET counted_units=?,variance_units=? WHERE id=?`,
    [totals?.counted || 0, totals?.variances || 0, id]);
  await audit(c, { action: 'FINANCE_OVERRIDE', module: 'INVENTORY', recordType: 'CYCLE_COUNT',
    recordId: id, recordNo: count.count_no, after: { corrected, remarks, totals } });
  return ok(c, { corrected, totals });
});
