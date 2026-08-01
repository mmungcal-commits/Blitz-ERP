import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeSerial, normalizeText, ensureLocation, nextCode } from '../lib/codes.js';
import { postMovement } from '../lib/inventory.js';
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
    WHERE l.active=1
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
      (SELECT COUNT(DISTINCT a.current_location_id) FROM erp_assets a WHERE a.item_id=i.id AND a.active=1) location_count
    FROM erp_items i
    WHERE i.active=1
    ORDER BY CASE i.category WHEN 'MC' THEN 1 WHEN 'BAT' THEN 2 WHEN 'BSS' THEN 3 WHEN 'CHG' THEN 4 WHEN 'SP' THEN 5 ELSE 6 END,i.item_name`);
  const byStatus=await all(c.env.DB,`
    SELECT current_status status,COUNT(*) qty
    FROM erp_assets WHERE active=1 GROUP BY current_status ORDER BY qty DESC`);
  const totals=rows.reduce((out,row)=>{
    out.items+=1;out.onHand+=Number(row.on_hand_qty||0);out.available+=Number(row.available_qty||0);
    out.incoming+=Number(row.incoming_qty||0);out.openPO+=Number(row.open_po_qty||0);
    out.quarantine+=Number(row.quarantine_qty||0);out.unvalued+=Number(row.unvalued_qty||0);
    out.inventoryValue+=Number(row.inventory_value||0);return out;
  },{items:0,onHand:0,available:0,incoming:0,openPO:0,quarantine:0,unvalued:0,inventoryValue:0});
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
    ORDER BY cc.count_date DESC,cc.id DESC`);
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
    [countNo,location.id,category,b.assignedTo||'',b.instructions||'',assets.length,user]);
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
    SELECT ccl.*,i.item_code,i.item_name,a.current_status,a.condition_code,
      al.code actual_location_code,al.name actual_location_name
    FROM erp_cycle_count_lines ccl
    LEFT JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
    LEFT JOIN erp_items i ON i.id=COALESCE(ccl.expected_item_id,a.item_id)
    LEFT JOIN erp_locations al ON al.id=ccl.actual_location_id
    WHERE ccl.cycle_count_id=?
    ORDER BY CASE ccl.count_status WHEN 'VARIANCE' THEN 0 WHEN 'NOT_COUNTED' THEN 1 ELSE 2 END,
      i.item_name,COALESCE(ccl.expected_serial_no,ccl.actual_serial_no)`,[id]);
  const summary=lines.reduce((out,row)=>{
    out.expected+=row.expected_asset_id?1:0;
    if(row.actual_serial_no)out.counted+=1;
    if(row.variance_type)out.variances+=1;
    if(row.variance_type==='MISSING')out.missing+=1;
    if(['UNEXPECTED_SERIAL','UNKNOWN_SERIAL'].includes(row.variance_type))out.unexpected+=1;
    if(row.variance_type==='LOCATION_MISMATCH')out.locationMismatch+=1;
    return out;
  },{expected:0,counted:0,variances:0,missing:0,unexpected:0,locationMismatch:0});
  return ok(c,{header,lines,summary});
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
       asset?'Serial belongs to another registered location.':'Serial is not registered in inventory.']);
    result={lineId:inserted.meta.last_row_id,serial,countStatus:'VARIANCE',varianceType};
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
  await audit(c,{action:'SUBMIT_CYCLE_COUNT',module:'INVENTORY',recordType:'CYCLE_COUNT',
    recordId:id,recordNo:count.count_no,after:totals});
  return ok(c,{status:'SUBMITTED',totals});
});

inventoryRoutes.post('/cycle-counts/:id/approve', requirePermission('INVENTORY','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id'));
  const count=await first(c.env.DB,`SELECT * FROM erp_cycle_counts WHERE id=?`,[id]);
  if(!count)return fail(c,'Cycle count not found',404);
  if(count.status!=='SUBMITTED')return fail(c,'Only a submitted cycle count can be approved.',409);
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
  const lines=await all(c.env.DB,`SELECT ccl.*,a.unit_cost,a.category,a.item_id
    FROM erp_cycle_count_lines ccl
    LEFT JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
    WHERE ccl.cycle_count_id=? AND ccl.variance_type IS NOT NULL AND ccl.variance_type!=''`,[id]);
  let decrease=0;let moved=0;let unresolved=0;
  const user=c.get('erpUser').email;
  for(const line of lines){
    const assetId=line.actual_asset_id||line.expected_asset_id;
    const asset=assetId?await first(c.env.DB,`SELECT * FROM erp_assets WHERE id=?`,[assetId]):null;
    if(line.variance_type==='MISSING'&&asset){
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
    recordId:id,recordNo:count.count_no,after:{decrease,moved,unresolved}});
  return ok(c,{status:'POSTED',financialDecrease:decrease,locationCorrections:moved,unresolved});
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
