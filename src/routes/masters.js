import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requireAnyPermission, requirePermission } from '../lib/auth.js';
import { ensureItem, ensureLocation, ensurePartner, normalizeText } from '../lib/codes.js';
import { audit } from '../lib/audit.js';

export const masterRoutes = new Hono();

masterRoutes.get('/lookups', requireAnyPermission(['INVENTORY','PROCUREMENT','SALES','CUSTOMERS','RECEIVING','STATIONS'],'VIEW'), async (c) => {
  const [items, locations, customers, vendors, employees] = await Promise.all([
    all(c.env.DB, `SELECT id,item_code,item_name,category,serialized,standard_cost FROM erp_items WHERE active=1 ORDER BY category,item_name`),
    all(c.env.DB, `SELECT id,code,name,location_type,partner_name FROM erp_locations WHERE active=1 AND location_type<>'OTHER' AND name NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND COALESCE(code,'') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' ORDER BY CASE location_type WHEN 'WAREHOUSE' THEN 1 WHEN 'RETAIL' THEN 2 WHEN 'PORT' THEN 3 WHEN 'QUARANTINE' THEN 4 WHEN 'CUSTOMER_SITE' THEN 5 ELSE 6 END,name`),
    all(c.env.DB, `SELECT id,partner_code,name,credit_status,overdue_balance FROM erp_partners WHERE partner_type='CUSTOMER' AND active=1 ORDER BY name`),
    all(c.env.DB, `SELECT id,partner_code,name FROM erp_partners WHERE partner_type='VENDOR' AND active=1 ORDER BY name`),
    all(c.env.DB, `SELECT id,partner_code,name FROM erp_partners WHERE partner_type='EMPLOYEE' AND active=1 ORDER BY name`),
  ]);
  return ok(c, { items, locations, customers, vendors, employees });
});

masterRoutes.get('/items', requirePermission('INVENTORY','VIEW'), async (c) => {
  const { page,size,offset } = pageParams(c);
  const q = `%${normalizeText(c.req.query('q'))}%`;
  const category = normalizeText(c.req.query('category'));
  const args=[]; const where=['active=1'];
  if (q !== '%%') { where.push('(item_code LIKE ? OR item_name LIKE ?)'); args.push(q,q); }
  if (category) { where.push('category=?'); args.push(category); }
  const rows = await all(c.env.DB, `SELECT * FROM erp_items WHERE ${where.join(' AND ')} ORDER BY category,item_name LIMIT ? OFFSET ?`, [...args,size,offset]);
  const total = await first(c.env.DB, `SELECT COUNT(*) n FROM erp_items WHERE ${where.join(' AND ')}`, args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

masterRoutes.post('/items', requirePermission('INVENTORY','CREATE'), async (c) => {
  const b=await jsonBody(c);
  if (!b.itemName) return fail(c,'Item name is required');
  const item=await ensureItem(c.env.DB,{...b,autoCreated:!b.itemCode,sourceSystem:'E88_FINSYS'});
  await audit(c,{action:'CREATE',module:'INVENTORY',recordType:'ITEM',recordId:item.id,recordNo:item.item_code,after:item});
  return ok(c,{item},201);
});

masterRoutes.get('/partners', requirePermission('CUSTOMERS','VIEW'), async (c) => {
  const { page,size,offset }=pageParams(c); const type=normalizeText(c.req.query('type'));
  const q=`%${normalizeText(c.req.query('q'))}%`; const args=[]; const where=['active=1'];
  if(type){where.push('partner_type=?');args.push(type);} if(q!=='%%'){where.push('(partner_code LIKE ? OR name LIKE ?)');args.push(q,q);}
  const rows=await all(c.env.DB,`SELECT * FROM erp_partners WHERE ${where.join(' AND ')} ORDER BY name LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_partners WHERE ${where.join(' AND ')}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

masterRoutes.post('/partners', requirePermission('CUSTOMERS','CREATE'), async(c)=>{
  const b=await jsonBody(c); if(!b.name)return fail(c,'Name is required');
  const partner=await ensurePartner(c.env.DB,{...b,type:b.partnerType||'CUSTOMER',sourceSystem:'E88_FINSYS'});
  await audit(c,{action:'CREATE',module:'SALES',recordType:'PARTNER',recordId:partner.id,recordNo:partner.partner_code,after:partner});
  return ok(c,{partner},201);
});

masterRoutes.post('/locations', requirePermission('INVENTORY','CREATE'), async(c)=>{
  const b=await jsonBody(c); if(!b.name)return fail(c,'Location name is required');
  const location=await ensureLocation(c.env.DB,b.name,b.locationType||'OTHER',b.code||'');
  await audit(c,{action:'CREATE',module:'INVENTORY',recordType:'LOCATION',recordId:location.id,recordNo:location.code,after:location});
  return ok(c,{location},201);
});

masterRoutes.post('/partners/:id/credit', requirePermission('CUSTOMERS','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id')); const b=await jsonBody(c); const before=await first(c.env.DB,`SELECT * FROM erp_partners WHERE id=?`,[id]);
  if(!before)return fail(c,'Partner not found',404);
  const status=b.creditStatus||before.credit_status;
  await run(c.env.DB,`UPDATE erp_partners SET credit_status=?,hold_reason=?,overdue_balance=?,updated_at=datetime('now') WHERE id=?`,[status,b.holdReason||'',Number(b.overdueBalance||0),id]);
  const after=await first(c.env.DB,`SELECT * FROM erp_partners WHERE id=?`,[id]);
  await audit(c,{action:'CREDIT_UPDATE',module:'SALES',recordType:'PARTNER',recordId:id,recordNo:after.partner_code,before,after});
  return ok(c,{partner:after});
});
