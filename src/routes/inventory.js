import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeSerial, normalizeText, ensureLocation } from '../lib/codes.js';
import { postMovement } from '../lib/inventory.js';

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

inventoryRoutes.get('/summary', requirePermission('INVENTORY','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`SELECT kpi_category category,current_status,reconciliation_status,current_location_code,COUNT(*) qty FROM vw_erp_serialized_assets WHERE active=1 GROUP BY kpi_category,current_status,reconciliation_status,current_location_code ORDER BY kpi_category,current_location_code,current_status`);
  return ok(c,{rows});
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
