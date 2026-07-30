import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nextCode, ensurePartner, normalizeText } from '../lib/codes.js';

export const shipmentRoutes = new Hono();

shipmentRoutes.get('/', requirePermission('SHIPMENTS','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c); const q=`%${normalizeText(c.req.query('q'))}%`; const status=normalizeText(c.req.query('status'));
  const where=[]; const args=[];
  if(q!=='%%'){where.push('(shipment_no LIKE ? OR batch_code LIKE ? OR supplier_name LIKE ?)');args.push(q,q,q);}
  if(status){where.push('status=?');args.push(status);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=await all(c.env.DB,
    `SELECT s.*,
      (SELECT COALESCE(SUM(expected_qty),0) FROM erp_shipment_lines l WHERE l.shipment_id=s.id) expected_qty,
      (SELECT COALESCE(SUM(received_qty),0) FROM erp_shipment_lines l WHERE l.shipment_id=s.id) received_qty,
      (SELECT COUNT(*) FROM erp_expected_assets a WHERE a.shipment_id=s.id) expected_serials,
      (SELECT COUNT(*) FROM erp_expected_assets a WHERE a.shipment_id=s.id AND a.expected_status='RECEIVED') matched_serials,
      (SELECT COUNT(*) FROM erp_expected_assets a WHERE a.shipment_id=s.id AND a.expected_status='SUBSTITUTED') substituted_serials,
      (SELECT COUNT(*) FROM erp_receiving_variances v WHERE v.shipment_id=s.id AND v.status='OPEN') open_variances
     FROM erp_shipments s ${w} ORDER BY COALESCE(eta,warehouse_arrival,created_at) DESC LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_shipments ${w}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

shipmentRoutes.post('/', requirePermission('SHIPMENTS','CREATE'), async(c)=>{
  const b=await jsonBody(c); if(!b.supplierName)return fail(c,'Supplier is required');
  const supplier=await ensurePartner(c.env.DB,{name:b.supplierName,type:'VENDOR',sourceSystem:'E88_FINSYS'});
  const no=await nextCode(c.env.DB,'SHIPMENT','SHP',6);
  const r=await run(c.env.DB,
    `INSERT INTO erp_shipments(shipment_no,batch_code,supplier_id,supplier_name,purchase_order_ref,mode_of_transport,incoterm,shipping_line,vessel,container_no,origin,destination,etd,eta,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no,normalizeText(b.batchCode),supplier.id,supplier.name,normalizeText(b.purchaseOrderRef),normalizeText(b.modeOfTransport),normalizeText(b.incoterm),normalizeText(b.shippingLine),normalizeText(b.vessel),normalizeText(b.containerNo),normalizeText(b.origin),normalizeText(b.destination),b.etd||'',b.eta||'','DRAFT',c.get('erpUser').email]);
  const shipment={id:r.meta.last_row_id,shipmentNo:no};
  await audit(c,{action:'CREATE',module:'SHIPMENTS',recordType:'SHIPMENT',recordId:shipment.id,recordNo:no,after:b});
  return ok(c,{shipment},201);
});

shipmentRoutes.get('/:id', requirePermission('SHIPMENTS','VIEW'), async(c)=>{
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[id]);
  if(!header)return fail(c,'Shipment not found',404);
  const [lines,assets,receipts]=await Promise.all([
    all(c.env.DB,`SELECT * FROM erp_shipment_lines WHERE shipment_id=? ORDER BY line_no`,[id]),
    all(c.env.DB,`SELECT a.*,i.item_name,m.actual_serial_no,m.match_status,m.variance_reason,m.receipt_line_id FROM erp_expected_assets a LEFT JOIN erp_items i ON i.id=a.item_id LEFT JOIN erp_expected_receipt_matches m ON m.expected_asset_id=a.id WHERE a.shipment_id=? ORDER BY a.source_sheet,a.source_row LIMIT 5000`,[id]),
    all(c.env.DB,`SELECT r.*,l.code location_code,l.name location_name FROM erp_receipts r LEFT JOIN erp_locations l ON l.id=r.location_id WHERE shipment_id=? ORDER BY received_at DESC`,[id])
  ]);
  return ok(c,{header,lines,expectedAssets:assets,receipts});
});

shipmentRoutes.post('/:id/status', requirePermission('SHIPMENTS','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id')); const b=await jsonBody(c); const allowed=['DRAFT','MANIFESTED','IN_TRANSIT','ARRIVED','RECEIVING','PARTIALLY_RECEIVED','RECEIVED','RECEIVED_WITH_EXCEPTIONS','CLOSED','CANCELLED'];
  if(!allowed.includes(b.status))return fail(c,'Invalid shipment status');
  const before=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[id]); if(!before)return fail(c,'Shipment not found',404);
  await run(c.env.DB,`UPDATE erp_shipments SET status=?,actual_departure=COALESCE(?,actual_departure),actual_arrival=COALESCE(?,actual_arrival),warehouse_arrival=COALESCE(?,warehouse_arrival),updated_at=datetime('now') WHERE id=?`,[b.status,b.actualDeparture||null,b.actualArrival||null,b.warehouseArrival||null,id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_shipments WHERE id=?`,[id]);
  await audit(c,{action:'STATUS',module:'SHIPMENTS',recordType:'SHIPMENT',recordId:id,recordNo:after.shipment_no,before,after});
  return ok(c,{shipment:after});
});
