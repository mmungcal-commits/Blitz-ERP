import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';

export const planningRoutes = new Hono();

planningRoutes.get('/budget-summary', requirePermission('PLANNING','VIEW'), async c=>{
  const year=Number(c.req.query('year')||new Date().getFullYear());
  const rows=await all(c.env.DB,`SELECT year,month,department,account,capex_opex,SUM(amount) amount FROM budget WHERE year=? GROUP BY year,month,department,account,capex_opex ORDER BY month,department,account`,[year]);
  const totals=await all(c.env.DB,`SELECT department,SUM(CASE WHEN capex_opex='OPEX' THEN amount ELSE 0 END) opex,SUM(CASE WHEN capex_opex='CAPEX' THEN amount ELSE 0 END) capex,SUM(amount) total FROM budget WHERE year=? GROUP BY department ORDER BY total DESC`,[year]);
  return ok(c,{year,rows,totals});
});

planningRoutes.get('/forecast-summary', requirePermission('PLANNING','VIEW'), async c=>{
  const year=Number(c.req.query('year')||new Date().getFullYear());
  const rows=await all(c.env.DB,`SELECT f.year,f.month,f.department,f.account,f.forecast_type,SUM(f.amount) forecast,COALESCE((SELECT SUM(b.amount) FROM budget b WHERE b.year=f.year AND b.month=f.month AND b.department=f.department AND b.account=f.account),0) budget FROM forecast f WHERE f.year=? GROUP BY f.year,f.month,f.department,f.account,f.forecast_type ORDER BY f.month,f.department,f.account`,[year]);
  return ok(c,{year,rows:rows.map(r=>({...r,variance:(r.forecast||0)-(r.budget||0)}))});
});

planningRoutes.get('/data-status', requirePermission('DASHBOARD','VIEW'), async c=>{
  const settings=await all(c.env.DB,`SELECT key,value,updated_at FROM erp_settings WHERE key LIKE 'OPENING_%' OR key IN ('APP_VERSION','APP_NAME') ORDER BY key`);
  const imports=await all(c.env.DB,`SELECT import_no,import_type,source_file_name,status,total_rows,valid_rows,exception_rows,created_at,posted_at FROM erp_import_batches ORDER BY id DESC LIMIT 50`);
  return ok(c,{settings,imports});
});
