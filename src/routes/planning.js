import { Hono } from 'hono';
import { all, run } from '../lib/db.js';
import { ok, fail, jsonBody } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

export const planningRoutes = new Hono();

planningRoutes.get('/budget-summary', requirePermission('PLANNING','VIEW'), async c=>{
  const year=Number(c.req.query('year')||new Date().getFullYear());
  const rows=await all(c.env.DB,`SELECT year,month,department,account,capex_opex,SUM(amount) amount FROM budget WHERE year=? GROUP BY year,month,department,account,capex_opex ORDER BY month,department,account`,[year]);
  const totals=await all(c.env.DB,`SELECT department,SUM(CASE WHEN capex_opex='OPEX' THEN amount ELSE 0 END) opex,SUM(CASE WHEN capex_opex='CAPEX' THEN amount ELSE 0 END) capex,SUM(amount) total FROM budget WHERE year=? GROUP BY department ORDER BY total DESC`,[year]);
  return ok(c,{year,rows,totals});
});

planningRoutes.get('/workbench', requirePermission('PLANNING','VIEW'), async c=>{
  const year=Number(c.req.query('year')||new Date().getFullYear());
  const department=String(c.req.query('department')||'').trim();
  const args=[year]; const where=['year=?'];
  if(department){where.push('department=?');args.push(department);}
  let base=await all(c.env.DB,`SELECT year,month,department,COALESCE(cost_center,'') cost_center,account_title,capex_opex,SUM(amount) amount FROM erp_budget_plan WHERE ${where.join(' AND ')} GROUP BY year,month,department,cost_center,account_title,capex_opex ORDER BY department,cost_center,account_title,month`,args);
  if(!base.length){
    const legacyArgs=[year];const legacyWhere=['year=?'];if(department){legacyWhere.push('department=?');legacyArgs.push(department);}
    base=await all(c.env.DB,`SELECT year,month,department,'' cost_center,account account_title,capex_opex,SUM(amount) amount FROM budget WHERE ${legacyWhere.join(' AND ')} GROUP BY year,month,department,account,capex_opex ORDER BY department,account,month`,legacyArgs);
  }
  const [overrides,forecasts,actuals,depts]=await Promise.all([
    all(c.env.DB,`SELECT * FROM erp_budget_overrides WHERE year=?${department?' AND department=?':''}`,[year,...(department?[department]:[])]),
    all(c.env.DB,`SELECT * FROM erp_plan_forecasts WHERE year=? AND forecast_version='LATEST'${department?' AND department=?':''}`,[year,...(department?[department]:[])]),
    all(c.env.DB,`SELECT * FROM erp_plan_actuals WHERE year=?${department?' AND department=?':''}`,[year,...(department?[department]:[])]),
    all(c.env.DB,`SELECT DISTINCT department FROM erp_budget_plan WHERE year=? AND department IS NOT NULL AND trim(department)<>'' ORDER BY department`,[year])
  ]);
  const key=r=>[r.department||'',r.cost_center||'',r.account_title||'',r.capex_opex||'OPEX'].join('|');
  const map=new Map();
  for(const r of base){const k=key(r);if(!map.has(k))map.set(k,{department:r.department||'',costCenter:r.cost_center||'',accountTitle:r.account_title||'',capexOpex:r.capex_opex||'OPEX',months:Array(12).fill(0),actualMonths:Array(12).fill(0),forecastMonths:Array(12).fill(0),status:'SOURCE'});map.get(k).months[Number(r.month)-1]=Number(r.amount||0);}
  for(const r of overrides){const k=key(r);if(!map.has(k))map.set(k,{department:r.department||'',costCenter:r.cost_center||'',accountTitle:r.account_title||'',capexOpex:r.capex_opex||'OPEX',months:Array(12).fill(0),actualMonths:Array(12).fill(0),forecastMonths:Array(12).fill(0),status:r.status});map.get(k).months[Number(r.month)-1]=Number(r.amount||0);map.get(k).status=r.status;}
  for(const r of forecasts){const k=key(r);if(!map.has(k))map.set(k,{department:r.department||'',costCenter:r.cost_center||'',accountTitle:r.account_title||'',capexOpex:r.capex_opex||'OPEX',months:Array(12).fill(0),actualMonths:Array(12).fill(0),forecastMonths:Array(12).fill(0),status:r.status});map.get(k).forecastMonths[Number(r.month)-1]=Number(r.amount||0);}
  for(const r of actuals){const k=key(r);if(!map.has(k))map.set(k,{department:r.department||'',costCenter:r.cost_center||'',accountTitle:r.account_title||'',capexOpex:r.capex_opex||'OPEX',months:Array(12).fill(0),actualMonths:Array(12).fill(0),forecastMonths:Array(12).fill(0),status:'SOURCE'});map.get(k).actualMonths[Number(r.month)-1]=Number(r.amount||0);}
  const rows=[...map.values()].map(r=>{const fyBudget=r.months.reduce((a,x)=>a+x,0),actual=r.actualMonths.reduce((a,x)=>a+x,0),forecast=r.forecastMonths.some(Boolean)?r.forecastMonths.reduce((a,x)=>a+x,0):fyBudget;return{...r,fyBudget,actual,forecast,variance:forecast-fyBudget,variancePct:fyBudget?((forecast-fyBudget)/fyBudget)*100:0};}).sort((a,b)=>a.department.localeCompare(b.department)||a.costCenter.localeCompare(b.costCenter)||a.accountTitle.localeCompare(b.accountTitle));
  return ok(c,{year,departments:depts.map(x=>x.department),rows});
});

planningRoutes.post('/budget-cells', requirePermission('PLANNING','EDIT'), async c=>{
  const b=await jsonBody(c);const cells=Array.isArray(b.cells)?b.cells:[];
  if(!cells.length)return fail(c,'No budget cells were provided.');
  const user=c.get('erpUser').email;
  for(const x of cells){
    const year=Number(x.year),month=Number(x.month),amount=Number(x.amount||0);
    if(!year||month<1||month>12||!x.department||!x.accountTitle)return fail(c,'Each budget cell requires year, month, department and account title.');
    await run(c.env.DB,`INSERT INTO erp_budget_overrides(year,month,department,cost_center,account_title,capex_opex,amount,status,notes,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,'WORKING',?,?,datetime('now'))
      ON CONFLICT(year,month,department,cost_center,account_title,capex_opex)
      DO UPDATE SET amount=excluded.amount,status='WORKING',notes=excluded.notes,updated_by=excluded.updated_by,updated_at=datetime('now')`,
      [year,month,x.department,x.costCenter||'',x.accountTitle,x.capexOpex||'OPEX',amount,x.notes||'',user]);
  }
  await audit(c,{action:'SAVE_BUDGET',module:'PLANNING',recordType:'BUDGET',recordNo:String(b.year||''),after:{cells:cells.length}});
  return ok(c,{saved:cells.length});
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
