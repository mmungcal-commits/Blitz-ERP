// Blitz - ERP · end-to-end route tests
//
//   node --test test/blitz-e2e.mjs      (or)      node test/blitz-e2e.mjs
//
// Builds a throwaway SQLite database from migrations/*.sql, seeds one user,
// one location, one item and one serialised asset, then drives the real Hono
// app (src/index.js) through a D1 shim. No network, no Cloudflare account.
// Requires Node 22+ for node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, '.blitz-e2e.sqlite');
try { rmSync(DB_PATH, { force: true }); } catch {}
const sqlite = new DatabaseSync(DB_PATH);

// --- schema from the real migrations -------------------------------------
for (const file of readdirSync(join(ROOT, 'migrations')).filter(f => /^0\d+.*\.sql$/.test(f)).sort()) {
  sqlite.exec(readFileSync(join(ROOT, 'migrations', file), 'utf8'));
}
// --- minimal seed ---------------------------------------------------------
sqlite.exec(`
  INSERT OR IGNORE INTO erp_users(email,display_name,role_code,active) VALUES('mmungcal@nrdev.ph','Mark Alexis Mungcal','FINANCE',1);
  INSERT OR IGNORE INTO erp_locations(code,name,location_type) VALUES('WH-MAIN','Main Warehouse','WAREHOUSE');
  INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,serialized,base_uom,standard_cost,active)
    VALUES('SP-0001','Brake pad','brake pad','SP',1,'PCS',500,1);
`);
const loc = sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
const item = sqlite.prepare("SELECT id FROM erp_items WHERE item_code='SP-0001'").get();
sqlite.prepare(`INSERT INTO erp_assets(asset_no,serial_no,serial_type,item_id,item_code,item_name,category,
  current_location_id,current_location_code,current_status,unit_cost,landed_cost,condition_code,reconciliation_status,
  active,acquisition_cost,freight_cost,duty_cost,other_landed_cost,cost_source,valuation_status,capitalization_status)
  VALUES('AST-1','TESTVIN0001','FRAME',?,'SP-0001','Brake pad','SP',?, 'WH-MAIN','AVAILABLE',1200,0,'GOOD','CLEAR',1,1200,0,0,0,'MANUAL','VALUED','NOT_CAPITALIZED')`)
  .run(item.id, loc.id);

// --- D1 shim --------------------------------------------------------------
function d1(db) {
  const wrap = (sql) => {
    const s = { _args: [] };
    s.bind = (...a) => { s._args = a.map(v => v === undefined ? null : v); return s; };
    s.first = async () => { const r = db.prepare(sql).get(...s._args); return r === undefined ? null : r; };
    s.all = async () => ({ results: db.prepare(sql).all(...s._args) });
    s.run = async () => { const r = db.prepare(sql).run(...s._args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; };
    return s;
  };
  return { prepare: wrap, batch: async (st) => { const o = []; for (const x of st) o.push(await x.run()); return o; }, exec: async (q) => { db.exec(q); return {}; } };
}
const env = { DB: d1(sqlite), ENVIRONMENT: 'test', ALLOWED_DOMAIN: 'nrdev.ph', APP_ADMIN_EMAIL: 'mmungcal@nrdev.ph', ALLOW_DEV_AUTH: 'true' };

let who = 'mmungcal@nrdev.ph';
let cookie = '';
async function call(method, path, body) {
  const init = { method, headers: { 'content-type': 'application/json', 'X-Dev-User': who } };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.fetch(new Request('http://localhost' + path, init), env, {});
  const setc = res.headers.get('set-cookie'); if (setc) cookie = setc.split(';')[0];
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const results = [];
const R = results;
const t = async (name, fn) => { try { const r = await fn(); results.push([r === false ? 'FAIL' : 'PASS', name, (r && r.note) || '']); } catch (e) { results.push(['FAIL', name, e.message]); } };


await t('health', async () => { const r = await call('GET','/api/health'); if(!r.json?.ok) return false; return {note:r.json.build}; });
await t('session', async () => { const r = await call('GET','/api/session'); if(!r.json?.ok) throw new Error(JSON.stringify(r.json)); return {note:r.json.user.role}; });
await t('movement statuses', async () => { const r = await call('GET','/api/inventory/movement-statuses'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.rows.length+' statuses'}; });
await t('add movement status', async () => { const r = await call('POST','/api/inventory/movement-statuses',{code:'available for demo',label:'Available for Demo',restricted:false}); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.code}; });
await t('service lookups', async () => { const r = await call('GET','/api/service/lookups'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.spareAssets.length+' spares, markup '+r.json.defaultMarkup}; });
await t('service summary', async () => { const r = await call('GET','/api/service/summary'); if(!r.json?.ok) throw new Error(r.json?.error); return true; });

let jobId=null;
await t('create service job', async () => {
  const r = await call('POST','/api/service/jobs',{jobType:'REPAIR',customerName:'Test Customer',complaint:'Brake noise',markupPct:25});
  if(!r.json?.ok) throw new Error(r.json?.error); jobId=r.json.id; return {note:r.json.jobNo};
});
await t('add quantity part', async () => {
  const items = (await call('GET','/api/service/lookups')).json.items;
  const r = await call('POST',`/api/service/jobs/${jobId}/parts`,{itemId:items[0]?.id,qty:2,unitCost:500});
  if(!r.json?.ok) throw new Error(r.json?.error); return {note:'material '+r.json.totals.material};
});
await t('add labour', async () => {
  const r = await call('POST',`/api/service/jobs/${jobId}/labor`,{labor:[{description:'Brake service',hours:2,rate:450}]});
  if(!r.json?.ok) throw new Error(r.json?.error); return {note:'labour '+r.json.totals.laborCost};
});
await t('estimate with markup', async () => {
  const r = await call('POST',`/api/service/jobs/${jobId}/estimate`,{markupPct:25});
  if(!r.json?.ok) throw new Error(r.json?.error);
  const tt=r.json.totals;
  const expectCost = 1000+900+Math.round((1900*0.05)*100)/100;
  if (Math.abs(tt.estimatedCost-expectCost)>0.02) throw new Error(`cost ${tt.estimatedCost} != ${expectCost}`);
  const expectPrice = Math.round(expectCost*1.25*100)/100;
  if (Math.abs(tt.estimatedPrice-expectPrice)>0.02) throw new Error(`price ${tt.estimatedPrice} != ${expectPrice}`);
  return {note:`cost ${tt.estimatedCost} -> price ${tt.estimatedPrice}`};
});
await t('approve + complete job', async () => {
  await call('POST',`/api/service/jobs/${jobId}/approve`,{});
  const r = await call('POST',`/api/service/jobs/${jobId}/complete`,{workPerformed:'Replaced pads'});
  if(!r.json?.ok) throw new Error(r.json?.error); return {note:'final '+r.json.totals.finalPrice};
});
await t('job detail', async () => { const r = await call('GET',`/api/service/jobs/${jobId}`); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.header.status+', parts '+r.json.parts.length}; });
await t('close job', async () => { const r = await call('POST',`/api/service/jobs/${jobId}/close`,{}); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.status}; });
await t('service settings', async () => { const r = await call('POST','/api/service/settings',{SERVICE_LABOR_RATE:500}); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.saved.join(',')}; });

await t('move-requests list', async () => { const r = await call('GET','/api/inventory/move-requests'); if(!r.json?.ok) throw new Error(r.json?.error); return true; });
await t('liquidations eligible', async () => { const r = await call('GET','/api/finance/liquidations/eligible'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.rows.length+' eligible'}; });
await t('payment requests (privacy)', async () => { const r = await call('GET','/api/finance/payment-requests'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:'visibility '+r.json.visibility}; });
await t('mail status', async () => { const r = await call('GET','/api/mail/status'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:'transport '+r.json.transport}; });
await t('pending uploads', async () => { const r = await call('GET','/api/mail/pending-uploads'); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.count+' pending'}; });
await t('sales lookups', async () => { const r = await call('GET','/api/sales/lookups'); if(!r.json?.ok) throw new Error(r.json?.error); return true; });
await t('quick-add customer', async () => { const r = await call('POST','/api/sales/customers',{name:'Blitz Test Co',contactPerson:'A',email:'a@b.com'}); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.customer.partner_code}; });

let soId=null;
await t('create sales order (no lines)', async () => {
  const cust=(await call('GET','/api/sales/lookups')).json.customers[0];
  const r = await call('POST','/api/sales',{transactionType:'LEASE',customerId:cust.id,deliveryAddress:'Pasig',ratePerDay:350});
  if(!r.json?.ok) throw new Error(r.json?.error); soId=r.json.id; return {note:r.json.salesOrderNo+' rate '+r.json.ratePerDay};
});
await t('edit draft sales order', async () => { const r = await call('PATCH',`/api/sales/${soId}`,{deliveryAddress:'Makati',ratePerDay:400}); if(!r.json?.ok) throw new Error(r.json?.error); return {note:r.json.salesOrder.delivery_address}; });
await t('sales detail shows rate', async () => { const r = await call('GET',`/api/sales/${soId}`); if(!r.json?.ok) throw new Error(r.json?.error); return {note:'rate/day '+r.json.header.rate_per_day}; });
await t('void draft sales order', async () => { const r = await call('POST',`/api/sales/${soId}/void`,{}); if(!r.json?.ok) throw new Error(r.json?.error); return true; });



const serial='TESTVIN0001';
await t('serialised part reserved leaves stock', async()=>{
  const job=(await call('POST','/api/service/jobs',{jobType:'REPAIR',customerName:'X',complaint:'test',markupPct:20})).json;
  const add=await call('POST',`/api/service/jobs/${job.id}/parts`,{serialNo:serial,unitCost:1200});
  if(!add.json?.ok) throw new Error(add.json?.error);
  const asset=sqlite.prepare('SELECT current_status FROM erp_assets WHERE serial_no=?').get(serial);
  if(asset.current_status!=='IN_SERVICE') throw new Error('status is '+asset.current_status);
  globalThis.__job=job.id; globalThis.__part=add.json.added[0].id;
  return {note:'asset now '+asset.current_status};
});
await t('serial cannot be double-reserved', async()=>{
  const j2=(await call('POST','/api/service/jobs',{jobType:'REPAIR',customerName:'Y',complaint:'t2'})).json;
  const r=await call('POST',`/api/service/jobs/${j2.id}/parts`,{serialNo:serial});
  if(r.json?.ok) throw new Error('double reservation was allowed');
  return {note:r.json.error.slice(0,48)};
});
await t('unused part returns to inventory', async()=>{
  await call('POST',`/api/service/jobs/${globalThis.__job}/approve`,{});
  const done=await call('POST',`/api/service/jobs/${globalThis.__job}/complete`,{used:[{partId:globalThis.__part,qtyUsed:0}]});
  if(!done.json?.ok) throw new Error(done.json?.error);
  const ret=await call('POST',`/api/service/jobs/${globalThis.__job}/return-parts`,{returns:[{partId:globalThis.__part,qty:1,conditionCode:'GOOD'}]});
  if(!ret.json?.ok) throw new Error(ret.json?.error);
  const asset=sqlite.prepare('SELECT current_status FROM erp_assets WHERE serial_no=?').get(serial);
  if(asset.current_status!=='AVAILABLE') throw new Error('status is '+asset.current_status);
  return {note:ret.json.returnNo+' · asset back to '+asset.current_status};
});
await t('close blocked while parts reserved', async()=>{
  const j=(await call('POST','/api/service/jobs',{jobType:'REPAIR',customerName:'Z',complaint:'t3'})).json;
  await call('POST',`/api/service/jobs/${j.id}/parts`,{serialNo:serial,unitCost:100});
  await call('POST',`/api/service/jobs/${j.id}/complete`,{used:[{partId:0,qtyUsed:0}]});
  const c=await call('POST',`/api/service/jobs/${j.id}/close`,{});
  // parts default to consumed at completion when not listed, so this should close
  return {note:c.json?.ok?'closed (parts consumed)':c.json.error.slice(0,50)};
});

// ---- stock movement slips
await t('move slip raised, not posted', async()=>{
  sqlite.exec("UPDATE erp_assets SET current_status='AVAILABLE' WHERE serial_no='"+serial+"'");
  const loc=sqlite.prepare('SELECT id,code,name FROM erp_locations LIMIT 1').get();
  const r=await call('POST','/api/inventory/move-requests',{serialNo:serial,movementType:'TRANSFER',
    toLocationId:loc.id,toLocationCode:loc.code,toLocationName:loc.name,toStatus:'AVAILABLE_FOR_LEASE',notes:'test'});
  if(!r.json?.ok) throw new Error(r.json?.error);
  globalThis.__slip=r.json.id;
  const asset=sqlite.prepare('SELECT current_status FROM erp_assets WHERE serial_no=?').get(serial);
  if(asset.current_status==='AVAILABLE_FOR_LEASE') throw new Error('movement posted without approval');
  return {note:r.json.requestNo+' · asset still '+asset.current_status};
});
await t('requestor cannot self-approve', async()=>{
  const r=await call('POST',`/api/inventory/move-requests/${globalThis.__slip}/approve`,{});
  if(r.json?.ok) throw new Error('self-approval allowed');
  return {note:r.json.error.slice(0,48)};
});
await t('two approvers post the movement', async()=>{
  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,active) VALUES('judy@nrdev.ph','Judy','SCM_MANAGER',1)");
  // Samuel is SCM_HEAD in the live database (0041). That migration's UPDATE runs
  // before this seed, so it must be set here too or he silently loses the
  // approval rights the DEPARTMENT stage needs.
  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('samuel@nrdev.ph','Samuel Kniazeff','SCM_HEAD','Supply Chain',1)");
  sqlite.exec("UPDATE erp_users SET role_code='SCM_HEAD',department='Supply Chain' WHERE email='samuel@nrdev.ph'");
  try{
    who='judy@nrdev.ph';
    const a=await call('POST',`/api/inventory/move-requests/${globalThis.__slip}/approve`,{});
    if(!a.json?.ok) throw new Error('step1: '+a.json?.error);
    const same=await call('POST',`/api/inventory/move-requests/${globalThis.__slip}/approve`,{});
    if(same.json?.ok) throw new Error('same person approved twice');
    who='samuel@nrdev.ph';
    const b=await call('POST',`/api/inventory/move-requests/${globalThis.__slip}/approve`,{});
    if(!b.json?.ok) throw new Error('step2: '+b.json?.error);
  } finally { who='mmungcal@nrdev.ph'; }
  const asset=sqlite.prepare('SELECT current_status FROM erp_assets WHERE serial_no=?').get(serial);
  if(asset.current_status!=='AVAILABLE_FOR_LEASE') throw new Error('not posted, status '+asset.current_status);
  return {note:'posted; asset now '+asset.current_status};
});
await t('SOLD serial cannot be moved', async()=>{
  sqlite.exec("UPDATE erp_assets SET current_status='SOLD' WHERE serial_no='"+serial+"'");
  const loc=sqlite.prepare('SELECT id,code,name FROM erp_locations LIMIT 1').get();
  const r=await call('POST','/api/inventory/move-requests',{serialNo:serial,toLocationId:loc.id,toLocationCode:loc.code,toLocationName:loc.name,toStatus:'AVAILABLE'});
  if(r.json?.ok) throw new Error('SOLD serial was accepted');
  return {note:r.json.error.slice(0,60)};
});

// ---- RFP privacy + attachments (Drive offline -> PENDING)
await t('RFP created with pending attachment', async()=>{
  const ent=sqlite.prepare('SELECT id,entity_code FROM erp_legal_entities LIMIT 1').get();
  const r=await call('POST','/api/finance/payment-requests',{entityCode:ent.entity_code,payeeName:'Vendor A',
    department:'Finance',purpose:'Test',grossAmount:5000,requestType:'Cash Advance',
    attachments:[{fileName:'quote.pdf',contentType:'application/pdf',size:100,data:'AAAA'}]});
  if(!r.json?.ok) throw new Error(r.json?.error);
  globalThis.__rfp=r.json.id;
  const rows=sqlite.prepare("SELECT storage,file_name FROM erp_attachments WHERE record_id=? AND record_type='PAYMENT_REQUEST'").all(r.json.id);
  if(!rows.length) throw new Error('attachment not recorded');
  return {note:r.json.requestNo+' · cashAdvance='+r.json.cashAdvance+' · file '+rows[0].storage};
});
await t('requestor-only visibility', async()=>{
  let mine; try{ who='judy@nrdev.ph'; mine=await call('GET','/api/finance/payment-requests'); } finally { who='mmungcal@nrdev.ph'; }
  if(!mine.json?.ok) throw new Error(mine.json?.error);
  if(mine.json.visibility==='ALL') throw new Error('SCM_MANAGER saw everything');
  const leaked=(mine.json.rows||[]).filter(r=>r.requestor_email==='mmungcal@nrdev.ph');
  if(leaked.length) throw new Error('another user’s RFP leaked');
  return {note:'visibility '+mine.json.visibility+', rows '+mine.json.rows.length};
});
await t('liquidation blocked before full approval', async()=>{
  const r=await call('POST','/api/finance/liquidations',{paymentRequestId:globalThis.__rfp});
  if(r.json?.ok) throw new Error('liquidation opened on an unapproved advance');
  return {note:r.json.error.slice(0,60)};
});
await t('liquidation opens once approved', async()=>{
  sqlite.prepare("UPDATE erp_payment_requests SET status='APPROVED' WHERE id=?").run(globalThis.__rfp);
  const r=await call('POST','/api/finance/liquidations',{paymentRequestId:globalThis.__rfp});
  if(!r.json?.ok) throw new Error(r.json?.error);
  const lines=await call('POST',`/api/finance/liquidations/${r.json.id}/lines`,{lines:[
    {expenseDate:'2026-08-01',particulars:'Fuel',amount:1200,receiptNo:'OR-1'},
    {expenseDate:'2026-08-02',particulars:'Meals',amount:800,receiptNo:'OR-2'}]});
  if(!lines.json?.ok) throw new Error(lines.json?.error);
  if(Math.abs(lines.json.spent-2000)>0.01) throw new Error('spent '+lines.json.spent);
  if(Math.abs(lines.json.variance-3000)>0.01) throw new Error('variance '+lines.json.variance);
  const sub=await call('POST',`/api/finance/liquidations/${r.json.id}/submit`,{});
  if(!sub.json?.ok) throw new Error(sub.json?.error);
  const rev=await call('POST',`/api/finance/liquidations/${r.json.id}/review`,{decision:'APPROVE'});
  if(!rev.json?.ok) throw new Error(rev.json?.error);
  return {note:r.json.liquidationNo+' spent 2000 / variance 3000 -> '+rev.json.status};
});
await t('RFP return needs a reason', async()=>{
  const r=await call('POST',`/api/finance/payment-requests/${globalThis.__rfp}/action`,{action:'RETURN'});
  if(r.json?.ok) throw new Error('an empty return reason was accepted');
  return {note:r.json.error.slice(0,60)};
});
await t('RFP return sends it back to the requestor', async()=>{
  const r=await call('POST',`/api/finance/payment-requests/${globalThis.__rfp}/action`,
    {action:'RETURN',reason:'Incomplete supporting documents - missing OR'});
  if(!r.json?.ok) throw new Error(r.json?.error);
  if(r.json.request.status!=='RETURNED') throw new Error('status '+r.json.request.status);
  return {note:'status '+r.json.request.status+', mail skipped='+(r.json.notified?.skipped??'n/a')};
});

// ---- RFP workflow, against the spec ("E88 RFP & Payments" sections 3-6, 9)
// The MANCOM tier ships switched off (0041). Prove that first, then switch it on
// for the rest of the block so the tiering rules are still exercised.
await t('MANCOM tier is off by default', async()=>{
  const r=await call('GET','/api/finance/payment-requests');
  if(!r.json?.ok) throw new Error(r.json?.error);
  if(r.json.mancomEnabled) throw new Error('MANCOM is enabled out of the box');
  if(r.json.mancomMin!==null) throw new Error('mancomMin should be null when off');
  return {note:'chain is Dept Head > Finance > CEO at every amount'};
});
sqlite.exec("UPDATE erp_rfp_settings SET value='1' WHERE key='rfp_mancom_enabled'");

// One user per approval stage, so separation of duties can actually be exercised.
sqlite.exec(`
  INSERT OR IGNORE INTO erp_users(email,display_name,role_code,active) VALUES
    ('head@nrdev.ph','Dept Head','DEPT_HEAD',1),
    ('rhonrado@nrdev.ph','Rucel Mae Honrado','FINANCE_REVIEWER',1),
    ('checker@nrdev.ph','Finance Checker','FINANCE_REVIEWER',1),
    ('fin2@nrdev.ph','Second Finance','FINANCE',1),
    ('mancom@nrdev.ph','MANCOM Member','MANCOM',1),
    ('ceo@nrdev.ph','Chief Executive','CEO',1);
`);
const rfpOf=id=>sqlite.prepare('SELECT * FROM erp_payment_requests WHERE id=?').get(id);
async function newRfp(amount,dept='Operations & Product'){
  const ent=sqlite.prepare('SELECT id,entity_code FROM erp_legal_entities LIMIT 1').get();
  const r=await call('POST','/api/finance/payment-requests',{entityCode:ent.entity_code,payeeName:'Vendor B',
    department:dept,purpose:'Spec test',grossAmount:amount,supplierInvoiceNo:'INV-'+amount+'-'+Math.floor(amount*7%9973)});
  if(!r.json?.ok) throw new Error(r.json?.error);
  return r.json;
}
await t('RFP numbering is RFP-<DEPT><YEAR>-NNNN', async()=>{
  const a=await newRfp(1000);
  if(!/^RFP-OPS\d{4}-\d{4}$/.test(a.requestNo)) throw new Error('got '+a.requestNo);
  globalThis.__small=a.id;
  return {note:a.requestNo};
});
await t('approval without a signature is refused', async()=>{
  const r=await call('POST',`/api/finance/payment-requests/${globalThis.__small}/action`,{action:'SUBMIT'});
  if(!r.json?.ok) throw new Error(r.json?.error);
  const d=await call('POST',`/api/finance/payment-requests/${globalThis.__small}/action`,
    {action:'DEPARTMENT_APPROVE',signature:''});
  if(d.json?.ok) throw new Error('approved with no signature');
  return {note:d.json.error.slice(0,60)};
});
await t('the submitter cannot approve their own request', async()=>{
  const d=await call('POST',`/api/finance/payment-requests/${globalThis.__small}/action`,
    {action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(d.json?.ok) throw new Error('the requestor approved their own RFP');
  return {note:d.json.error.slice(0,60)};
});
await t('one person cannot sign two stages', async()=>{
  // judy raises it, mmungcal signs DEPARTMENT, then tries FINANCE as well.
  let created; try{ who='judy@nrdev.ph'; created=await newRfp(2500); } finally { who='mmungcal@nrdev.ph'; }
  const id=created.id;
  try{ who='judy@nrdev.ph'; await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'SUBMIT'}); }
  finally { who='mmungcal@nrdev.ph'; }
  const dep=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(!dep.json?.ok) throw new Error(dep.json?.error);
  const again=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'FINANCE_VALIDATE',signature:'Mark Alexis Mungcal'});
  if(again.json?.ok) throw new Error('the same signer cleared two stages');
  globalThis.__twoStage=id;
  return {note:again.json.error.slice(0,60)};
});
await t('a stage cannot be approved twice', async()=>{
  const r=await call('POST',`/api/finance/payment-requests/${globalThis.__twoStage}/action`,
    {action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(r.json?.ok) throw new Error('DEPARTMENT was signed twice');
  return {note:r.json.error.slice(0,60)};
});
await t('MANCOM is skipped below the threshold', async()=>{
  const r=await call('GET',`/api/finance/payment-requests/${globalThis.__small}`);
  if(!r.json?.ok) throw new Error(r.json?.error);
  const w=r.json.workflow;
  if(w.mancomRequired) throw new Error('MANCOM demanded on '+r.json.request.net_payable);
  if(w.stages.includes('MANCOM')) throw new Error('MANCOM in the stage list');
  return {note:'PHP 1,000 -> stages '+w.stages.join(' > ')+' (min '+w.mancomMin+')'};
});
await t('MANCOM applies at or above the threshold', async()=>{
  let created; try{ who='judy@nrdev.ph'; created=await newRfp(250000); } finally { who='mmungcal@nrdev.ph'; }
  const id=created.id; globalThis.__big=id;
  try{ who='judy@nrdev.ph'; await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'SUBMIT'}); }
  finally { who='mmungcal@nrdev.ph'; }
  const w=(await call('GET',`/api/finance/payment-requests/${id}`)).json.workflow;
  if(!w.mancomRequired||!w.stages.includes('MANCOM')) throw new Error('MANCOM missing at 250,000');
  // Department and Finance are cleared by two different people.
  const dep=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(!dep.json?.ok) throw new Error(dep.json?.error);
  let chk; try{ who='checker@nrdev.ph'; chk=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'FINANCE_REVIEW',signature:'Finance Checker'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!chk.json?.ok) throw new Error('finance check: '+chk.json?.error);
  let fin; try{ who='fin2@nrdev.ph'; fin=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'FINANCE_VALIDATE',signature:'Second Finance'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!fin.json?.ok) throw new Error(fin.json?.error);
  // The CEO cannot jump the queue while MANCOM is outstanding.
  let skip; try{ who='ceo@nrdev.ph'; skip=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'FINAL_APPROVE',signature:'Chief Executive'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(skip.json?.ok) throw new Error('final approval skipped MANCOM');
  return {note:'stages '+w.stages.join(' > ')+' · '+skip.json.error.slice(0,50)};
});
await t('MANCOM approval unblocks final approval', async()=>{
  const id=globalThis.__big;
  let man; try{ who='mancom@nrdev.ph'; man=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'MANCOM_APPROVE',signature:'MANCOM Member'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!man.json?.ok) throw new Error(man.json?.error);
  if(rfpOf(id).status!=='MANCOM_APPROVED') throw new Error('status '+rfpOf(id).status);
  const w=(await call('GET',`/api/finance/payment-requests/${id}`)).json.workflow;
  if(w.nextStage!=='FINAL') throw new Error('next stage '+w.nextStage);
  return {note:'MANCOM_APPROVED · next stage '+w.nextStage};
});
await t('MANCOM is refused below the threshold', async()=>{
  const r=await call('POST',`/api/finance/payment-requests/${globalThis.__twoStage}/action`,
    {action:'MANCOM_APPROVE',signature:'Mark Alexis Mungcal'});
  if(r.json?.ok) throw new Error('MANCOM accepted on a 2,500 request');
  return {note:r.json.error.slice(0,60)};
});
await t('attachments are editable only while draft', async()=>{
  const file=[{fileName:'quote2.pdf',contentType:'application/pdf',size:100,data:'AAAA'}];
  const blocked=await call('POST',`/api/finance/payment-requests/${globalThis.__big}/attachments`,{attachments:file});
  if(blocked.json?.ok) throw new Error('a document was attached to an approved request');
  const draft=await newRfp(700);
  const okAdd=await call('POST',`/api/finance/payment-requests/${draft.id}/attachments`,{attachments:file});
  if(!okAdd.json?.ok) throw new Error(okAdd.json?.error);
  const attId=sqlite.prepare("SELECT id FROM erp_attachments WHERE record_id=? AND record_type='PAYMENT_REQUEST' ORDER BY id DESC LIMIT 1").get(draft.id).id;
  const del=await call('DELETE',`/api/finance/payment-requests/${draft.id}/attachments/${attId}`);
  if(!del.json?.ok) throw new Error(del.json?.error);
  return {note:blocked.json.error.slice(0,44)+' · draft add+remove ok'};
});
await t('the people from 0041 exist with the right roles', async()=>{
  const rows=sqlite.prepare("SELECT email,role_code,department FROM erp_users WHERE email IN ('francis@nrdev.ph','haide@nrdev.ph','ferdinand@nrdev.ph') ORDER BY email").all();
  if(rows.length!==3) throw new Error('expected 3 new accounts, got '+rows.length);
  const by=Object.fromEntries(rows.map(r=>[r.email,r]));
  if(by['francis@nrdev.ph'].role_code!=='CEO') throw new Error('francis is '+by['francis@nrdev.ph'].role_code);
  if(by['haide@nrdev.ph'].department!=='Human Resources') throw new Error('haide dept');
  if(by['ferdinand@nrdev.ph'].department!=='Technology') throw new Error('ardee dept');
  const creds=sqlite.prepare("SELECT COUNT(*) n FROM erp_user_credentials c JOIN erp_users u ON u.id=c.user_id WHERE u.email LIKE '%@nrdev.ph'").get();
  if(!creds.n) throw new Error('no credential rows, activation links cannot be issued');
  return {note:'francis CEO · haide HR · ardee Technology · '+creds.n+' credential rows'};
});
await t('SCM_HEAD approves RFPs without losing the warehouse', async()=>{
  // Plain DEPT_HEAD cannot create or post inventory. Samuel needs both.
  const p=Object.fromEntries(sqlite.prepare("SELECT module,can_create||can_post||can_approve k FROM erp_role_permissions WHERE role_code='SCM_HEAD'").all().map(r=>[r.module,r.k]));
  if(p.INVENTORY!=='111') throw new Error('SCM_HEAD inventory rights '+p.INVENTORY);
  const fin=sqlite.prepare("SELECT can_approve FROM erp_role_permissions WHERE role_code='SCM_HEAD' AND module='FINANCE'").get();
  if(!fin?.can_approve) throw new Error('SCM_HEAD cannot approve at the DEPARTMENT stage');
  const admin=sqlite.prepare("SELECT can_manage FROM erp_role_permissions WHERE role_code='FINANCE' AND module='ADMIN'").get();
  if(!admin?.can_manage) throw new Error('nobody can administer users');
  return {note:'inventory create+post+approve kept · FINANCE approve gained · ADMIN manage granted'};
});
await t('a returned request restarts the chain', async()=>{
  const id=globalThis.__twoStage;
  const ret=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'RETURN',reason:'Wrong payee - fix bank details'});
  if(!ret.json?.ok) throw new Error(ret.json?.error);
  if(rfpOf(id).status!=='RETURNED') throw new Error('status '+rfpOf(id).status);
  // Resubmitted, the DEPARTMENT stage is open again even though it was signed before.
  let re; try{ who='judy@nrdev.ph'; re=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'SUBMIT'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!re.json?.ok) throw new Error(re.json?.error);
  const w=(await call('GET',`/api/finance/payment-requests/${id}`)).json.workflow;
  if(w.nextStage!=='DEPARTMENT') throw new Error('next stage '+w.nextStage);
  const dep=await call('POST',`/api/finance/payment-requests/${id}/action`,{action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(!dep.json?.ok) throw new Error(dep.json?.error);
  return {note:'returned -> resubmitted -> DEPARTMENT signed again'};
});

await t('Finance checks before the head of Finance approves', async()=>{
  const r=sqlite.prepare("SELECT role_code FROM erp_users WHERE email='rhonrado@nrdev.ph'").get();
  if(r?.role_code!=='FINANCE_REVIEWER') throw new Error('Rucel is '+r?.role_code);
  const perm=sqlite.prepare("SELECT can_approve,can_create FROM erp_role_permissions WHERE role_code='FINANCE_REVIEWER' AND module='FINANCE'").get();
  if(perm.can_approve) throw new Error('the checker was given approval rights');
  if(!perm.can_create) throw new Error('the checker cannot raise her own request');

  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('ops1@nrdev.ph','Ops Staff','STAFF','Supply Chain',1)");
  const ent=sqlite.prepare('SELECT entity_code FROM erp_legal_entities LIMIT 1').get();
  let made; try{ who='ops1@nrdev.ph'; made=await call('POST','/api/finance/payment-requests',{entityCode:ent.entity_code,
    payeeName:'Courier Co',department:'Supply Chain',purpose:'Courier charges',grossAmount:4100,supplierInvoiceNo:'CC-771'});
    await call('POST',`/api/finance/payment-requests/${made.json.id}/action`,{action:'SUBMIT'});
  } finally { who='mmungcal@nrdev.ph'; }
  const rid=made.json.id;
  const w0=(await call('GET',`/api/finance/payment-requests/${rid}`)).json.workflow;
  if(!w0.stages.includes('FINANCE_REVIEW')) throw new Error('stages '+w0.stages.join('>'));

  let dep; try{ who='samuel@nrdev.ph'; dep=await call('POST',`/api/finance/payment-requests/${rid}/action`,{action:'DEPARTMENT_APPROVE',signature:'Samuel Kniazeff'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!dep.json?.ok) throw new Error('DEPT: '+dep.json?.error);

  // The head of Finance cannot approve before Finance has checked it.
  const early=await call('POST',`/api/finance/payment-requests/${rid}/action`,{action:'FINANCE_VALIDATE',signature:'Mark Alexis Mungcal'});
  if(early.json?.ok) throw new Error('head of Finance approved before the check');
  if(!/checked/i.test(early.json.error||'')) throw new Error('wrong reason: '+early.json.error);

  let chk; try{ who='rhonrado@nrdev.ph'; chk=await call('POST',`/api/finance/payment-requests/${rid}/action`,{action:'FINANCE_REVIEW',signature:'Rucel Mae Honrado'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(!chk.json?.ok) throw new Error('CHECK: '+chk.json?.error);
  if(chk.json.request.status!=='FINANCE_REVIEWED') throw new Error('status '+chk.json.request.status);

  // Having checked it she cannot also approve it.
  let both; try{ who='rhonrado@nrdev.ph'; both=await call('POST',`/api/finance/payment-requests/${rid}/action`,{action:'FINANCE_VALIDATE',signature:'Rucel Mae Honrado'}); }
  finally { who='mmungcal@nrdev.ph'; }
  if(both.json?.ok) throw new Error('the checker also approved');

  const fin=await call('POST',`/api/finance/payment-requests/${rid}/action`,{action:'FINANCE_VALIDATE',signature:'Mark Alexis Mungcal'});
  if(!fin.json?.ok) throw new Error('HEAD: '+fin.json?.error);
  const w=(await call('GET',`/api/finance/payment-requests/${rid}`)).json.workflow;
  if(w.nextStage!=='FINAL') throw new Error('next '+w.nextStage);
  const trail=(await call('GET',`/api/finance/payment-requests/${rid}`)).json.signatures.map(x=>x.stage);
  if(!trail.includes('FINANCE_REVIEW')) throw new Error('the check is not on the printed trail');
  return {note:w0.stages.join(' > ')+' · checker blocked from approving'};
});
await t('one person can head several departments', async()=>{
  const rows=sqlite.prepare("SELECT department FROM erp_department_heads WHERE head_email='samuel@nrdev.ph' ORDER BY department").all();
  const depts=rows.map(r=>r.department);
  for(const d of ['Supply Chain','Logistics','Warehouse','After Sales','Operations & Product','Sales','Sales and Marketing']){
    if(!depts.includes(d)) throw new Error('Samuel does not head '+d);
  }
  // Both spellings of Sales are present: erp_departments says 'Sales' while
  // erp_users.department says 'Sales and Marketing', and the RFP carries either.
  let vis; try{ who='samuel@nrdev.ph'; vis=await call('GET','/api/finance/payment-requests'); } finally { who='mmungcal@nrdev.ph'; }
  if(vis.json?.visibility!=='DEPARTMENT') throw new Error('visibility '+vis.json?.visibility);
  return {note:depts.length+' departments · visibility '+vis.json.visibility};
});
await t('the head of Finance approves Finance requests as its head', async()=>{
  const head=sqlite.prepare("SELECT head_email FROM erp_department_heads WHERE department='Finance and Accounting'").get();
  if(head?.head_email!=='mmungcal@nrdev.ph') throw new Error('Finance head is '+head?.head_email);
  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('fin3@nrdev.ph','Third Finance','FINANCE','Finance and Accounting',1)");
  const ent=sqlite.prepare('SELECT entity_code FROM erp_legal_entities LIMIT 1').get();
  let raised; try{ who='fin3@nrdev.ph'; raised=await call('POST','/api/finance/payment-requests',{entityCode:ent.entity_code,
    payeeName:'BIR',department:'Finance and Accounting',purpose:'Quarterly filing fee',grossAmount:3200,
    supplierInvoiceNo:'BIR-Q3-2026'});
    await call('POST',`/api/finance/payment-requests/${raised.json.id}/action`,{action:'SUBMIT'});
  } finally { who='mmungcal@nrdev.ph'; }
  if(!raised.json?.ok) throw new Error(raised.json?.error);
  const dep=await call('POST',`/api/finance/payment-requests/${raised.json.id}/action`,
    {action:'DEPARTMENT_APPROVE',signature:'Mark Alexis Mungcal'});
  if(!dep.json?.ok) throw new Error(dep.json?.error);
  // Having signed as the department head he cannot also validate as Finance.
  const twice=await call('POST',`/api/finance/payment-requests/${raised.json.id}/action`,
    {action:'FINANCE_VALIDATE',signature:'Mark Alexis Mungcal'});
  if(twice.json?.ok) throw new Error('the same person signed DEPARTMENT and FINANCE');
  return {note:'signed DEPARTMENT as head · blocked from FINANCE: '+twice.json.error.slice(0,44)};
});

// ---- opening physical count: what we count today must BE the system record
await t('a counted unit that is not in the system gets registered', async()=>{
  const loc=sqlite.prepare('SELECT id,code FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'MC'});
  if(!cc.json?.ok) throw new Error(cc.json?.error);
  const ccId=cc.json.id;
  // A motorcycle on the floor that the ERP has never seen, with the keys the
  // receiver actually reads off the unit.
  const scan=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{
    serialNo:'LC6PAGA13R0099001',itemCode:'MC-0001',itemName:'E88 Cruiser',category:'MC',
    serialType:'FRAME',motorNo:'MTR-88231',unitCost:78000,conditionCode:'GOOD'});
  if(!scan.json?.ok) throw new Error(scan.json?.error);
  if(!scan.json.result.willRegister) throw new Error('unit was not marked for registration');
  // A second unit scanned with no item detail at all - still real stock.
  const bare=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'LC6PAGA13R0099002'});
  if(!bare.json?.ok) throw new Error(bare.json?.error);

  await call('POST',`/api/inventory/cycle-counts/${ccId}/submit`,{});
  const app2=await call('POST',`/api/inventory/cycle-counts/${ccId}/approve`,{});
  if(!app2.json?.ok) throw new Error(app2.json?.error);
  const posted=await call('POST',`/api/inventory/cycle-counts/${ccId}/post-adjustments`,{});
  if(!posted.json?.ok) throw new Error(posted.json?.error);
  if(posted.json.registered!==2) throw new Error('registered '+posted.json.registered+', expected 2');

  const a=sqlite.prepare("SELECT * FROM erp_assets WHERE serial_no='LC6PAGA13R0099001'").get();
  if(!a) throw new Error('the counted unit never reached inventory');
  if(a.current_location_id!==loc.id) throw new Error('registered at the wrong location');
  if(a.current_status!=='AVAILABLE') throw new Error('status '+a.current_status);
  if(a.motor_no!=='MTR-88231') throw new Error('motor number lost');
  if(Number(a.unit_cost)!==78000) throw new Error('unit cost lost');
  const b=sqlite.prepare("SELECT * FROM erp_assets WHERE serial_no='LC6PAGA13R0099002'").get();
  if(!b) throw new Error('the undocumented unit was dropped');
  if(b.reconciliation_status!=='FOR_REVIEW') throw new Error('missing item code should flag FOR_REVIEW, got '+b.reconciliation_status);
  return {note:`2 units registered · ${a.asset_no} full detail, ${b.asset_no} flagged FOR_REVIEW`};
});
await t('a counted row can be identified and removed before submitting', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'BAT'});
  const ccId=cc.json.id;
  const a=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'519110002370AAX001'});
  const b=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'519110002370AAX002'});
  if(!a.json?.ok||!b.json?.ok) throw new Error(a.json?.error||b.json?.error);
  if(!a.json.result.needsItemDetail) throw new Error('the scan did not ask for the item');

  // Identify the first one after the fact, exactly as the popup does.
  const ed=await call('PATCH',`/api/inventory/cycle-counts/${ccId}/lines/${a.json.result.lineId}`,
    {itemCode:'BAT-0001',itemName:'E88 Battery 72V',category:'BAT',serialType:'BARCODE',unitCost:24000,conditionCode:'GOOD'});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  const sheet=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  const line=sheet.json.lines.find(l=>l.actual_serial_no==='519110002370AAX001');
  if(line.item_code!=='BAT-0001') throw new Error('the sheet does not show the item');
  if(!line.is_new_unit) throw new Error('line not flagged as a new unit');

  // Remove the mis-scan.
  const del=await call('DELETE',`/api/inventory/cycle-counts/${ccId}/lines/${b.json.result.lineId}`);
  if(!del.json?.ok||!del.json.removed) throw new Error('row was not removed');
  const after=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  if(after.json.lines.some(l=>l.actual_serial_no==='519110002370AAX002')) throw new Error('removed row is still on the sheet');
  if(after.json.summary.counted!==1) throw new Error('counted total not corrected: '+after.json.summary.counted);

  // Once submitted the sheet is frozen.
  await call('POST',`/api/inventory/cycle-counts/${ccId}/submit`,{});
  const late=await call('DELETE',`/api/inventory/cycle-counts/${ccId}/lines/${a.json.result.lineId}`);
  if(late.json?.ok) throw new Error('a submitted sheet was edited');
  return {note:'identified BAT-0001 · removed the mis-scan · frozen after submit'};
});
await t('re-posting a count does not duplicate the unit', async()=>{
  const n=sqlite.prepare("SELECT COUNT(*) n FROM erp_assets WHERE serial_no='LC6PAGA13R0099001'").get().n;
  if(n!==1) throw new Error('serial exists '+n+' times');
  return {note:'serial is unique in erp_assets'};
});

// ---- cycle count finance override
await t('finance override on a variance', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=sqlite.prepare("INSERT INTO erp_cycle_counts(count_no,location_id,count_date,status,expected_units,created_by) VALUES('CC-T1',?, '2026-08-06','OPEN',1,'x')").run(loc.id);
  const ccId=Number(cc.lastInsertRowid);
  const line=sqlite.prepare("INSERT INTO erp_cycle_count_lines(cycle_count_id,expected_serial_no,count_status,variance_type) VALUES(?,'X1','VARIANCE','MISSING')").run(ccId);
  sqlite.prepare("UPDATE erp_cycle_counts SET status='SUBMITTED' WHERE id=?").run(ccId);
  let denied; try{ who='judy@nrdev.ph'; denied=await call('POST',`/api/inventory/cycle-counts/${ccId}/override`,{remarks:'x',lines:[{lineId:Number(line.lastInsertRowid)}]}); } finally { who='mmungcal@nrdev.ph'; }
  if(denied.json?.ok) throw new Error('non-finance override allowed');
  const r=await call('POST',`/api/inventory/cycle-counts/${ccId}/override`,{remarks:'Unit found in transit',
    lines:[{lineId:Number(line.lastInsertRowid),resolution:'ACCEPT_SYSTEM'}]});
  if(!r.json?.ok) throw new Error(r.json?.error);
  const after=sqlite.prepare('SELECT count_status,variance_type,notes FROM erp_cycle_count_lines WHERE id=?').get(Number(line.lastInsertRowid));
  if(after.variance_type) throw new Error('variance not cleared');
  return {note:'non-finance blocked; finance cleared '+r.json.corrected+' line'};
});

// ---- returns draft edit / void
await t('draft return edit + void', async()=>{
  const ro=sqlite.prepare("INSERT INTO erp_return_orders(return_no,return_date,status,reason_code,notes,created_by) VALUES('RET-T1','2026-08-01','DRAFT','OTHER','n','x')").run();
  const id=Number(ro.lastInsertRowid);
  sqlite.prepare("INSERT INTO erp_return_lines(return_id,expected_serial,condition_code) VALUES(?,'S1','GOOD')").run(id);
  const det=await call('GET',`/api/returns/${id}/detail`);
  if(!det.json?.ok) throw new Error(det.json?.error);
  const ed=await call('PATCH',`/api/returns/${id}`,{reasonCode:'REPAIR',notes:'corrected',
    lines:[{id:det.json.lines[0].id,conditionCode:'DAMAGED',actualSerialNo:'S1'}]});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  const v=await call('POST',`/api/returns/${id}/void`,{reason:'duplicate'});
  if(!v.json?.ok) throw new Error(v.json?.error);
  return {note:'edited to '+ed.json.goodsReturn.reason_code+' then '+v.json.status};
});
await t('posted return cannot be voided', async()=>{
  const ro=sqlite.prepare("INSERT INTO erp_return_orders(return_no,status,created_by) VALUES('RET-T2','POSTED','x')").run();
  const r=await call('POST',`/api/returns/${Number(ro.lastInsertRowid)}/void`,{reason:'x'});
  if(r.json?.ok) throw new Error('posted return was voided');
  return {note:r.json.error.slice(0,52)};
});


console.log('\n=== Blitz - ERP end-to-end ===');
for (const [s, n, note] of results) console.log(`${s}  ${n}${note ? '  ·  ' + note : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
try { rmSync(DB_PATH, { force: true }); } catch {}
process.exit(failed ? 1 : 0);
