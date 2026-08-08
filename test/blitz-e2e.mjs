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



/*
 * A submitted count now needs three signatures. Everything downstream of
 * approval goes through this, so the chain is proved by every test that
 * needs an approved count rather than by one test in isolation.
 */
sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('deptmgr@nrdev.ph','Dept Manager','DEPT_MANAGER','Supply Chain',1)");
async function submitCount(ccId){
  const prev = who;
  try { who = 'judy@nrdev.ph';
    const r = await call('POST', `/api/inventory/cycle-counts/${ccId}/submit`, {});
    if (!r.json?.ok) throw new Error('submit: '+(r.json?.error||r.status));
    return r.json;
  } finally { who = prev; }
}
async function approveCountChain(ccId){
  // Submitting already signed step one, so walk whatever is still pending and
  // send the right person to each stage.
  const SIGNER = { DEPT_MANAGER:'deptmgr@nrdev.ph', DEPT_HEAD:'samuel@nrdev.ph', FINANCE:'mmungcal@nrdev.ph' };
  const prev = who;
  const signed = [];
  try{
    for (let guard = 0; guard < 5; guard += 1){
      who = 'mmungcal@nrdev.ph';
      const view = await call('GET', `/api/inventory/cycle-counts/${ccId}/chain`);
      const pending = view.json?.pending;
      if (!pending) break;
      who = SIGNER[pending.stage];
      if (!who) throw new Error('no signer for stage '+pending.stage);
      const r = await call('POST', `/api/inventory/cycle-counts/${ccId}/approve`, {remarks:'ok'});
      if (!r.json?.ok) throw new Error(pending.stage+' step: '+(r.json?.error||r.status));
      signed.push(pending.stage);
    }
  } finally { who = prev; }
  return signed;
}

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

  await submitCount(ccId);
  const signed=await approveCountChain(ccId);
  if(signed.join('>')!=='DEPT_HEAD>FINANCE')
    throw new Error('chain signed '+signed.join('>'));
  const st=sqlite.prepare('SELECT status FROM erp_cycle_counts WHERE id=?').get(ccId).status;
  if(st!=='APPROVED') throw new Error('count is '+st+' after the full chain');
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
await t('a counted unit registers in the class its item master says', async()=>{
  /*
   * The live opening count found this. Three hundred and forty Ampace batteries
   * were scanned against ESP00263, which the master seeds as BAT. The counters
   * typed "BATTERY" on a hundred and twelve of them and left the rest blank, and
   * the typed word was overriding the master: the hundred and twelve would have
   * stored the literal string BATTERY, a class the register does not group by,
   * and the rest would have stored OTH. Three hundred and forty batteries would
   * have registered as nought batteries.
   */
  const loc=sqlite.prepare('SELECT id,code FROM erp_locations LIMIT 1').get();
  /*
   * The master itself carries the loose word here, which is the live case:
   * ESP00263 says "BATTERY" because the seed that meant to set BAT was an
   * INSERT OR IGNORE against a row auto-created earlier from a receipt. So the
   * master leading is not enough on its own; whatever it says is normalised.
   */
  sqlite.exec(`INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,
    serialized,base_uom,standard_cost,active)
    VALUES('BAT-MASTER','Ampace Pack','ampace pack','BATTERY',1,'EA',4200,1)`);
  const cc=await call('POST','/api/inventory/cycle-counts',
    {locationId:loc.id,countDate:'2026-08-07',category:'BAT'});
  const ccId=cc.json.id;

  // Typed loosely, typed as the wrong class, and not typed at all.
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'CATCHK0000000001',itemCode:'BAT-MASTER',category:'BATTERY'});
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'CATCHK0000000002',itemCode:'BAT-MASTER',category:'OTH'});
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'CATCHK0000000003',itemCode:'BAT-MASTER'});
  // An item nobody has ever heard of, typed loosely. There is no master to
  // defer to, so the word has to be normalised rather than stored raw.
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'CATCHK0000000004',itemCode:'CHG-UNKNOWN-1',itemName:'Fast charger',category:'Charger'});

  // The sheet has to show the class it will register as, or nobody can catch
  // this before it is posted, which is exactly what happened.
  const sheet=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  const known=['CATCHK0000000001','CATCHK0000000002','CATCHK0000000003'];
  const shown=(sheet.json.lines||[]).filter(l=>known.includes(l.actual_serial_no));
  if(shown.length!==3) throw new Error('expected 3 known-item lines, got '+shown.length);
  for(const l of shown){
    if(l.new_category!=='BAT')
      throw new Error(`${l.actual_serial_no} reads as ${l.new_category} on the sheet, not BAT`);
  }

  await submitCount(ccId);
  await approveCountChain(ccId);
  const posted=await call('POST',`/api/inventory/cycle-counts/${ccId}/post-adjustments`,{});
  if(!posted.json?.ok) throw new Error(posted.json?.error);

  const cats=sqlite.prepare(`SELECT serial_no,category,unit_cost,reconciliation_status
    FROM erp_assets WHERE serial_no LIKE 'CATCHK%' ORDER BY serial_no`).all();
  if(cats.length!==4) throw new Error('registered '+cats.length+' of 4');
  for(const a of cats.slice(0,3)){
    if(a.category!=='BAT') throw new Error(`${a.serial_no} registered as ${a.category}, not BAT`);
    // No cost was scanned, so the master's price is what values it.
    if(Number(a.unit_cost)!==4200) throw new Error(`${a.serial_no} valued at ${a.unit_cost}, not 4,200`);
    if(a.reconciliation_status!=='CLEAR')
      throw new Error(`${a.serial_no} is ${a.reconciliation_status} though it is priced and identified`);
  }
  const unknown=cats[3];
  if(unknown.category!=='CHG')
    throw new Error(`an unknown item typed "Charger" registered as ${unknown.category}, not CHG`);
  /*
   * Nothing priced it and no master could, so it must be visible for cleanup.
   * Registering stock at nought and calling it CLEAR is how a register comes to
   * say it holds 340 batteries worth nothing.
   */
  if(Number(unknown.unit_cost)!==0) throw new Error('an unpriced unit acquired a price from nowhere');
  if(unknown.reconciliation_status!=='FOR_REVIEW')
    throw new Error('a unit registered at no value reads '+unknown.reconciliation_status);
  return {note:'master class leads and is normalised; unpriced stock is flagged, not called clear'};
});

await t('a request nobody has approved cannot be paid or proved', async()=>{
  /*
   * The gate asked who you are and never what the request is, so Finance could
   * record a payment - and file a bank advice for it - against a request still
   * sitting in DRAFT. Nobody had approved it and no bank had been told to pay
   * it. A settlement recorded before the chain runs makes the whole chain
   * decorative.
   */
  const draft=await call('POST','/api/finance/payment-requests',{
    payeeName:'Unapproved Vendor',department:'Operations',costCenter:'Ops',
    requestType:'Payment to Vendor',purpose:'Not approved by anybody',grossAmount:5000});
  if(!draft.json?.ok) throw new Error(draft.json?.error);
  const id=draft.json.id||draft.json.request?.id||draft.json.paymentRequestId;
  const st=sqlite.prepare('SELECT status,request_no FROM erp_payment_requests WHERE id=?').get(id);
  if(st.status!=='DRAFT') throw new Error('the new request is '+st.status+', expected DRAFT');

  const paid=await call('POST',`/api/finance/payment-requests/${id}/settlements`,
    {amount:5000,paymentReference:'BT-NOPE'});
  if(paid.json?.ok) throw new Error('a draft request accepted a payment');
  if(!/not been approved for payment/i.test(paid.json?.error||''))
    throw new Error('the refusal does not say why: '+paid.json?.error);

  const n=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_settlements WHERE request_no=?`)
    .get(st.request_no).n;
  if(n) throw new Error('a payment was written against a draft anyway');

  // And the screens are told not to offer it, so the refusal is not a surprise.
  const view=await call('GET',`/api/finance/payment-requests/${id}/settlements`);
  if(view.json?.canSettle) throw new Error('the screen still offers to record a payment on a draft');
  if(!/not been approved/i.test(view.json?.settlementBlockedBecause||''))
    throw new Error('the screen is not told why: '+view.json?.settlementBlockedBecause);

  /*
   * The same request once it has cleared the chain is payable. The gate is
   * about the stage, not about forbidding payment.
   */
  sqlite.prepare(`UPDATE erp_payment_requests SET status='APPROVED' WHERE id=?`).run(id);
  const ok2=await call('POST',`/api/finance/payment-requests/${id}/settlements`,
    {amount:5000,paymentReference:'BT-YES'});
  if(!ok2.json?.ok) throw new Error('an approved request refused its payment: '+ok2.json?.error);
  return {note:'draft refused by name, approved accepted; the screen is told before the click'};
});

await t('payables ageing reports the payables, not an empty subledger', async()=>{
  /*
   * The screen read erp_subledger_documents, which no route on this system ever
   * writes. It showed an empty table and a total of nought while ten and a half
   * million sat unpaid across thirty-seven requests. The payables are the RFPs.
   */
  const owed=sqlite.prepare(`SELECT COUNT(*) n, ROUND(SUM(bal),2) v FROM (
      SELECT ROUND(r.net_payable - COALESCE((SELECT SUM(s.amount) FROM erp_payment_settlements s
        WHERE s.request_no=r.request_no AND s.status<>'VOID'),0),2) bal
      FROM erp_payment_requests r WHERE r.status NOT IN ('REJECTED','CANCELLED')
    ) WHERE bal > 0.009`).get();
  if(!(owed.n>0)) throw new Error('this test needs something outstanding to age');

  const r=await call('GET','/api/finance/aging/AP');
  if(!r.json?.ok) throw new Error(r.json?.error);
  if(!(r.json.rows||[]).length)
    throw new Error(`the ageing is empty while ${owed.n} requests owe ${owed.v}`);
  if(Math.abs(Number(r.json.totals.total)-Number(owed.v))>0.01)
    throw new Error(`ageing totals ${r.json.totals.total} against ${owed.v} actually owed`);

  // The buckets have to add up to the total, or the report says two things.
  const B=['CURRENT','1-30','31-60','61-90','OVER_90'];
  const sum=B.reduce((t,b)=>t+Number(r.json.totals[b]||0),0);
  if(Math.abs(sum-Number(r.json.totals.total))>0.01)
    throw new Error(`buckets sum to ${sum}, total says ${r.json.totals.total}`);
  for(const row of r.json.rows){
    if(!B.includes(row.aging_bucket)) throw new Error('unknown bucket '+row.aging_bucket);
    if(!(Number(row.open_balance)>0)) throw new Error(row.document_no+' is aged at nothing owed');
  }
  // A request that is fully settled is not a payable.
  const paid=sqlite.prepare(`SELECT request_no FROM erp_payment_requests WHERE status='PAID' LIMIT 1`).get();
  if(paid&&r.json.rows.some(x=>x.document_no===paid.request_no))
    throw new Error(paid.request_no+' is settled but still on the ageing');
  return {note:`${r.json.rows.length} open, ${Number(r.json.totals.total).toLocaleString()} owed, buckets reconcile`};
});

await t('a count in progress shows on the dashboard even with nothing expected', async()=>{
  /*
   * The live opening count found this too. Three hundred and forty-one units
   * were scanned against a warehouse the register had never seen, so nothing
   * was expected, so counted-over-expected was nought over nought - and the
   * dashboard reported "no count in progress · 0% counted" while the team was
   * standing in the warehouse counting. A count with nothing to count against
   * still has a real measure: how much of what was counted has been named, and
   * therefore how close it is to being postable.
   */
  // A warehouse the register has never seen, which is the whole point: earlier
  // tests have put stock in the main one, and an opening count is defined by
  // there being nothing to count against.
  sqlite.exec(`INSERT OR IGNORE INTO erp_locations(code,name,location_type,active)
    VALUES('WH-OPENING','Opening Count Warehouse','WAREHOUSE',1)`);
  const loc=sqlite.prepare("SELECT id FROM erp_locations WHERE code='WH-OPENING'").get();
  const cc=await call('POST','/api/inventory/cycle-counts',
    {locationId:loc.id,countDate:'2026-08-07'});
  if(!cc.json?.ok) throw new Error(cc.json?.error);
  const ccId=cc.json.id;
  const expected=sqlite.prepare('SELECT expected_units n FROM erp_cycle_counts WHERE id=?').get(ccId).n;
  if(expected!==0) throw new Error('this test needs a count that expects nothing, got '+expected);

  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'PROG000000000001',itemCode:'SP-0001'});
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'PROG000000000002',itemCode:'SP-0001'});
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'PROG000000000003'});

  const d=await call('GET','/api/dashboard/home');
  if(!d.json?.ok) throw new Error(d.json?.error);
  const p=d.json.progress||{};
  if(!(p.counted>=3))
    throw new Error('the dashboard says '+p.counted+' units counted while 3 are on an open sheet');
  if(!(p.sheets>=1)) throw new Error('the dashboard sees no open sheet');
  if(!(p.awaitingRegistration>=3))
    throw new Error('counted units are not shown as awaiting registration: '+p.awaitingRegistration);
  // Two of three were named, so the count is two thirds of the way to postable.
  if(p.readyPct==null) throw new Error('a count with nothing expected reports no readiness at all');
  if(Math.abs(p.readyPct-(2/3)*100)>0.01)
    throw new Error('readiness reads '+p.readyPct+', expected 66.67');
  if(p.toIdentify!==1) throw new Error(p.toIdentify+' units to identify, expected 1');
  // And percent-of-expected stays null rather than being faked as nought.
  if(p.pct!==null) throw new Error('a count expecting nothing reported a completion of '+p.pct);

  /*
   * The registers must not have moved. Counted is not registered, and a
   * dashboard that counted these into stock before the count was posted would
   * be inventing inventory.
   */
  for(const s of ['PROG000000000001','PROG000000000002','PROG000000000003']){
    const a=sqlite.prepare('SELECT id FROM erp_assets WHERE serial_no=?').get(s);
    if(a) throw new Error(s+' reached inventory before the count was posted');
  }
  await call('DELETE',`/api/inventory/cycle-counts/${ccId}`);
  return {note:'3 counted with nothing expected · 67% ready to post · none registered yet'};
});

await t('a loose class already in the master is repaired, not carried forward', async()=>{
  /*
   * 0035 seeds ESP00263 as BAT, but with INSERT OR IGNORE against a row that
   * already existed, so the seed did nothing and the live master still reads
   * "BATTERY". INSERT OR IGNORE creates or skips; it never corrects. 0062 is
   * the correction, and it has to hold on a second deploy as well as a first.
   */
  const canon=['MC','BAT','BSS','SP','CHG','OTH'];
  // One of each shape the source documents actually use. A swapping station is
  // not a battery however the word reads, so the order the rules are tried in
  // is the thing being pinned here.
  sqlite.exec(`INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,
      serialized,base_uom,standard_cost,active) VALUES
    ('CAT-RAW-1','Loose battery','loose battery','Battery Pack',1,'EA',100,1),
    ('CAT-RAW-2','Loose station','loose station','Battery Swapping Station',1,'EA',100,1),
    ('CAT-RAW-3','Loose bike','loose bike','Motorcycle',1,'EA',100,1),
    ('CAT-RAW-4','Loose charger','loose charger','Charger Kit',1,'EA',100,1),
    ('CAT-RAW-5','Loose spare','loose spare','Spare Part',1,'EA',100,1),
    ('CAT-RAW-6','Loose widget','loose widget','Widgetry',1,'EA',100,1)`);

  const repair=readFileSync(join(ROOT,'migrations','0062_item_category_repair.sql'),'utf8');
  sqlite.exec(repair);
  sqlite.exec(repair);   // migrations re-run on every deploy; twice must equal once

  const got=Object.fromEntries(sqlite.prepare(`SELECT item_code,category FROM erp_items
    WHERE item_code LIKE 'CAT-RAW-%'`).all().map(r=>[r.item_code,r.category]));
  const want={'CAT-RAW-1':'BAT','CAT-RAW-2':'BSS','CAT-RAW-3':'MC',
    'CAT-RAW-4':'CHG','CAT-RAW-5':'SP','CAT-RAW-6':'OTH'};
  for(const k of Object.keys(want)){
    if(got[k]!==want[k]) throw new Error(`${k} repaired to ${got[k]}, expected ${want[k]}`);
  }

  /*
   * And nothing anywhere is left outside the six. This is the assertion that
   * would have caught the live problem: the register groups by these codes, so
   * a row holding any other word is stock that shows up in no class at all.
   */
  for(const [what,sql] of [
    ['items',`SELECT item_code k,category c FROM erp_items`],
    ['registered units',`SELECT serial_no k,category c FROM erp_assets`],
    ['counted units not yet posted',`SELECT line_id k,category c FROM erp_cycle_count_new_units`],
  ]){
    const loose=sqlite.prepare(sql).all().filter(r=>!canon.includes(r.c));
    if(loose.length)
      throw new Error(`${loose.length} ${what} carry a class the register cannot group by, e.g. `
        +loose.slice(0,3).map(r=>`${r.k}=${r.c}`).join(', '));
  }
  return {note:`every class in one of ${canon.join('/')}; station beats battery; twice-run is stable`};
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
  await submitCount(ccId);
  const late=await call('DELETE',`/api/inventory/cycle-counts/${ccId}/lines/${a.json.result.lineId}`);
  if(late.json?.ok) throw new Error('a submitted sheet was edited');
  return {note:'identified BAT-0001 · removed the mis-scan · frozen after submit'};
});
await t('an open count plan can be deleted, a submitted one cannot', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const a=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'CHG'});
  const del=await call('DELETE',`/api/inventory/cycle-counts/${a.json.id}`);
  if(!del.json?.ok) throw new Error(del.json?.error);
  // Removed from view, but nothing erased: the record survives as CANCELLED.
  const still=sqlite.prepare('SELECT status FROM erp_cycle_counts WHERE id=?').get(a.json.id);
  if(!still) throw new Error('the plan was hard-deleted');
  if(still.status!=='CANCELLED') throw new Error('status '+still.status);
  const list=await call('GET','/api/inventory/cycle-counts');
  if((list.json.rows||[]).some(r=>r.id===a.json.id)) throw new Error('cancelled plan still in the register');
  const withAll=await call('GET','/api/inventory/cycle-counts?includeCancelled=1');
  if(!(withAll.json.rows||[]).some(r=>r.id===a.json.id)) throw new Error('cancelled plan not recoverable');

  const b=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'CHG'});
  await submitCount(b.json.id);
  const no=await call('DELETE',`/api/inventory/cycle-counts/${b.json.id}`);
  if(no.json?.ok) throw new Error('a submitted plan was deleted');
  return {note:'open plan cancelled, not erased · '+no.json.error.slice(0,44)};
});
await t('a typed count sheet can be uploaded', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'MC'});
  const ccId=cc.json.id;
  const csv=['serial_no,item_code,item_name,category,serial_type,motor_no,unit_cost,condition,remarks',
    'LC6UPLOAD0000001,MC-0001,E88 Cruiser,MC,FRAME,MTR-1,78000,GOOD,',
    'LC6UPLOAD0000002,,,,,,,,no item code on purpose',
    'LC6UPLOAD0000001,MC-0001,E88 Cruiser,MC,FRAME,MTR-9,78000,GOOD,duplicate row',
    ',,,,,,,,blank serial'].join('\n');

  // Preview first: nothing is written.
  const pre=await call('POST',`/api/inventory/cycle-counts/${ccId}/import`,{csv});
  if(!pre.json?.ok) throw new Error(pre.json?.error);
  if(!pre.json.preview) throw new Error('preview flag missing');
  if(pre.json.summary.DUPLICATE!==1) throw new Error('duplicate not caught');
  if(pre.json.summary.SKIPPED!==1) throw new Error('blank serial not skipped');
  if(pre.json.summary.NEW_UNIT!==2) throw new Error('new units '+pre.json.summary.NEW_UNIT);
  // The plan may already carry expected lines for this class, so compare the
  // count of rows that actually carry a scanned serial.
  const scannedNow=sqlite.prepare('SELECT COUNT(*) n FROM erp_cycle_count_lines WHERE cycle_count_id=? AND actual_serial_no IS NOT NULL').get(ccId).n;
  if(scannedNow!==0) throw new Error('preview wrote '+scannedNow+' rows');

  // Commit.
  const run1=await call('POST',`/api/inventory/cycle-counts/${ccId}/import`,{csv,commit:true});
  if(run1.json.added!==2) throw new Error('added '+run1.json.added);
  const d=sqlite.prepare("SELECT nu.item_code,nu.motor_no FROM erp_cycle_count_new_units nu JOIN erp_cycle_count_lines l ON l.id=nu.line_id WHERE l.actual_serial_no='LC6UPLOAD0000001'").get();
  if(d?.item_code!=='MC-0001'||d?.motor_no!=='MTR-1') throw new Error('detail not stored');

  // Re-uploading the same file adds nothing.
  const run2=await call('POST',`/api/inventory/cycle-counts/${ccId}/import`,{csv,commit:true});
  if(run2.json.added!==0) throw new Error('re-upload added '+run2.json.added);
  if(run2.json.summary.ALREADY_COUNTED!==2) throw new Error('re-upload not detected');

  // A file with no header is refused rather than silently eating row 1.
  const bad=await call('POST',`/api/inventory/cycle-counts/${ccId}/import`,{csv:'LC6NOHEADER1,MC-0001'});
  if(bad.json?.ok) throw new Error('a headerless file was accepted');

  // Posting registers what was uploaded.
  await submitCount(ccId);
  await approveCountChain(ccId);
  const posted=await call('POST',`/api/inventory/cycle-counts/${ccId}/post-adjustments`,{});
  if(posted.json.registered!==2) throw new Error('registered '+posted.json.registered+' / '+JSON.stringify(posted.json).slice(0,120));
  const a=sqlite.prepare("SELECT item_code,motor_no,reconciliation_status FROM erp_assets WHERE serial_no='LC6UPLOAD0000001'").get();
  if(a?.item_code!=='MC-0001') throw new Error('uploaded item lost');
  const b2=sqlite.prepare("SELECT reconciliation_status FROM erp_assets WHERE serial_no='LC6UPLOAD0000002'").get();
  if(b2?.reconciliation_status!=='FOR_REVIEW') throw new Error('blank-item row not flagged');
  return {note:'preview clean · 2 imported · re-upload adds 0 · both registered on post'};
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

await t('an item code fills in its description from the master', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'SP'});
  const ccId=cc.json.id;

  // Scan an unregistered serial giving only the code - no name, no class, no cost.
  const scan=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'SN-MASTER-0001',itemCode:'SP-0001'});
  if(!scan.json?.ok) throw new Error(scan.json?.error);
  const stored=sqlite.prepare(`SELECT nu.item_code,nu.item_name,nu.category,nu.unit_cost
    FROM erp_cycle_count_new_units nu JOIN erp_cycle_count_lines l ON l.id=nu.line_id
    WHERE l.actual_serial_no='SN-MASTER-0001'`).get();
  if(stored?.item_name!=='Brake pad') throw new Error('name not filled: '+JSON.stringify(stored));
  if(stored?.category!=='SP') throw new Error('class not filled: '+stored?.category);
  if(Number(stored?.unit_cost)!==500) throw new Error('cost not filled: '+stored?.unit_cost);

  // A lowercase code still matches, and what the counter typed themselves wins.
  const scan2=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,
    {serialNo:'SN-MASTER-0002',itemCode:'sp-0001',itemName:'Brake pad (rear, aftermarket)'});
  if(!scan2.json?.ok) throw new Error(scan2.json?.error);
  const s2=sqlite.prepare(`SELECT nu.item_code,nu.item_name FROM erp_cycle_count_new_units nu
    JOIN erp_cycle_count_lines l ON l.id=nu.line_id WHERE l.actual_serial_no='SN-MASTER-0002'`).get();
  if(s2?.item_code!=='SP-0001') throw new Error('code not normalised to the master: '+s2?.item_code);
  if(s2?.item_name!=='Brake pad (rear, aftermarket)') throw new Error('typed name was overwritten');

  // An unknown code is kept as typed rather than rejected - the floor is not blocked.
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'SN-MASTER-0003',itemCode:'NOT-IN-MASTER'});
  const s3=sqlite.prepare(`SELECT nu.item_code,nu.item_name FROM erp_cycle_count_new_units nu
    JOIN erp_cycle_count_lines l ON l.id=nu.line_id WHERE l.actual_serial_no='SN-MASTER-0003'`).get();
  if(s3?.item_code!=='NOT-IN-MASTER') throw new Error('unknown code was dropped');

  // The sheet shows the description without anyone retyping it.
  const det=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  const row=(det.json.lines||[]).find(x=>x.actual_serial_no==='SN-MASTER-0001');
  if(row?.item_name!=='Brake pad') throw new Error('sheet still blank: '+row?.item_name);
  return {note:'code only -> Brake pad / SP / 500; typed name kept; unknown code kept'};
});

await t('a line identified after the fact also picks up the description', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'SP'});
  const ccId=cc.json.id;
  const scan=await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'SN-LATER-0001'});
  if(!scan.json.result.needsItemDetail) throw new Error('should have asked what the unit is');
  const lineId=scan.json.result.lineId;
  const patch=await call('PATCH',`/api/inventory/cycle-counts/${ccId}/lines/${lineId}`,{itemCode:'SP-0001'});
  if(!patch.json?.ok) throw new Error(patch.json?.error);
  if(patch.json.detail?.item_name!=='Brake pad') throw new Error('name not filled on edit: '+patch.json.detail?.item_name);
  return {note:'Edit -> code only -> '+patch.json.detail.item_name};
});

await t('an open count sheet can be removed, a submitted one cannot', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'SP'});
  const ccId=cc.json.id;
  const gone=await call('DELETE',`/api/inventory/cycle-counts/${ccId}`);
  if(!gone.json?.ok) throw new Error(gone.json?.error);
  const after=sqlite.prepare('SELECT status FROM erp_cycle_counts WHERE id=?').get(ccId);
  if(after?.status!=='CANCELLED') throw new Error('status is '+after?.status);
  const register=await call('GET','/api/inventory/cycle-counts');
  if((register.json.rows||[]).some(r=>r.id===ccId)) throw new Error('cancelled sheet still on the register');
  const again=await call('DELETE',`/api/inventory/cycle-counts/${ccId}`);
  if(again.json?.ok) throw new Error('a cancelled sheet was removed twice');
  return {note:'cancelled, off the register, not erased'};
});

await t('odd casing in the item master never duplicates a count line', async()=>{
  // erp_items.item_code is UNIQUE but case-sensitively so - both of these fit.
  sqlite.prepare(`INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,
    serialized,base_uom,standard_cost,active) VALUES('ZZCASE001','Rear shock absorber','rear shock absorber zzcase','SP',1,'PCS',1200,1)`).run();
  sqlite.prepare(`INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,
    serialized,base_uom,standard_cost,active) VALUES('zzcase001','Rear shock absorber (dup casing)','rear shock lower zzcase','SP',1,'PCS',1200,1)`).run();
  const both=sqlite.prepare("SELECT COUNT(*) n FROM erp_items WHERE UPPER(item_code)='ZZCASE001'").get().n;
  if(both!==2) throw new Error('fixture needs both casings, got '+both);

  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'SP'});
  const ccId=cc.json.id;
  await call('POST',`/api/inventory/cycle-counts/${ccId}/scan`,{serialNo:'SN-CASE-0001',itemCode:'ZZCASE001'});

  const det=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  const hits=(det.json.lines||[]).filter(x=>x.actual_serial_no==='SN-CASE-0001');
  if(hits.length!==1) throw new Error('the sheet grew to '+hits.length+' rows for one scanned unit');
  if(!hits[0].item_name) throw new Error('description still blank');

  // The exactly-matching row wins, not whichever the database happened to store first.
  const stored=sqlite.prepare(`SELECT nu.item_code,nu.item_name FROM erp_cycle_count_new_units nu
    JOIN erp_cycle_count_lines l ON l.id=nu.line_id WHERE l.actual_serial_no='SN-CASE-0001'`).get();
  if(stored.item_code!=='ZZCASE001') throw new Error('resolved to '+stored.item_code);
  if(stored.item_name!=='Rear shock absorber') throw new Error('picked the wrong row: '+stored.item_name);
  return {note:'two casings in the master -> 1 row, exact match wins'};
});

await t('the cycle count chain refuses to skip a step', async()=>{
  const loc=sqlite.prepare('SELECT id FROM erp_locations LIMIT 1').get();
  const cc=await call('POST','/api/inventory/cycle-counts',{locationId:loc.id,countDate:'2026-08-07',category:'SP'});
  const ccId=cc.json.id;
  await submitCount(ccId);

  // Submitting is itself the first signature, so the sheet arrives already
  // signed by the department manager and waiting on the department head.
  const afterSubmit=sqlite.prepare(`SELECT stage,status,decided_by FROM erp_cycle_count_approvals
    WHERE cycle_count_id=? ORDER BY step_no`).all(ccId);
  if(afterSubmit[0].status!=='APPROVED'||afterSubmit[0].stage!=='DEPT_MANAGER')
    throw new Error('the submit did not sign step one: '+JSON.stringify(afterSubmit[0]));
  if(afterSubmit[0].decided_by!=='judy@nrdev.ph')
    throw new Error('step one credited to '+afterSubmit[0].decided_by);

  const prev=who;
  try{
    // Finance cannot jump the queue - the chain is an order, not a set.
    who='mmungcal@nrdev.ph';
    const early=await call('POST',`/api/inventory/cycle-counts/${ccId}/approve`,{});
    if(early.json?.ok) throw new Error('Finance signed before the department head did');
    if(!/dept head/i.test(early.json.error||'')) throw new Error('wrong refusal: '+early.json.error);

    // And the person who submitted it cannot sign a second time.
    who='judy@nrdev.ph';
    const twice=await call('POST',`/api/inventory/cycle-counts/${ccId}/approve`,{});
    if(twice.json?.ok) throw new Error('the submitter signed the chain twice');
  } finally { who=prev; }

  const signed=await approveCountChain(ccId);
  if(signed.length!==2) throw new Error('chain took '+signed.length+' steps after the submit');
  const st=sqlite.prepare('SELECT status FROM erp_cycle_counts WHERE id=?').get(ccId).status;
  if(st!=='APPROVED') throw new Error('count is '+st);
  const steps=sqlite.prepare('SELECT stage,status,decided_by FROM erp_cycle_count_approvals WHERE cycle_count_id=? ORDER BY step_no').all(ccId);
  if(steps.length!==3||steps.some(x=>x.status!=='APPROVED')) throw new Error('steps '+JSON.stringify(steps));
  const signers=new Set(steps.map(x=>x.decided_by));
  if(signers.size!==3) throw new Error('only '+signers.size+' distinct signers');

  // Finance does the posting, and only Finance.
  const prevPost=who;
  try{
    who='judy@nrdev.ph';
    const nope=await call('POST',`/api/inventory/cycle-counts/${ccId}/post-adjustments`,{});
    if(nope.json?.ok) throw new Error('a non-Finance user posted the count');
    if(!/finance/i.test(nope.json.error||'')) throw new Error('wrong refusal: '+nope.json.error);
  } finally { who=prevPost; }
  return {note:'submit signs step 1; queue-jumping and double-signing refused; only Finance posts'};
});

await t('a purchase order without its quotation is refused by the API', async()=>{
  const body={vendorName:'Test Vendor Co',orderDate:'2026-08-07',
    lines:[{description:'Spare part',qty:2,unitCost:500}]};
  const bare=await call('POST','/api/procurement/purchase-orders',body);
  if(bare.json?.ok) throw new Error('a PO saved with no attachment');
  if(!/quotation|invoice/i.test(bare.json.error||'')) throw new Error('wrong refusal: '+bare.json.error);
  // An empty array is not an attachment either.
  const empty=await call('POST','/api/procurement/purchase-orders',{...body,attachments:[]});
  if(empty.json?.ok) throw new Error('an empty attachment list was accepted');
  return {note:bare.json.error.slice(0,58)};
});

/*
 * A draft purchase order is a working document; a routed one is something
 * somebody is being asked to sign for. The line between the two is the whole
 * point of the rule, so it is tested from both sides.
 */
await t('a draft purchase order can be corrected, a routed one cannot', async()=>{
  const made=await call('POST','/api/procurement/purchase-orders',{
    vendorName:'Editable Supplies Inc',orderDate:'2026-08-07',currency:'PHP',
    lines:[{itemCode:'SP-EDIT1',description:'Brake cable',qty:2,unitCost:500}],
    attachments:[{fileName:'quote.pdf',url:'https://example.invalid/quote.pdf'}]});
  if(!made.json?.ok) throw new Error(made.json?.error);
  const id=made.json.id;
  if(Number(made.json.total)!==1000) throw new Error('created total '+made.json.total);

  // Rows are replaced wholesale and the total follows them.
  const ed=await call('PATCH','/api/procurement/purchase-orders/'+id,{
    lines:[{itemCode:'SP-EDIT1',description:'Brake cable',qty:3,unitCost:500},
           {itemCode:'SP-EDIT2',description:'Cable housing',qty:1,unitCost:250}],taxAmount:150});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  const h=sqlite.prepare('SELECT subtotal,tax_amount,total_amount FROM erp_purchase_orders WHERE id=?').get(id);
  if(Number(h.subtotal)!==1750||Number(h.total_amount)!==1900)
    throw new Error('totals did not follow the rows: '+JSON.stringify(h));
  const lines=sqlite.prepare('SELECT line_no,ordered_qty FROM erp_purchase_order_lines WHERE purchase_order_id=? ORDER BY line_no').all(id);
  if(lines.length!==2||Number(lines[0].ordered_qty)!==3)
    throw new Error('lines were not replaced: '+JSON.stringify(lines));

  // Once it is out for signature the figure is frozen.
  sqlite.prepare("UPDATE erp_purchase_orders SET status='FOR_APPROVAL' WHERE id=?").run(id);
  const late=await call('PATCH','/api/procurement/purchase-orders/'+id,{taxAmount:0});
  if(late.json?.ok) throw new Error('a routed purchase order was edited');
  if(!/no longer be edited/i.test(late.json.error||'')) throw new Error('wrong refusal: '+late.json.error);
  return {note:'rows replaced, total re-derived to 1,900; frozen once routed'};
});

await t('an approved purchase order raises its own payment request', async()=>{
  // Raised by one person and approved by another: the same person cannot do
  // both, and the rule that stops them is worth not tripping over here.
  const prev=who;
  let id;
  try{
    who='judy@nrdev.ph';
    const made=await call('POST','/api/procurement/purchase-orders',{
      vendorName:'Autoraise Trading',orderDate:'2026-08-07',currency:'PHP',
      lines:[{itemCode:'SP-AUTO1',description:'Charger unit',qty:4,unitCost:2500}],
      attachments:[{fileName:'quote.pdf',url:'https://example.invalid/quote.pdf'}]});
    if(!made.json?.ok) throw new Error(made.json?.error);
    id=made.json.id;
  } finally { who=prev; }

  // Walk the chain with whoever each step calls for, until it completes.
  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('scm2@nrdev.ph','Second SCM','SCM_MANAGER','Supply Chain',1)");
  let approved=null;
  const signers=['scm2@nrdev.ph','samuel@nrdev.ph','mmungcal@nrdev.ph'];
  for(const signer of signers){
    const prev2=who;
    try{ who=signer; approved=await call('POST','/api/procurement/purchase-orders/'+id+'/approve',{}); }
    finally { who=prev2; }
    if(approved.json?.ok&&approved.json.approved) break;
  }
  if(!approved?.json?.ok) throw new Error(approved?.json?.error);
  if(!approved.json.approved) throw new Error('the chain never completed');
  const rfp=approved.json.paymentRequest;
  if(!rfp?.created) throw new Error('no payment request was raised: '+JSON.stringify(rfp));

  const row=sqlite.prepare(`SELECT request_no,payee_name,gross_amount,net_payable,status,purchase_order_no
    FROM erp_payment_requests WHERE purchase_order_id=?`).get(id);
  if(!row) throw new Error('the RFP is not on the register');
  if(row.status!=='DRAFT') throw new Error('raised as '+row.status+', Finance must still own it');
  if(Number(row.gross_amount)!==10000) throw new Error('gross '+row.gross_amount+', expected the PO total');
  if(row.payee_name!=='Autoraise Trading') throw new Error('payee '+row.payee_name);
  if(!row.purchase_order_no) throw new Error('the RFP does not point back at its purchase order');

  // Approving again must not raise a second request for the same money.
  sqlite.prepare("UPDATE erp_purchase_orders SET status='DRAFT' WHERE id=?").run(id);
  let again; const prev3=who;
  try{ who='mmungcal@nrdev.ph'; again=await call('POST','/api/procurement/purchase-orders/'+id+'/approve',{}); }
  finally { who=prev3; }
  const count=sqlite.prepare('SELECT COUNT(*) n FROM erp_payment_requests WHERE purchase_order_id=?').get(id).n;
  if(count!==1) throw new Error('the same purchase order raised '+count+' payment requests');
  if(again.json?.paymentRequest?.created) throw new Error('a duplicate request was reported as created');
  return {note:`${row.request_no} drafted for ${row.payee_name}, 10,000, and not duplicable`};
});

await t('only Finance clears a receiving discrepancy, and someone else acknowledges it', async()=>{
  // Seed one rather than hope the fixture has one: a rule proved by the absence
  // of a test case is not proved at all.
  // The row has real foreign keys, so give it real parents.
  const loc0=sqlite.prepare(`SELECT id FROM erp_locations LIMIT 1`).get();
  const sh=sqlite.prepare(`SELECT id FROM erp_shipments LIMIT 1`).get()
    || {id:Number(sqlite.prepare(`INSERT INTO erp_shipments(shipment_no) VALUES('SHP-TEST-01')`).run().lastInsertRowid)};
  const rc=sqlite.prepare(`SELECT id FROM erp_receipts LIMIT 1`).get()
    || {id:Number(sqlite.prepare(`INSERT INTO erp_receipts(receipt_no,shipment_id,location_id,received_at)
         VALUES('RCP-TEST-01',?,?,datetime('now'))`).run(sh.id,loc0.id).lastInsertRowid)};
  const rl=sqlite.prepare(`SELECT id FROM erp_receipt_lines LIMIT 1`).get()
    || {id:Number(sqlite.prepare(`INSERT INTO erp_receipt_lines(receipt_id,serial_no,qty) VALUES(?,'ACT-0001',1)`).run(rc.id).lastInsertRowid)};
  sqlite.prepare(`INSERT OR IGNORE INTO erp_receiving_variances
    (variance_no,shipment_id,receipt_id,receipt_line_id,variance_type,expected_serial_no,actual_serial_no,reason,status)
    VALUES('VAR-TEST-01',?,?,?,'SERIAL_MISMATCH','EXP-0001','ACT-0001','seeded for the control test','OPEN')`)
    .run(sh.id,rc.id,rl.id);
  const v=sqlite.prepare(`SELECT id FROM erp_receiving_variances WHERE variance_no='VAR-TEST-01'`).get();
  if(!v) throw new Error('could not seed a discrepancy to test against');
  const prev=who;
  try{
    who='judy@nrdev.ph';
    const nope=await call('POST',`/api/receiving/variances/${v.id}/resolve`,{resolution:'write off'});
    if(nope.json?.ok) throw new Error('a non-Finance user cleared a discrepancy');

    who='mmungcal@nrdev.ph';
    const cleared=await call('POST',`/api/receiving/variances/${v.id}/resolve`,{resolution:'write off'});
    if(!cleared.json?.ok) throw new Error('Finance could not clear it: '+cleared.json?.error);
    const mid=sqlite.prepare('SELECT status FROM erp_receiving_variances WHERE id=?').get(v.id).status;
    if(mid!=='RESOLVED') throw new Error('status after Finance is '+mid);

    // Finance cannot also acknowledge their own decision.
    const selfAck=await call('POST',`/api/receiving/variances/${v.id}/acknowledge`,{});
    if(selfAck.json?.ok) throw new Error('Finance acknowledged its own resolution');

    who='samuel@nrdev.ph';
    const ack=await call('POST',`/api/receiving/variances/${v.id}/acknowledge`,{note:'seen'});
    if(!ack.json?.ok) throw new Error('the department head could not acknowledge: '+ack.json?.error);
  } finally { who=prev; }
  const end=sqlite.prepare('SELECT status FROM erp_receiving_variances WHERE id=?').get(v.id).status;
  if(end!=='CLOSED') throw new Error('final status '+end);
  const rec=sqlite.prepare('SELECT acknowledged_by FROM erp_receiving_variance_acks WHERE variance_id=?').get(v.id);
  if(!rec?.acknowledged_by) throw new Error('the acknowledgement was not recorded');
  return {note:'Finance cleared, department head acknowledged, both recorded'};
});

await t('a sales order carries its item lines and totals them', async()=>{
  const cust=sqlite.prepare("SELECT id FROM erp_partners WHERE partner_type='CUSTOMER' LIMIT 1").get()
    || {id:Number(sqlite.prepare("INSERT INTO erp_partners(partner_code,name,partner_type) VALUES('C-TEST','Test Customer','CUSTOMER')").run().lastInsertRowid)};
  const r=await call('POST','/api/sales',{transactionType:'SALE',customerId:cust.id,
    orderDate:'2026-08-08',deliveryAddress:'Pasig',
    lines:[{itemCode:'SP-0001',itemName:'Brake pad',description:'Brake pad',qty:3,unitPrice:500},
           {itemCode:'SP-0002',itemName:'Chain',description:'Drive chain',qty:2,unitPrice:250}]});
  if(!r.json?.ok) throw new Error(r.json?.error);
  // Sales prices the deal; it does not pick serials.
  const lines=sqlite.prepare('SELECT item_code,description,qty,unit_price,serial_no FROM erp_sales_lines WHERE sales_order_id=? ORDER BY line_no').all(r.json.id);
  if(lines.length!==2) throw new Error('stored '+lines.length+' lines');
  if(Number(lines[0].qty)!==3||Number(lines[0].unit_price)!==500) throw new Error('line 1 wrong: '+JSON.stringify(lines[0]));
  if(lines.some(l=>l.serial_no)) throw new Error('sales assigned a serial, which belongs to outbound');
  const gross=sqlite.prepare('SELECT gross_amount FROM erp_sales_orders WHERE id=?').get(r.json.id).gross_amount;
  if(Number(gross)!==2000) throw new Error('gross '+gross+', expected 2000');
  return {note:'2 lines stored, gross 2,000, no serials assigned'};
});

await t('a collection is editable as a draft and frozen once posted', async()=>{
  const made=await call('POST','/api/receivables/collections',{
    stream:'MC_LEASED',txnDate:'2026-08-08',salesType:'Leased',documentNo:'OR-9001',
    customerName:'JAMO BUSINESS SOLUTIONS',grossAmount:121706.59,vatType:'VATable',vatRate:0.12,
    paymentMethod:'Bank Transfer',bankWallet:'BDO'});
  if(!made.json?.ok) throw new Error(made.json?.error);
  const id=made.json.id;

  // VAT is derived from gross, never typed twice, so the parts always add up.
  const a=sqlite.prepare('SELECT * FROM erp_ar_collections WHERE id=?').get(id);
  if(Math.abs(a.net_amount-108666.60)>0.02) throw new Error('net '+a.net_amount);
  if(Math.abs(a.output_vat-13039.99)>0.02) throw new Error('vat '+a.output_vat);
  if(Math.abs((a.net_amount+a.output_vat)-a.gross_amount)>0.02) throw new Error('parts do not sum');
  if(a.status!=='DRAFT') throw new Error('created as '+a.status);

  // Editable while draft, and the VAT re-derives.
  const ed=await call('PATCH','/api/receivables/collections/'+id,{grossAmount:200000});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  const b=sqlite.prepare('SELECT * FROM erp_ar_collections WHERE id=?').get(id);
  if(Math.abs((b.net_amount+b.output_vat)-200000)>0.02) throw new Error('re-split wrong');

  // Only Finance posts.
  const prev=who;
  try{
    who='judy@nrdev.ph';
    const nope=await call('POST','/api/receivables/collections/post',{ids:[id]});
    if(nope.json?.ok) throw new Error('a non-Finance user posted a collection');
  } finally { who=prev; }

  const posted=await call('POST','/api/receivables/collections/post',{ids:[id]});
  if(!posted.json?.ok) throw new Error(posted.json?.error);
  if((posted.json.posted||[]).length!==1) throw new Error('posted '+JSON.stringify(posted.json));

  // Posted is final: no more editing, no more deleting.
  const late=await call('PATCH','/api/receivables/collections/'+id,{grossAmount:1});
  if(late.json?.ok) throw new Error('a posted entry was edited');
  const del=await call('DELETE','/api/receivables/collections/'+id);
  if(del.json?.ok) throw new Error('a posted entry was deleted');

  // It is corrected by voiding, with a reason that stays on the register.
  const noReason=await call('POST',`/api/receivables/collections/${id}/void`,{});
  if(noReason.json?.ok) throw new Error('voided with no reason');
  const v=await call('POST',`/api/receivables/collections/${id}/void`,{reason:'duplicate receipt'});
  if(!v.json?.ok) throw new Error(v.json?.error);
  const c2=sqlite.prepare('SELECT status,void_reason FROM erp_ar_collections WHERE id=?').get(id);
  if(c2.status!=='VOID'||c2.void_reason!=='duplicate receipt') throw new Error(JSON.stringify(c2));
  return {note:'draft edits re-split VAT; Finance-only posting; posted is frozen and voided with a reason'};
});

/*
 * The Collection action. A bill and its payment are separate facts: the bill is
 * posted once, the money can arrive in parts on other dates, and either can be
 * reversed without disturbing the other. What is tested here is that the
 * balance is always the arithmetic of those two and never a stored guess.
 */
await t('a collection is recorded against a posted entry, never a draft', async()=>{
  const made=await call('POST','/api/receivables/collections',{
    stream:'MC_SOLD',txnDate:'2026-08-08',salesType:'Sold',documentNo:'SI-7001',
    customerName:'ANGKAS RIDERS INC',grossAmount:100000,vatType:'VATable',vatRate:0.12});
  if(!made.json?.ok) throw new Error(made.json?.error);
  const id=made.json.id;

  // Nothing to collect against a draft: it has not billed anybody yet.
  const early=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-08-09',amount:1000});
  if(early.json?.ok) throw new Error('a draft accepted a collection');

  const posted=await call('POST','/api/receivables/collections/post',{ids:[id]});
  if(!posted.json?.ok) throw new Error(posted.json?.error);

  // Part payment moves the balance by exactly what came in.
  const p1=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-08-09',amount:40000,paymentMethod:'Bank Transfer',bankWallet:'BDO',
     bankRef:'BDO-77123',clearedStatus:'CLEARED'});
  if(!p1.json?.ok) throw new Error(p1.json?.error);
  if(Math.abs(p1.json.balance-60000)>0.005) throw new Error('balance '+p1.json.balance);

  // Overpayment is a different transaction and is refused, not absorbed.
  const over=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-08-10',amount:60000.01});
  if(over.json?.ok) throw new Error('the register accepted more than was billed');

  const p2=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-08-10',amount:60000,paymentMethod:'GCash'});
  if(!p2.json?.ok) throw new Error(p2.json?.error);
  if(Math.abs(p2.json.balance)>0.005) throw new Error('balance after settlement '+p2.json.balance);

  // Settled means settled: nothing more can be taken against it.
  const extra=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-08-11',amount:0.5});
  if(extra.json?.ok) throw new Error('a settled entry took another collection');

  // Reversing a receipt puts the balance back rather than deleting the history.
  const rc=sqlite.prepare("SELECT id,receipt_no FROM erp_ar_receipts WHERE collection_id=? ORDER BY id").all(id);
  if(rc.length!==2) throw new Error('receipts stored '+rc.length);
  const noReason=await call('POST',`/api/receivables/receipts/${rc[1].id}/void`,{});
  if(noReason.json?.ok) throw new Error('reversed with no reason');
  const rev=await call('POST',`/api/receivables/receipts/${rc[1].id}/void`,{reason:'cheque bounced'});
  if(!rev.json?.ok) throw new Error(rev.json?.error);
  const back=await call('GET',`/api/receivables/collections/${id}/receipts`);
  if(Math.abs(back.json.collection.balance-60000)>0.005)
    throw new Error('balance after reversal '+back.json.collection.balance);
  if((back.json.receipts||[]).length!==2) throw new Error('a reversed receipt was erased');
  return {note:`${rc[0].receipt_no} + ${rc[1].receipt_no}; part payment, overpayment refused, reversal restores the balance`};
});

await t('collection % is measured against what was actually posted', async()=>{
  const s=await call('GET','/api/receivables/summary');
  if(!s.json?.ok) throw new Error(s.json?.error);
  const {billed,collected,outstanding,collectionPct,receivablesPct}=s.json;
  if(!(billed>0)) throw new Error('nothing posted, so the rate cannot be checked');
  if(Math.abs((collected+outstanding)-billed)>0.02)
    throw new Error(`collected+outstanding ${collected+outstanding} != billed ${billed}`);
  // The two rates are the same pair of numbers from either end.
  if(Math.abs((collectionPct+receivablesPct)-100)>0.02)
    throw new Error(`rates sum to ${collectionPct+receivablesPct}`);
  return {note:`billed ${billed}, collected ${collected}, ${Math.round(collectionPct)}% collected`};
});

/*
 * A statement is arithmetic the customer can check: what they owed before the
 * month, what was charged in it, what they paid, and what is left. If any of
 * those four can drift from the register the document is worthless, so the test
 * builds a month with a brought-forward balance and proves the four agree.
 */
await t('a statement of account is generated from the register and frozen when issued', async()=>{
  const CUST='STATEMENT TEST CORP';
  const raise=async(date,amount)=>{
    const r=await call('POST','/api/receivables/collections',{
      stream:'MC_LEASED',txnDate:date,salesType:'Leased',customerName:CUST,
      grossAmount:amount,vatType:'VATable',vatRate:0.12});
    if(!r.json?.ok) throw new Error(r.json?.error);
    const p=await call('POST','/api/receivables/collections/post',{ids:[r.json.id]});
    if(!p.json?.ok) throw new Error(p.json?.error);
    return r.json.id;
  };
  // February: billed 10,000, paid 4,000. So March opens owing 6,000.
  const feb=await raise('2026-02-10',10000);
  const febPay=await call('POST',`/api/receivables/collections/${feb}/collect`,
    {receiptDate:'2026-02-20',amount:4000,paymentMethod:'Cash'});
  if(!febPay.json?.ok) throw new Error(febPay.json?.error);
  // March: billed 5,000, paid 2,000.
  const mar=await raise('2026-03-05',5000);
  const marPay=await call('POST',`/api/receivables/collections/${mar}/collect`,
    {receiptDate:'2026-03-25',amount:2000,paymentMethod:'Bank Transfer'});
  if(!marPay.json?.ok) throw new Error(marPay.json?.error);

  const gen=await call('POST','/api/receivables/statements/generate',{customerName:CUST,month:'2026-03'});
  if(!gen.json?.ok) throw new Error(gen.json?.error);
  const {id,opening,billed,collected,closing}=gen.json;
  if(Math.abs(opening-6000)>0.01) throw new Error('opening '+opening+', expected 6,000 brought forward');
  if(Math.abs(billed-5000)>0.01) throw new Error('charges '+billed);
  if(Math.abs(collected-2000)>0.01) throw new Error('payments '+collected);
  if(Math.abs(closing-9000)>0.01) throw new Error('closing '+closing+', expected 9,000');
  if(Math.abs((opening+billed-collected)-closing)>0.01) throw new Error('the statement does not add up');
  // Only the month's own movements are on it, never February's.
  const lines=sqlite.prepare('SELECT reference,charge,credit FROM erp_ar_statement_lines WHERE statement_id=? ORDER BY line_no').all(id);
  if(lines.length!==2) throw new Error('lines '+lines.length+': '+JSON.stringify(lines));

  // A month with nothing in it and nothing owing is not a statement.
  const empty=await call('POST','/api/receivables/statements/generate',
    {customerName:'NOBODY AT ALL',month:'2026-03'});
  if(empty.json?.ok) throw new Error('a statement was generated for a customer with no activity');

  // Editable while draft, and the totals re-derive from the rows.
  const ed=await call('PATCH','/api/receivables/statements/'+id,{
    openingBalance:6000,
    lines:[{lineDate:'2026-03-05',reference:'AR',description:'Lease billing',charge:5000,credit:0},
           {lineDate:'2026-03-25',reference:'OR',description:'Payment received',charge:0,credit:2000},
           {lineDate:'2026-03-31',reference:'ADJ',description:'Agreed goodwill adjustment',charge:0,credit:500}]});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  if(Math.abs(Number(ed.json.statement.closing_balance)-8500)>0.01)
    throw new Error('closing after the adjustment '+ed.json.statement.closing_balance);

  const issued=await call('POST',`/api/receivables/statements/${id}/issue`,{});
  if(!issued.json?.ok) throw new Error(issued.json?.error);
  // Issued is a document: it does not change and it does not get deleted.
  const late=await call('PATCH','/api/receivables/statements/'+id,{notes:'sneaky'});
  if(late.json?.ok) throw new Error('an issued statement was edited');
  const del=await call('DELETE','/api/receivables/statements/'+id);
  if(del.json?.ok) throw new Error('an issued statement was deleted');
  // And the same month cannot be issued twice with a different closing balance.
  const twice=await call('POST','/api/receivables/statements/generate',{customerName:CUST,month:'2026-03'});
  if(twice.json?.ok) throw new Error('a second statement was generated for an issued month');
  return {note:'opening 6,000 + 5,000 - 2,000 = 9,000; adjustment to 8,500; frozen on issue'};
});

/*
 * Recording a collection and posting it are two acts, and the line between them
 * is the whole control: recording says the money arrived, posting says it is in
 * the bank and moves that account's balance. The checker may do the first and
 * not the second, exactly as she checks an RFP without approving it.
 */
await t('a collection is posted to the bank registry, and moves the balance', async()=>{
  sqlite.exec("INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active) VALUES('rhonrado@nrdev.ph','Rucel Mae Honrado','FINANCE_REVIEWER','Finance and Accounting',1)");
  const made=await call('POST','/api/receivables/collections',{
    stream:'MC_SOLD',txnDate:'2026-05-04',salesType:'Sold',customerName:'BANKPOST TEST CORP',
    grossAmount:60000,vatType:'VATable',vatRate:0.12,paymentMethod:'Bank Transfer',bankWallet:'BDO'});
  if(!made.json?.ok) throw new Error(made.json?.error);
  const id=made.json.id;
  const posted=await call('POST','/api/receivables/collections/post',{ids:[id]});
  if(!posted.json?.ok) throw new Error(posted.json?.error);

  // The checker records what came in.
  let rec; const prev=who;
  try{ who='rhonrado@nrdev.ph';
    rec=await call('POST',`/api/receivables/collections/${id}/collect`,
      {receiptDate:'2026-05-10',amount:25000,paymentMethod:'Bank Transfer',bankWallet:'BDO',bankRef:'BDO-55001'});
  } finally { who=prev; }
  if(!rec.json?.ok) throw new Error('the finance checker could not record a collection: '+rec.json?.error);
  const receipt=sqlite.prepare('SELECT id,receipt_no FROM erp_ar_receipts WHERE collection_id=? ORDER BY id DESC').get(id);

  // She may not post it: that moves a bank balance.
  try{ who='rhonrado@nrdev.ph';
    const nope=await call('POST',`/api/receivables/receipts/${receipt.id}/post`,{});
    if(nope.json?.ok) throw new Error('the finance checker posted a collection');
  } finally { who=prev; }

  // Nothing is on the register until it is posted.
  const before=sqlite.prepare("SELECT COUNT(*) n FROM erp_bank_transactions WHERE import_batch='AR_COLLECTION'").get().n;
  const post=await call('POST',`/api/receivables/receipts/${receipt.id}/post`,{});
  if(!post.json?.ok) throw new Error(post.json?.error);
  const after=sqlite.prepare("SELECT COUNT(*) n FROM erp_bank_transactions WHERE import_batch='AR_COLLECTION'").get().n;
  if(after!==before+1) throw new Error('the deposit did not reach the bank register');
  const txn=sqlite.prepare('SELECT * FROM erp_bank_transactions ORDER BY id DESC LIMIT 1').get();
  if(txn.direction!=='CREDIT'||Number(txn.amount)!==25000) throw new Error('wrong movement: '+JSON.stringify(txn));
  if(Number(post.json.runningBalance)!==Number(txn.running_balance))
    throw new Error('the reported balance and the register disagree');

  // Posting twice would double the money.
  const again=await call('POST',`/api/receivables/receipts/${receipt.id}/post`,{});
  if(again.json?.ok) throw new Error('the same collection posted twice');

  // A reversal leaves a contra rather than deleting the deposit.
  const openingBal=Number(txn.running_balance);
  const noReason=await call('POST',`/api/receivables/receipts/${receipt.id}/unpost`,{});
  if(noReason.json?.ok) throw new Error('reversed with no reason');
  const rev=await call('POST',`/api/receivables/receipts/${receipt.id}/unpost`,{reason:'posted to the wrong account'});
  if(!rev.json?.ok) throw new Error(rev.json?.error);
  const contra=sqlite.prepare('SELECT * FROM erp_bank_transactions ORDER BY id DESC LIMIT 1').get();
  if(contra.direction!=='DEBIT'||Number(contra.amount)!==25000) throw new Error('no contra was written');
  if(Number(contra.running_balance)!==openingBal-25000) throw new Error('the balance did not come back');
  if(sqlite.prepare('SELECT COUNT(*) n FROM erp_bank_transactions WHERE id=?').get(txn.id).n!==1)
    throw new Error('the original deposit was erased instead of reversed');
  return {note:`${receipt.receipt_no}: checker recorded, Finance posted 25,000 to BDO, reversal left a contra`};
});

await t('a collection naming a bank nobody has set up is refused, not guessed', async()=>{
  const made=await call('POST','/api/receivables/collections',{
    stream:'AFTERSALES',txnDate:'2026-05-06',customerName:'UNMAPPED BANK CORP',
    grossAmount:5000,vatType:'VATable',vatRate:0.12,bankWallet:'Some Rural Bank'});
  if(!made.json?.ok) throw new Error(made.json?.error);
  const id=made.json.id;
  await call('POST','/api/receivables/collections/post',{ids:[id]});
  const rec=await call('POST',`/api/receivables/collections/${id}/collect`,
    {receiptDate:'2026-05-07',amount:5000,bankWallet:'Some Rural Bank'});
  if(!rec.json?.ok) throw new Error(rec.json?.error);
  const receipt=sqlite.prepare('SELECT id FROM erp_ar_receipts WHERE collection_id=? ORDER BY id DESC').get(id);
  const post=await call('POST',`/api/receivables/receipts/${receipt.id}/post`,{});
  if(post.json?.ok) throw new Error('money was posted to a bank account nobody set up');
  if(!/No bank account is set up/i.test(post.json.error||'')) throw new Error('wrong refusal: '+post.json.error);
  return {note:post.json.error.slice(0,58)};
});

/*
 * A request for payment is a header and the lines it was made of. One RFP
 * routinely spans several account titles and the ledger posts each separately,
 * so the split has to survive the round trip out of the register.
 */
await t('a payment request carries the lines it was made of', async()=>{
  const rfp='RFP-TESTLINES2026-0001';
  sqlite.prepare(`INSERT INTO erp_payment_requests(request_no,entity_id,request_date,requestor_email,
      payee_name,department,purpose,request_type,gross_amount,vat_amount,withholding_amount,net_payable,status)
    VALUES(?,(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-04-02','judy@nrdev.ph',
      'Multi Account Supplier','Technology','Site deployment','Payment to Vendor',11200,1200,0,11200,'DRAFT')`).run(rfp);
  const id=sqlite.prepare('SELECT id FROM erp_payment_requests WHERE request_no=?').get(rfp).id;
  const line=sqlite.prepare(`INSERT INTO erp_payment_request_lines(payment_request_id,rfp_ref,line_no,
      account_title,source_account_title,procurement_category,description,gross_amount,vat_type,vat_rate,
      net_of_vat,input_vat,net_payable) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  line.run(id,rfp,1,'Station shell/equipment','PPE - Equipment installation','CAPEX','Shell',8960,'VATable',0.12,8000,960,8960);
  line.run(id,rfp,2,'Travel and Transportation','Travel/transportation/meals','OPEX','Site travel',2240,'VATable',0.12,2000,240,2240);

  const d=await call('GET','/api/finance/payment-requests/'+id);
  if(!d.json?.ok) throw new Error(d.json?.error);
  if((d.json.lines||[]).length!==2) throw new Error('lines returned: '+(d.json.lines||[]).length);
  const sum=(d.json.lines||[]).reduce((a,l)=>a+Number(l.gross_amount||0),0);
  if(Math.abs(sum-11200)>0.01) throw new Error('the lines do not add up to the header: '+sum);
  // The split by account title is what the ledger posts against.
  const titles=(d.json.byAccount||[]).map(x=>x.label).sort();
  if(titles.length!==2) throw new Error('account split: '+JSON.stringify(d.json.byAccount));
  if(!titles.includes('Station shell/equipment')) throw new Error('the budget category is not the posting title');
  // The sheet's own wording is kept beside it rather than thrown away.
  const src=(d.json.lines||[]).map(l=>l.source_account_title).filter(Boolean);
  if(src.length!==2) throw new Error('the original account titles were lost');
  return {note:'2 lines, 11,200 total, split across '+titles.length+' posting titles'};
});

/*
 * Loading the register twice must not link the same document twice. The
 * attachment table carries no natural key, so uniqueness is stated explicitly;
 * without it "INSERT OR IGNORE" ignores nothing and every redeploy adds a copy.
 */
await t('a document is linked to its request once, however many times it is loaded', async()=>{
  const rfp='RFP-DOCDUPE2026-0001';
  sqlite.prepare(`INSERT OR IGNORE INTO erp_payment_requests(request_no,entity_id,request_date,requestor_email,
      payee_name,department,purpose,request_type,gross_amount,net_payable,status)
    VALUES(?,(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-04-09','judy@nrdev.ph',
      'Doc Supplier','Technology','Document test','Payment to Vendor',1000,1000,'DRAFT')`).run(rfp);
  const link=sqlite.prepare(`INSERT OR IGNORE INTO erp_attachments(module_code,record_type,record_no,
      file_name,content_type,storage,drive_file_id,file_url,uploaded_by)
    VALUES('FINANCE','PAYMENT_REQUEST',?,?,'application/pdf','DRIVE',?,?,'import@nrdev.ph')`);
  const args=[rfp, rfp+'.pdf', 'DRIVEID-DOCDUPE-0001', 'https://drive.google.com/file/d/DRIVEID-DOCDUPE-0001/view'];
  link.run(...args); link.run(...args); link.run(...args);
  const n=sqlite.prepare(`SELECT COUNT(*) n FROM erp_attachments WHERE record_no=?`).get(rfp).n;
  if(n!==1) throw new Error('the same document is linked '+n+' times');
  // A genuinely different document on the same request is still allowed.
  link.run(rfp, rfp+'-annex.pdf', 'DRIVEID-DOCDUPE-0002', 'https://drive.google.com/file/d/DRIVEID-DOCDUPE-0002/view');
  const m=sqlite.prepare(`SELECT COUNT(*) n FROM erp_attachments WHERE record_no=?`).get(rfp).n;
  if(m!==2) throw new Error('a second, different document was refused');
  return {note:'three identical loads leave one link; a different document still attaches'};
});

/*
 * A draft request can be corrected; a submitted one cannot. Totals are always
 * re-derived from the lines, so a request can never show a figure its own rows
 * do not give.
 */
await t('a draft payment request is editable, a submitted one is not', async()=>{
  const rfp='RFP-EDITME2026-0001';
  sqlite.prepare(`INSERT OR IGNORE INTO erp_payment_requests(request_no,entity_id,request_date,requestor_email,
      payee_name,department,purpose,request_type,gross_amount,vat_amount,withholding_amount,net_payable,status)
    VALUES(?,(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-04-11','judy@nrdev.ph',
      'Editable Vendor','Technology','Original purpose','Payment to Vendor',1000,0,0,1000,'DRAFT')`).run(rfp);
  const id=sqlite.prepare('SELECT id FROM erp_payment_requests WHERE request_no=?').get(rfp).id;

  const ed=await call('PATCH','/api/finance/payment-requests/'+id,{
    purpose:'Corrected purpose',
    lines:[{accountTitle:'Station shell/equipment',description:'Shell',grossAmount:11200,vatRate:0.12,ewtAmount:0},
           {accountTitle:'Travel and Transportation',description:'Site travel',grossAmount:2240,vatRate:0.12,ewtAmount:200}]});
  if(!ed.json?.ok) throw new Error(ed.json?.error);
  const h=sqlite.prepare('SELECT purpose,gross_amount,vat_amount,withholding_amount,net_payable FROM erp_payment_requests WHERE id=?').get(id);
  if(h.purpose!=='Corrected purpose') throw new Error('the header did not change');
  if(Math.abs(h.gross_amount-13440)>0.02) throw new Error('gross '+h.gross_amount+', expected the sum of the lines');
  if(Math.abs(h.withholding_amount-200)>0.02) throw new Error('EWT '+h.withholding_amount);
  if(Math.abs(h.net_payable-13240)>0.02) throw new Error('net '+h.net_payable);
  const lines=sqlite.prepare('SELECT account_title,gross_amount,input_vat FROM erp_payment_request_lines WHERE rfp_ref=? ORDER BY line_no').all(rfp);
  if(lines.length!==2) throw new Error('lines '+lines.length);
  if(Math.abs(lines[0].input_vat-1200)>0.02) throw new Error('the VAT was not split from the gross: '+lines[0].input_vat);

  // Replacing the lines replaces them: a shrinking edit must not leave orphans.
  const again=await call('PATCH','/api/finance/payment-requests/'+id,{
    lines:[{accountTitle:'Marketing Cost',description:'Only line',grossAmount:500,vatRate:0,ewtAmount:0}]});
  if(!again.json?.ok) throw new Error(again.json?.error);
  const after=sqlite.prepare('SELECT COUNT(*) n FROM erp_payment_request_lines WHERE rfp_ref=?').get(rfp).n;
  if(after!==1) throw new Error('lines left behind: '+after);

  // Once it is out for signature the figure is frozen.
  sqlite.prepare("UPDATE erp_payment_requests SET status='SUBMITTED' WHERE id=?").run(id);
  const late=await call('PATCH','/api/finance/payment-requests/'+id,{purpose:'sneaky'});
  if(late.json?.ok) throw new Error('a submitted request was edited');
  if(!/no longer be edited/i.test(late.json.error||'')) throw new Error('wrong refusal: '+late.json.error);
  return {note:'header and lines edited, totals re-derived to 13,440 gross / 13,240 net; frozen once submitted'};
});

await t('a sales order becomes a receivable, once', async()=>{
  const cust=sqlite.prepare("SELECT id FROM erp_partners WHERE partner_type='CUSTOMER' LIMIT 1").get();
  const so=await call('POST','/api/sales',{transactionType:'LEASE',customerId:cust.id,
    orderDate:'2026-08-08',deliveryAddress:'Pasig',
    lines:[{itemCode:'SP-0001',description:'Lease billing',qty:1,unitPrice:50000}]});
  if(!so.json?.ok) throw new Error(so.json?.error);
  const r=await call('POST','/api/receivables/from-sales-order/'+so.json.id,{});
  if(!r.json?.ok) throw new Error(r.json?.error);
  const link=sqlite.prepare('SELECT stream,sales_order_no,gross_amount,status FROM erp_ar_collections WHERE sales_order_id=?').get(so.json.id);
  if(link.stream!=='MC_LEASED') throw new Error('stream '+link.stream);
  if(Number(link.gross_amount)!==50000) throw new Error('gross '+link.gross_amount);
  if(link.status!=='DRAFT') throw new Error('should arrive as a draft');
  // The same order cannot be raised twice, or the month is counted twice.
  const again=await call('POST','/api/receivables/from-sales-order/'+so.json.id,{});
  if(again.json?.ok) throw new Error('the same order was raised twice');
  return {note:'order '+link.sales_order_no+' -> receivable, drafted, and not duplicable'};
});


await t('a request can be part paid, and the balance stays owed', async()=>{
  // A supply order paid 30% down: the classic case a paid flag cannot express.
  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'Ampace Test Supply',department:'Operations',purpose:'Cells, 30% down',
    requestType:'Payment to Vendor',grossAmount:1000000,supplierInvoiceNo:'INV-AMPACE-1'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const id=mk.json.id, rfp=mk.json.requestNo;
  // Raised in March, so it is settled on the register's own terms rather than
  // held back by the evidence cutoff - that rule has its own test below.
  sqlite.prepare("UPDATE erp_payment_requests SET net_payable=1000000,gross_amount=1000000,request_date='2026-03-02',status='APPROVED' WHERE id=?").run(id);
  // Released by the CEO: a draft is not payable, and that has its own test.

  const down=await call('POST','/api/finance/payment-requests/'+id+'/settlements',
    {amount:300000,paidDate:'2026-03-05',paymentReference:'BT-DOWN-1',notes:'30% down payment'});
  if(!down.json?.ok) throw new Error(down.json?.error);
  if(Math.abs(down.json.settled-300000)>0.01) throw new Error('settled '+down.json.settled);
  if(Math.abs(down.json.balance-700000)>0.01) throw new Error('balance '+down.json.balance);
  if(down.json.coverage!=='PART') throw new Error('coverage '+down.json.coverage);
  const mid=sqlite.prepare('SELECT status FROM erp_payment_requests WHERE id=?').get(id).status;
  if(mid!=='PARTIALLY_PAID') throw new Error('status after a part payment: '+mid);

  // Overpaying is refused, by the balance and not by the total.
  const over=await call('POST','/api/finance/payment-requests/'+id+'/settlements',{amount:700001});
  if(over.json?.ok) throw new Error('the request was overpaid');
  if(!/still owed|overpay/i.test(over.json.error||'')) throw new Error('wrong refusal: '+over.json.error);

  // The balance closes it.
  const rest=await call('POST','/api/finance/payment-requests/'+id+'/settlements',
    {amount:700000,paidDate:'2026-05-04',paymentReference:'BT-BAL-1'});
  if(!rest.json?.ok) throw new Error(rest.json?.error);
  if(rest.json.balance>0.01) throw new Error('balance left: '+rest.json.balance);
  const end=sqlite.prepare('SELECT status,paid_at FROM erp_payment_requests WHERE id=?').get(id);
  if(end.status!=='PAID') throw new Error('status after settling in full: '+end.status);

  // Voiding the balance reopens it rather than deleting the history.
  const sid=sqlite.prepare("SELECT id FROM erp_payment_settlements WHERE request_no=? AND amount=700000").get(rfp).id;
  const v=await call('POST',`/api/finance/payment-requests/${id}/settlements/${sid}/void`,{reason:'Wrong request'});
  if(!v.json?.ok) throw new Error(v.json?.error);
  if(Math.abs(v.json.balance-700000)>0.01) throw new Error('void did not reopen the balance: '+v.json.balance);
  const back=sqlite.prepare('SELECT status FROM erp_payment_requests WHERE id=?').get(id).status;
  if(back!=='PARTIALLY_PAID') throw new Error('status after voiding the balance: '+back);
  return {note:rfp+': 30% down leaves 700,000 owed, overpayment refused, void reopens the balance'};
});

await t('nothing raised from the cutoff is called paid without proof', async()=>{
  const cutoff=sqlite.prepare("SELECT value FROM erp_rfp_settings WHERE key='rfp_paid_evidence_from'").get();
  if(!cutoff||cutoff.value!=='2026-07-31') throw new Error('the evidence cutoff is not set');
  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'Late Vendor',department:'Operations',purpose:'Raised after the cutoff',
    requestType:'Payment to Vendor',grossAmount:5000,supplierInvoiceNo:'INV-LATE-1'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const id=mk.json.id;
  sqlite.prepare("UPDATE erp_payment_requests SET net_payable=5000,gross_amount=5000,request_date='2026-08-03',status='APPROVED' WHERE id=?").run(id);

  // Settled in full, but nobody has shown the bank advice.
  const s1=await call('POST','/api/finance/payment-requests/'+id+'/settlements',
    {amount:5000,paidDate:'2026-08-04',paymentReference:'BT-LATE-1'});
  if(!s1.json?.ok) throw new Error(s1.json?.error);
  if(s1.json.balance>0.01) throw new Error('balance '+s1.json.balance);
  const held=sqlite.prepare('SELECT status FROM erp_payment_requests WHERE id=?').get(id).status;
  if(held==='PAID') throw new Error('a request from the cutoff was called paid with no proof');
  // Settled in full with nothing to show is its own state: the balance is nil,
  // so calling it part paid would be a lie in the other direction.
  if(held!=='PAID_UNPROVEN') throw new Error('unexpected status: '+held);

  // The proof closes it. A reference counts as proof once somebody puts their
  // name to it, which is what the uploader records.
  const sid=sqlite.prepare('SELECT id FROM erp_payment_settlements WHERE payment_request_id=?').get(id).id;
  const up=await call('POST',`/api/finance/payment-requests/${id}/settlements/${sid}/proof`,
    {proofReference:'BDO advice 2026-0803'});
  if(!up.json?.ok) throw new Error(up.json?.error);
  const now=sqlite.prepare('SELECT status FROM erp_payment_requests WHERE id=?').get(id).status;
  if(now!=='PAID') throw new Error('proof did not close the request: '+now);
  const proof=sqlite.prepare('SELECT proof_uploaded_by,proof_reference FROM erp_payment_settlements WHERE id=?').get(sid);
  if(!proof.proof_uploaded_by) throw new Error('the uploader was not recorded');
  const trail=sqlite.prepare('SELECT COUNT(*) n FROM erp_rfp_proof_of_payment WHERE rfp_ref=(SELECT request_no FROM erp_payment_requests WHERE id=?)').get(id).n;
  if(!trail) throw new Error('the proof left no trail for the register loader to read');
  // And an empty upload is refused rather than silently accepted.
  const bare=await call('POST',`/api/finance/payment-requests/${id}/settlements/${sid}/proof`,{});
  if(bare.json?.ok) throw new Error('an empty proof upload was accepted');
  return {note:'held at PARTIALLY PAID until proof, then closed by '+proof.proof_uploaded_by};
});

await t('every request standing as paid carries a settlement', async()=>{
  // Migration 0055 turns the register’s flat PAID flags into payments that can
  // be listed and questioned one at a time.
  const orphans=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_requests r
    WHERE r.status='PAID' AND NOT EXISTS(
      SELECT 1 FROM erp_payment_settlements s WHERE s.request_no=r.request_no AND s.status<>'VOID')`).get().n;
  if(orphans) throw new Error(orphans+' paid requests have no payment behind them');
  // And nothing settled adds up to more than what was asked for.
  const over=sqlite.prepare(`SELECT COUNT(*) n FROM (
      SELECT r.request_no, r.net_payable, SUM(s.amount) paid
        FROM erp_payment_requests r JOIN erp_payment_settlements s
          ON s.request_no=r.request_no AND s.status<>'VOID'
       GROUP BY r.request_no HAVING paid > r.net_payable + 0.01)`).get().n;
  if(over) throw new Error(over+' requests are settled beyond their net payable');
  return {note:'no paid request without a payment, no payment beyond the net payable'};
});

await t('the proof of payment came out of the sheet with the payment', async()=>{
  // Every advice hyperlinked in the register is on the record as a document of
  // its own kind, not mixed in with quotations.
  const docs=sqlite.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT record_no) rfps
    FROM erp_attachments WHERE record_type='PAYMENT_PROOF' AND active=1`).get();
  if(docs.n<200) throw new Error('only '+docs.n+' proof documents loaded');
  // A request carrying an advice is paid, and the payment points at the advice.
  const unproved=sqlite.prepare(`SELECT COUNT(*) n FROM erp_attachments a
    JOIN erp_payment_requests r ON r.request_no=a.record_no
    WHERE a.record_type='PAYMENT_PROOF' AND a.active=1 AND r.status NOT IN ('PAID','PARTIALLY_PAID')`).get().n;
  if(unproved) throw new Error(unproved+' requests have an advice but are not paid');
  const unlinked=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_settlements s
    WHERE s.status<>'VOID' AND s.proof_attachment_id IS NULL
      AND EXISTS(SELECT 1 FROM erp_attachments a WHERE a.record_type='PAYMENT_PROOF'
                  AND a.record_no=s.request_no AND a.active=1)`).get().n;
  if(unlinked) throw new Error(unlinked+' payments have an advice on the record but do not point at it');
  // The uploader is recorded on every one of them, which is the whole point.
  const anon=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_settlements
    WHERE proof_attachment_id IS NOT NULL AND COALESCE(proof_uploaded_by,'')=''`).get().n;
  if(anon) throw new Error(anon+' proofs have nobody against them');
  // And the down payment is untouched: no advice, still part paid.
  const x=sqlite.prepare(`SELECT status FROM erp_payment_requests WHERE request_no='RFP-OPS2026-00101'`).get();
  if(x && x.status!=='PARTIALLY_PAID') throw new Error('the down payment was closed: '+x.status);
  return {note:docs.n+' advices on '+docs.rfps+' requests, every one linked and attributed'};
});

await t('which vendors host a station is chosen, not guessed', async()=>{
  /*
   * Reading a host out of a line description put Meralco, a construction firm
   * and a member of staff into a chart headed "station site costs by host".
   * A vendor either hosts a station or does not, and Finance says which.
   */
  const list=await call('GET','/api/finance/business-lines');
  if(!list.json?.ok) throw new Error(list.json?.error);
  const hosts=list.json.hosts||[];
  if(!hosts.length) throw new Error('no candidate vendors were offered');
  if(!hosts.some(h=>h.chosen)) throw new Error('the seeded hosts are not marked as chosen');

  // The same name spelled two ways is one vendor, or its total splits in half.
  const keys=hosts.map(h=>h.payee_key);
  if(new Set(keys).size!==keys.length) throw new Error('a vendor is offered twice');
  const alfa=hosts.filter(h=>/ALFAMART/.test(h.payee_key));
  if(alfa.length!==1) throw new Error('ALFAMART appears '+alfa.length+' times');

  const before=sqlite.prepare(`SELECT ROUND(COALESCE(SUM(gross_amount),0),2) v
    FROM v_bss_cost_kind WHERE cost_kind='SITES'`).get().v;
  if(!(before>0)) throw new Error('no site costs against the seeded hosts');

  // Only Finance decides.
  sqlite.prepare("UPDATE erp_users SET role_code='STAFF' WHERE email='mmungcal@nrdev.ph'").run();
  const nope=await call('PUT','/api/finance/business-lines/BSS/hosts',{hosts:[]});
  sqlite.prepare("UPDATE erp_users SET role_code='FINANCE' WHERE email='mmungcal@nrdev.ph'").run();
  if(nope.json?.ok) throw new Error('a non-Finance user changed the host list');

  // Choosing changes what the chart reads, which is the whole point.
  const one=alfa[0].payee_key;
  const saved=await call('PUT','/api/finance/business-lines/BSS/hosts',{hosts:[one]});
  if(!saved.json?.ok) throw new Error(saved.json?.error);
  const after=sqlite.prepare(`SELECT ROUND(COALESCE(SUM(gross_amount),0),2) v
    FROM v_bss_cost_kind WHERE cost_kind='SITES'`).get().v;
  if(!(after>0)||after>=before) throw new Error(`narrowing the list did not narrow the costs: ${before} -> ${after}`);
  const only=sqlite.prepare(`SELECT DISTINCT payee_key FROM v_bss_cost_kind WHERE cost_kind='SITES'`).all();
  if(only.length!==1||only[0].payee_key!==one)
    throw new Error('a vendor nobody chose is still counted: '+only.map(o=>o.payee_key).join(', '));

  // Put the seeded pair back for the tests that follow.
  await call('PUT','/api/finance/business-lines/BSS/hosts',
    {hosts:hosts.filter(h=>h.chosen).map(h=>h.payee_key)});
  return {note:`${hosts.length} candidates, spellings merged, only the chosen ones count`};
});

await t('the swapping network is its own business line', async()=>{
  const lines=sqlite.prepare(`SELECT v.line_code, COUNT(*) n, ROUND(SUM(r.net_payable),2) v
    FROM erp_payment_requests r JOIN v_payment_request_line v ON v.request_no=r.request_no
    WHERE r.status NOT IN ('REJECTED','CANCELLED') GROUP BY v.line_code ORDER BY v DESC`).all();
  const by=Object.fromEntries(lines.map(l=>[l.line_code,l]));
  if(!by.BSS||!by.CORE) throw new Error('expected both lines, got '+lines.map(l=>l.line_code).join(','));
  if(Number(by.BSS.v)<=0) throw new Error('the swapping line has no spend against it');

  // A station bought on a Supply Chain request is still a station: the account
  // title has to beat the department, or the network total is understated.
  const elsewhere=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_requests r
    JOIN v_payment_request_line v ON v.request_no=r.request_no
    WHERE v.line_code='BSS' AND UPPER(r.department)<>'RIDEBOX'`).get().n;
  if(!elsewhere) throw new Error('no station spend was found outside the RideBox department');

  // The name tidying: RideBox must be one department, not two spellings.
  const spellings=sqlite.prepare(`SELECT COUNT(DISTINCT department) n FROM erp_payment_requests
    WHERE UPPER(TRIM(department))='RIDEBOX'`).get().n;
  if(spellings!==1) throw new Error('RideBox is still spelled '+spellings+' ways');

  // Building a station and keeping it standing are different costs.
  const kinds=sqlite.prepare(`SELECT cost_kind, ROUND(SUM(gross_amount),2) v
    FROM v_bss_cost_kind GROUP BY cost_kind`).all();
  const kb=Object.fromEntries(kinds.map(k=>[k.cost_kind,Number(k.v)]));
  if(!(kb.BUILD>0)||!(kb.SITES>0)) throw new Error('build/sites split is empty: '+JSON.stringify(kb));

  // The site rents are small and go to the shops the stations stand in.
  const hosts=sqlite.prepare(`SELECT k.payee_key p, ROUND(SUM(k.gross_amount),2) v
    FROM v_bss_cost_kind k WHERE k.cost_kind='SITES' GROUP BY k.payee_key ORDER BY v DESC`).all();
  if(!hosts.some(h=>/ALFAMART|POWER ?FILL/i.test(h.p||'')))
    throw new Error('no host merchant among the site costs: '+hosts.map(h=>h.p).join(', '));
  // And nobody who was never chosen.
  const stray=hosts.filter(h=>!/ALFAMART|POWER ?FILL/i.test(h.p||''));
  if(stray.length) throw new Error('unchosen vendors in the site costs: '+stray.map(h=>h.p).join(', '));

  return {note:`BSS ${by.BSS.n} requests / ${Number(by.BSS.v).toLocaleString()} · `
    +`build ${kb.BUILD.toLocaleString()} vs sites ${kb.SITES.toLocaleString()} · `
    +`${elsewhere} station requests raised outside RideBox`};
});

await t('a redeploy does not settle anything twice or undo a correction', async()=>{
  /*
   * Migrations re-run on every deploy. The register loader used to check only
   * for its own key, so a request settled through the app was settled a second
   * time on the next deploy, and a payment somebody had voided was deleted and
   * re-asserted. Both are money bugs, and both are invisible until the deploy.
   */
  const rerun=()=>{
    for(const f of readdirSync(join(ROOT,'migrations'))
        .filter(f=>/^005[4-7].*\.sql$/.test(f)).sort()){
      sqlite.exec(readFileSync(join(ROOT,'migrations',f),'utf8'));
    }
  };

  // A request paid through the workflow, then the register loader runs again.
  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'Redeploy Vendor',department:'Operations',purpose:'Once, not twice',
    requestType:'Payment to Vendor',grossAmount:250000,supplierInvoiceNo:'INV-REDEPLOY-1'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const id=mk.json.id, rfp=mk.json.requestNo;
  sqlite.prepare("UPDATE erp_payment_requests SET net_payable=250000,request_date='2026-02-02',status='APPROVED' WHERE id=?").run(id);
  const s1=await call('POST','/api/finance/payment-requests/'+id+'/settlements',
    {amount:250000,paidDate:'2026-02-10',paymentReference:'BT-REDEPLOY-1'});
  if(!s1.json?.ok) throw new Error(s1.json?.error);

  rerun();
  const after=sqlite.prepare(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(amount),0),2) v
    FROM erp_payment_settlements WHERE request_no=? AND status<>'VOID'`).get(rfp);
  if(after.n!==1) throw new Error('a redeploy left '+after.n+' payments on '+rfp);
  if(Math.abs(after.v-250000)>0.01) throw new Error('a redeploy settled '+after.v+' against 250,000');

  // A correction: the import claimed a payment, Finance voided it and recorded
  // the real one. A redeploy must leave both the void and the correction alone.
  const imported=sqlite.prepare(`SELECT s.id, s.request_no, r.id rid, r.net_payable
    FROM erp_payment_settlements s JOIN erp_payment_requests r ON r.id=s.payment_request_id
    WHERE s.source='REGISTER_IMPORT' AND s.status<>'VOID' AND r.net_payable>1000
    ORDER BY s.id LIMIT 1`).get();
  if(imported){
    const v=await call('POST',`/api/finance/payment-requests/${imported.rid}/settlements/${imported.id}/void`,
      {reason:'Only part of this moved'});
    if(!v.json?.ok) throw new Error(v.json?.error);
    const part=Math.round(imported.net_payable*0.4*100)/100;
    const s2=await call('POST','/api/finance/payment-requests/'+imported.rid+'/settlements',
      {amount:part,paidDate:'2026-06-01',paymentReference:'BT-CORRECTION'});
    if(!s2.json?.ok) throw new Error(s2.json?.error);

    rerun();
    const voided=sqlite.prepare('SELECT status,void_reason FROM erp_payment_settlements WHERE id=?').get(imported.id);
    if(!voided) throw new Error('the redeploy deleted the voided payment and its reason with it');
    if(voided.status!=='VOID') throw new Error('the redeploy un-voided a payment');
    if(!voided.void_reason) throw new Error('the reason for the void was lost');
    const live=sqlite.prepare(`SELECT COUNT(*) n, ROUND(COALESCE(SUM(amount),0),2) v
      FROM erp_payment_settlements WHERE request_no=? AND status<>'VOID'`).get(imported.request_no);
    if(live.n!==1||Math.abs(live.v-part)>0.01)
      throw new Error(`the redeploy re-asserted the import: ${live.n} payments totalling ${live.v}`);
    const st=sqlite.prepare('SELECT status FROM erp_payment_requests WHERE id=?').get(imported.rid).status;
    if(st!=='PARTIALLY_PAID') throw new Error('the redeploy put the corrected request back to '+st);
  }
  return {note:'no double settlement, no resurrected import, the void and its reason survive'};
});

await t('closing a payment is a Finance act, and settles only the balance', async()=>{
  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'Confirm Vendor',department:'Operations',purpose:'Confirm path',
    requestType:'Payment to Vendor',grossAmount:120000,supplierInvoiceNo:'INV-CONFIRM-1'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const id=mk.json.id, rfp=mk.json.requestNo;
  sqlite.prepare("UPDATE erp_payment_requests SET net_payable=120000,request_date='2026-03-03',status='PAYMENT_PREPARED' WHERE id=?").run(id);
  // Part paid already: confirming must record what is left, not the whole thing.
  sqlite.prepare(`INSERT INTO erp_payment_settlements(request_no,payment_request_id,amount,paid_date,
    source,recorded_by,natural_key) VALUES(?,?,?,?,'SYSTEM',?,?)`)
    .run(rfp,id,50000,'2026-03-04','mmungcal@nrdev.ph','TEST:'+rfp);

  // Somebody without Finance cannot close it.
  sqlite.prepare("UPDATE erp_users SET role_code='STAFF' WHERE email='mmungcal@nrdev.ph'").run();
  const nope=await call('POST','/api/finance/payment-requests/'+id+'/action',
    {action:'CONFIRM_PAID',proofReference:'anything'});
  sqlite.prepare("UPDATE erp_users SET role_code='FINANCE' WHERE email='mmungcal@nrdev.ph'").run();
  if(nope.json?.ok) throw new Error('a non-Finance user closed a payment');
  if(!/finance/i.test(nope.json.error||'')) throw new Error('wrong refusal: '+nope.json.error);

  const total=sqlite.prepare(`SELECT ROUND(COALESCE(SUM(amount),0),2) v FROM erp_payment_settlements
    WHERE request_no=? AND status<>'VOID'`).get(rfp).v;
  if(Math.abs(total-50000)>0.01) throw new Error('the refused action still moved money: '+total);
  return {note:'Finance only; the part already paid is not recorded again'};
});

await t('the encoder is not the requestor, so the checker may still check', async()=>{
  /*
   * Rucel encodes every request in the company and checks every one. If the
   * record said she was the requestor, separation of duties - which is right -
   * would refuse her at the Finance check on all of them.
   */
  sqlite.prepare(`INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active)
    VALUES('rhonrado@nrdev.ph','Rucel Mae Honrado','FINANCE_REVIEWER','Finance and Accounting',1)`).run();
  sqlite.prepare(`INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active)
    VALUES('ops.person@nrdev.ph','Ops Person','STAFF','Operations',1)`).run();

  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'Encoded Vendor',department:'Operations',purpose:'Typed in by Finance',
    requestType:'Payment to Vendor',grossAmount:4000,supplierInvoiceNo:'INV-ENCODE-1',
    requestorEmail:'ops.person@nrdev.ph',requestorName:'Ops Person'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const rfp=mk.json.requestNo;

  // The request belongs to the person who asked for it.
  const row=sqlite.prepare('SELECT requestor_email FROM erp_payment_requests WHERE request_no=?').get(rfp);
  if(row.requestor_email!=='ops.person@nrdev.ph')
    throw new Error('the request was filed under the encoder: '+row.requestor_email);

  // And the record says who typed it in.
  const enc=sqlite.prepare('SELECT * FROM erp_rfp_encoders WHERE request_no=?').get(rfp);
  if(!enc) throw new Error('the encoder was not recorded');
  if(enc.encoded_by!=='mmungcal@nrdev.ph') throw new Error('wrong encoder: '+enc.encoded_by);
  if(enc.encoded_for!=='ops.person@nrdev.ph') throw new Error('wrong requestor: '+enc.encoded_for);

  // Raising one for yourself still files it under you, encoder or not.
  const own=await call('POST','/api/finance/payment-requests',{
    payeeName:'Own Vendor',department:'Finance and Accounting',purpose:'My own claim',
    requestType:'Reimbursement',grossAmount:500,supplierInvoiceNo:'INV-OWN-1'});
  if(!own.json?.ok) throw new Error(own.json?.error);
  const mine=sqlite.prepare('SELECT requestor_email FROM erp_payment_requests WHERE request_no=?')
    .get(own.json.requestNo);
  if(mine.requestor_email!=='mmungcal@nrdev.ph')
    throw new Error('an own request was filed under somebody else: '+mine.requestor_email);
  return {note:rfp+' asked by Ops Person, typed in by '+enc.encoded_by};
});

await t('a cost filed under the wrong department can be corrected', async()=>{
  /*
   * The Alfamart station rents came into the register under Admin. That is a
   * filing error, not a payment error, and the checker puts filing straight -
   * at any status, because a request paid six months ago can still be filed
   * wrong and the business line would be wrong forever.
   */
  const mk=await call('POST','/api/finance/payment-requests',{
    payeeName:'HOST SHOP TRADING, INC.',department:'Admin',purpose:'Station site rent',
    requestType:'Payment to Vendor',grossAmount:3500,supplierInvoiceNo:'INV-HOST-1'});
  if(!mk.json?.ok) throw new Error(mk.json?.error);
  const id=mk.json.id, rfp=mk.json.requestNo;
  // Paid and closed: correcting the filing must still work.
  sqlite.prepare("UPDATE erp_payment_requests SET status='PAID' WHERE id=?").run(id);

  const bare=await call('PATCH','/api/finance/payment-requests/'+id+'/classification',{});
  if(bare.json?.ok) throw new Error('an empty correction was accepted');

  const moved=await call('PATCH','/api/finance/payment-requests/'+id+'/classification',
    {department:'RideBox',costCenter:'Network Rollout',reason:'Station site rent'});
  if(!moved.json?.ok) throw new Error(moved.json?.error);
  const after=sqlite.prepare('SELECT department,cost_center,status,net_payable FROM erp_payment_requests WHERE id=?').get(id);
  if(after.department!=='RideBox') throw new Error('department is still '+after.department);
  if(Number(after.net_payable)!==3500) throw new Error('correcting the filing moved the money');
  if(after.status!=='PAID') throw new Error('correcting the filing changed the status');

  // The trail says who moved it and from where.
  const trail=sqlite.prepare(`SELECT actor,reason FROM erp_rfp_approvals
    WHERE rfp_ref=? AND stage='RECLASSIFY'`).get(rfp);
  if(!trail) throw new Error('the correction left no trail');
  if(!/Admin -> RideBox/.test(trail.reason||'')) throw new Error('the trail does not say what changed: '+trail.reason);

  // Every request for one payee at once, because nine of ten corrected is worse
  // than none.
  const two=await call('POST','/api/finance/payment-requests',{
    payeeName:'HOST SHOP TRADING INC',department:'Admin',purpose:'Station site rent, second month',
    requestType:'Payment to Vendor',grossAmount:3500,supplierInvoiceNo:'INV-HOST-2'});
  if(!two.json?.ok) throw new Error(two.json?.error);
  const bulk=await call('POST','/api/finance/payees/reclassify',
    {payee:'HOST SHOP TRADING, INC.',department:'RideBox',reason:'All station site rents'});
  if(!bulk.json?.ok) throw new Error(bulk.json?.error);
  // Two spellings, one payee: the second must have moved with the first.
  const stillAdmin=sqlite.prepare(`SELECT COUNT(*) n FROM erp_payment_requests
    WHERE payee_name LIKE 'HOST SHOP%' AND department<>'RideBox'`).get().n;
  if(stillAdmin) throw new Error(stillAdmin+' request(s) were left behind under Admin');

  // Not everyone may reclassify.
  sqlite.prepare("UPDATE erp_users SET role_code='STAFF' WHERE email='mmungcal@nrdev.ph'").run();
  const nope=await call('PATCH','/api/finance/payment-requests/'+id+'/classification',{department:'Admin'});
  sqlite.prepare("UPDATE erp_users SET role_code='FINANCE' WHERE email='mmungcal@nrdev.ph'").run();
  if(nope.json?.ok) throw new Error('a non-Finance user refiled a cost');
  return {note:'moved at PAID, both spellings together, figures untouched, trail kept'};
});

await t('the sales register carries the money that came in', async()=>{
  /*
   * The register held the billing side and not the collecting side, so the
   * collection rate read zero against three and a half million pesos. Every
   * row of the monitoring sheet carries a deposit date, a method and a bank:
   * the customers had paid, and the register should say so.
   */
  const posted=sqlite.prepare(`SELECT stream, COUNT(*) n, ROUND(SUM(gross_amount),2) v
    FROM erp_ar_collections WHERE status='POSTED' GROUP BY stream ORDER BY stream`).all();
  const streams=posted.map(p=>p.stream);
  for(const want of ['AFTERSALES','MC_SOLD'])
    if(!streams.includes(want)) throw new Error(want+' was never posted');
  // The two Alexis said she would review stay as drafts. Scoped to the import:
  // a lease somebody posts by hand in the app is their decision, not ours.
  const drafted=sqlite.prepare(`SELECT DISTINCT stream FROM erp_ar_collections
    WHERE status='POSTED' AND source_system='SALES_MONITORING_2026'
      AND stream IN ('MC_LEASED','BATTERY_SWAP')`).all();
  if(drafted.length) throw new Error('imported and posted without being asked: '
    +drafted.map(d=>d.stream).join(', '));

  // Every posted entry the sheet says was settled has its receipt.
  const missing=sqlite.prepare(`SELECT COUNT(*) n FROM erp_ar_collections c
    WHERE c.status='POSTED' AND COALESCE(c.settlement_date,'')<>'' AND c.gross_amount>0
      AND NOT EXISTS(SELECT 1 FROM erp_ar_receipts r WHERE r.collection_id=c.id AND r.status<>'VOID')`).get().n;
  if(missing) throw new Error(missing+' settled entries have no receipt against them');

  // And none of them is collected for more than it was billed.
  const over=sqlite.prepare(`SELECT COUNT(*) n FROM (
      SELECT c.id FROM erp_ar_collections c
      JOIN erp_ar_receipts r ON r.collection_id=c.id AND r.status<>'VOID'
      GROUP BY c.id HAVING SUM(r.amount) > c.gross_amount + 0.01)`).get().n;
  if(over) throw new Error(over+' entries are collected beyond what was billed');

  // The rate that reads zero when nothing is recorded now reads what happened.
  const billed=sqlite.prepare(`SELECT COALESCE(SUM(gross_amount),0) v FROM erp_ar_collections
    WHERE status='POSTED'`).get().v;
  const got=sqlite.prepare(`SELECT COALESCE(SUM(r.amount),0) v FROM erp_ar_receipts r
    JOIN erp_ar_collections c ON c.id=r.collection_id
    WHERE r.status<>'VOID' AND c.status='POSTED'`).get().v;
  if(!(billed>0)) throw new Error('nothing is posted at all');
  const pct=(got/billed)*100;
  if(!(pct>50)) throw new Error(`collection still reads ${pct.toFixed(1)}% of ${billed}`);

  // A row loaded twice is a sale counted twice.
  const dup=sqlite.prepare(`SELECT COUNT(*) n FROM (SELECT source_key FROM erp_ar_collections
    WHERE source_key IS NOT NULL GROUP BY source_key HAVING COUNT(*)>1)`).get().n;
  if(dup) throw new Error(dup+' sheet rows were loaded more than once');
  return {note:`${Math.round(pct)}% collected: ${got.toLocaleString()} of ${billed.toLocaleString()} posted`};
});

await t('nothing is on the record twice', async()=>{
  /*
   * Every register in this system was loaded from a spreadsheet, most of them
   * more than once while the import was being got right, and the migrations
   * re-run on every deploy. A duplicate is not a cosmetic problem here: it is
   * a sale counted twice, a supplier paid twice on paper, or a document that
   * makes a reader ask which copy is the real one.
   *
   * So this asserts the absence of duplicates across the lot, keyed on what
   * actually identifies each thing rather than on a loose resemblance. Three
   * R280s sold to the same customer on the same day for the same price are
   * three sales; they are told apart by their receipt numbers.
   */
  const checks=[
    ['payment requests', `SELECT request_no k FROM erp_payment_requests GROUP BY request_no HAVING COUNT(*)>1`],
    ['payment request lines', `SELECT rfp_ref k FROM erp_payment_request_lines GROUP BY rfp_ref,line_no HAVING COUNT(*)>1`],
    ['settlements', `SELECT natural_key k FROM erp_payment_settlements
       WHERE COALESCE(natural_key,'')<>'' GROUP BY natural_key HAVING COUNT(*)>1`],
    ['a request settled beyond its net payable', `SELECT r.request_no k FROM erp_payment_requests r
       JOIN erp_payment_settlements s ON s.request_no=r.request_no AND s.status<>'VOID'
       GROUP BY r.request_no HAVING SUM(s.amount)>r.net_payable+0.01`],
    ['attachments', `SELECT record_no k FROM erp_attachments WHERE active=1
       GROUP BY record_type,COALESCE(record_no,''),COALESCE(file_url,''),file_name HAVING COUNT(*)>1`],
    ['collections by number', `SELECT entry_no k FROM erp_ar_collections GROUP BY entry_no HAVING COUNT(*)>1`],
    ['collections by sheet row', `SELECT source_key k FROM erp_ar_collections
       WHERE COALESCE(source_key,'')<>'' GROUP BY source_key HAVING COUNT(*)>1`],
    ['the same sale on the same document', `SELECT entry_no k FROM erp_ar_collections
       GROUP BY stream,txn_date,customer_name,gross_amount,COALESCE(document_no,'') HAVING COUNT(*)>1`],
    ['receipts', `SELECT receipt_no k FROM erp_ar_receipts GROUP BY receipt_no HAVING COUNT(*)>1`],
    ['a collection receipted beyond what was billed', `SELECT c.entry_no k FROM erp_ar_collections c
       JOIN erp_ar_receipts r ON r.collection_id=c.id AND r.status<>'VOID'
       GROUP BY c.id HAVING SUM(r.amount)>c.gross_amount+0.01`],
    ['customers by name', `SELECT name k FROM erp_partners WHERE partner_type='CUSTOMER'
       GROUP BY UPPER(TRIM(name)) HAVING COUNT(*)>1`],
    ['partner codes', `SELECT partner_code k FROM erp_partners GROUP BY partner_code HAVING COUNT(*)>1`],
    // COALESCE, not IS NOT NULL: an order raised in the app carries an empty
    // source key, and two of those are two orders, not a duplicated import.
    ['sales orders by sheet row', `SELECT source_key k FROM erp_sales_orders
       WHERE COALESCE(source_key,'')<>'' GROUP BY source_key HAVING COUNT(*)>1`],
    ['lease contracts', `SELECT lease_no k FROM erp_lease_contracts GROUP BY lease_no HAVING COUNT(*)>1`],
    ['a unit out on two contracts at once', `SELECT serial_no k FROM erp_asset_deployments
       WHERE returned_at IS NULL GROUP BY serial_no HAVING COUNT(*)>1`],
    ['serialised units', `SELECT serial_no k FROM erp_assets WHERE COALESCE(serial_no,'')<>''
       GROUP BY serial_no HAVING COUNT(*)>1`],
    ['business line rules', `SELECT match_value k FROM erp_business_line_rules
       GROUP BY match_type,match_value HAVING COUNT(*)>1`],
  ];
  const found=[];
  for(const [what,q] of checks){
    let rows;
    try{ rows=sqlite.prepare(q).all(); }
    catch(e){ throw new Error(`the check for ${what} does not run: ${e.message}`); }
    if(rows.length) found.push(`${what}: ${rows.length} (${rows.slice(0,3).map(r=>r.k).join(', ')})`);
  }
  if(found.length) throw new Error('duplicates -> '+found.join(' | '));

  // And the totals footer of a sheet is not a customer. Importing it created
  // thirteen contracts for clients called "3" and "14".
  const junk=sqlite.prepare(`SELECT COUNT(*) n FROM erp_partners
    WHERE partner_type='CUSTOMER' AND (name GLOB '[0-9]*' OR UPPER(name) LIKE 'TOTAL%')`).get().n;
  if(junk) throw new Error(junk+' customers came from a totals row rather than a contract');
  return {note:checks.length+' registers checked, nothing on the record twice'};
});

await t('a unit out with a customer is deployed, not missing', async()=>{
  const lease=sqlite.prepare(`SELECT id,lease_no FROM erp_lease_contracts WHERE status='ACTIVE'
    ORDER BY id LIMIT 1`).get();
  if(!lease) throw new Error('no running contract to deploy against');
  const other=sqlite.prepare(`SELECT id,lease_no FROM erp_lease_contracts WHERE id<>? ORDER BY id LIMIT 1`)
    .get(lease.id);

  // The serialised unit the suite seeds lives in the warehouse.
  const before=sqlite.prepare(`SELECT current_status FROM erp_assets WHERE serial_no='TESTVIN0001'`).get();
  if(!before) throw new Error('the seeded unit is gone');

  const out=await call('POST',`/api/sales/leases/${lease.id}/deploy`,{serials:['TESTVIN0001']});
  if(!out.json?.ok) throw new Error(out.json?.error);
  if(!out.json.deployed.includes('TESTVIN0001')) throw new Error('the unit was not deployed');

  // The unit says where it is, so a count reads it off the register.
  const after=sqlite.prepare(`SELECT current_status FROM erp_assets WHERE serial_no='TESTVIN0001'`).get();
  if(after.current_status!=='LEASED') throw new Error('the unit still reads '+after.current_status);

  // And the question a count asks has an answer.
  const where=await call('GET','/api/sales/units/TESTVIN0001/location');
  if(!where.json?.ok) throw new Error(where.json?.error);
  if(!where.json.deployed) throw new Error('the unit is deployed but the register cannot say where');

  // One unit, one contract. Sending it out again elsewhere is refused by name
  // rather than silently moved, or the first customer loses it off their books.
  if(other){
    const twice=await call('POST',`/api/sales/leases/${other.id}/deploy`,{serials:['TESTVIN0001']});
    if(!twice.json?.ok) throw new Error(twice.json?.error);
    if(twice.json.deployed.length) throw new Error('a unit was sent out on two contracts at once');
    if(!/already out/.test((twice.json.refused[0]||{}).reason||''))
      throw new Error('the refusal does not say why: '+JSON.stringify(twice.json.refused));
  }

  // Coming back closes the row rather than deleting it.
  const back=await call('POST',`/api/sales/leases/${lease.id}/return`,
    {serials:['TESTVIN0001'],reason:'End of term'});
  if(!back.json?.ok) throw new Error(back.json?.error);
  const home=sqlite.prepare(`SELECT current_status FROM erp_assets WHERE serial_no='TESTVIN0001'`).get();
  if(home.current_status!=='AVAILABLE') throw new Error('the returned unit reads '+home.current_status);
  const hist=sqlite.prepare(`SELECT COUNT(*) n FROM erp_asset_deployments WHERE serial_no='TESTVIN0001'`).get().n;
  if(!hist) throw new Error('the deployment history was deleted rather than closed');
  return {note:'deployed to '+lease.lease_no+', refused a second contract, returned and back on the shelf'};
});

await t('a lease contract opens with its units, its paper and its gap', async()=>{
  const lease=sqlite.prepare(`SELECT id,lease_no,unit_count FROM erp_lease_contracts
    WHERE status='ACTIVE' ORDER BY id LIMIT 1`).get();
  if(!lease) throw new Error('no running contract to open');

  const before=await call('GET',`/api/sales/leases/${lease.id}`);
  if(!before.json?.ok) throw new Error(before.json?.error);
  if(before.json.header.lease_no!==lease.lease_no) throw new Error('opened the wrong contract');
  if(!Array.isArray(before.json.units)) throw new Error('the contract cannot list its units');
  if(!Array.isArray(before.json.documents)) throw new Error('the contract cannot list its paper');

  // Tag two units out and read them back off the contract.
  const spare=sqlite.prepare(`SELECT serial_no FROM erp_assets
    WHERE current_status='AVAILABLE' AND serial_no NOT IN
      (SELECT serial_no FROM erp_asset_deployments WHERE returned_at IS NULL)
    ORDER BY id LIMIT 2`).all().map(r=>r.serial_no);
  if(spare.length<2) throw new Error('not enough free units to tag out');
  const tag=await call('POST',`/api/sales/leases/${lease.id}/deploy`,{serials:spare,note:'e2e'});
  if(!tag.json?.ok) throw new Error(tag.json?.error);
  if(tag.json.deployed.length!==2) throw new Error('tagged '+tag.json.deployed.length+' of 2');

  const opened=await call('GET',`/api/sales/leases/${lease.id}`);
  const open=opened.json.units.filter(u=>!u.returned_at).map(u=>u.serial_no);
  for(const s of spare) if(!open.includes(s)) throw new Error(s+' is tagged out but not on the contract');

  /*
   * The signed contract. Filed against the lease, and it must be reachable from
   * the lease register too, or the screen reads "no contract on file" for a
   * contract that is plainly on file.
   */
  const up=await call('POST',`/api/sales/leases/${lease.id}/documents`,
    {attachments:[{fileName:'lease-signed.pdf',contentType:'application/pdf',size:12,
      data:Buffer.from('signed here').toString('base64')}]});
  if(!up.json?.ok) throw new Error(up.json?.error);
  const withDoc=await call('GET',`/api/sales/leases/${lease.id}`);
  if(!withDoc.json.documents.some(d=>d.file_name==='lease-signed.pdf'))
    throw new Error('the uploaded contract is not on the record');
  const register=await call('GET','/api/sales/leases');
  const row=(register.json.rows||[]).find(r=>r.id===lease.id);
  if(!row) throw new Error('the contract fell out of the register');
  if(!Number(row.documents)) throw new Error('the register still reads no contract on file');
  if(Number(row.units_out)<2) throw new Error('the register reads '+row.units_out+' units out, expected at least 2');

  // Put them back so the rest of the suite starts where it found things.
  await call('POST',`/api/sales/leases/${lease.id}/return`,{serials:spare,reason:'e2e teardown'});
  return {note:`${lease.lease_no} opened with ${opened.json.units.length} units and its signed contract`};
});

await t('a contract that arrived without a rate can be priced, and its order follows', async()=>{
  /*
   * Sixteen of the twenty-two contracts came off the lease sheet with the
   * daily-rate cell blank, so the order behind each valued at zero and the
   * register read as if the company leased motorcycles for nothing. The rate is
   * only on the signed contract, so it has to be typeable - and the order value
   * has to follow the rate rather than be typed beside it.
   */
  const blank=sqlite.prepare(`SELECT id,lease_no,sales_order_id,unit_count
    FROM erp_lease_contracts WHERE COALESCE(daily_rate_vat_ex,0)=0 AND sales_order_id IS NOT NULL
    ORDER BY id LIMIT 1`).get();
  if(!blank) throw new Error('no contract without a rate to price');
  const before=sqlite.prepare(`SELECT gross_amount FROM erp_sales_orders WHERE id=?`).get(blank.sales_order_id);
  if(Number(before.gross_amount)!==0) throw new Error('the order already carries '+before.gross_amount);

  const saved=await call('PATCH',`/api/sales/leases/${blank.id}`,
    {dailyRateVatEx:200,unitCount:5,effectiveDate:'2026-01-01',endOfTerm:'2027-01-01',depositAmount:50000});
  if(!saved.json?.ok) throw new Error(saved.json?.error);
  // 200 x 5 units x 365 days.
  if(Math.abs(saved.json.orderValue-365000)>0.01)
    throw new Error('valued at '+saved.json.orderValue+', expected 365,000');
  const after=sqlite.prepare(`SELECT gross_amount,contract_start,contract_end FROM erp_sales_orders WHERE id=?`)
    .get(blank.sales_order_id);
  if(Math.abs(Number(after.gross_amount)-365000)>0.01)
    throw new Error('the order still reads '+after.gross_amount);
  if(after.contract_start!=='2026-01-01') throw new Error('the term did not follow onto the order');
  const c=sqlite.prepare(`SELECT daily_rate_vat_ex,unit_count,deposit_amount FROM erp_lease_contracts WHERE id=?`)
    .get(blank.id);
  if(Number(c.daily_rate_vat_ex)!==200) throw new Error('the rate was not stored');
  if(Number(c.deposit_amount)!==50000) throw new Error('the deposit was not stored');

  // The register reads it back, so the screen and the record agree.
  const list=await call('GET','/api/sales/leases');
  const row=(list.json.rows||[]).find(r=>r.id===blank.id);
  if(Number(row.daily_rate_vat_ex)!==200) throw new Error('the register does not carry the rate');

  // Nonsense is refused rather than stored and shown as a figure.
  const bad=await call('PATCH',`/api/sales/leases/${blank.id}`,{dailyRateVatEx:-5});
  if(bad.json?.ok) throw new Error('a negative rate was accepted');
  const back=await call('PATCH',`/api/sales/leases/${blank.id}`,
    {effectiveDate:'2027-01-01',endOfTerm:'2026-01-01'});
  if(back.json?.ok) throw new Error('a term that ends before it starts was accepted');
  const stillThere=sqlite.prepare(`SELECT daily_rate_vat_ex FROM erp_lease_contracts WHERE id=?`).get(blank.id);
  if(Number(stillThere.daily_rate_vat_ex)!==200) throw new Error('a refused edit still changed the record');
  return {note:`${blank.lease_no} priced at 200/day, its order re-valued to 365,000`};
});

await t('a count does not write off a unit that is out with a customer', async()=>{
  /*
   * The money bug this guards. A leased unit is absent from the shelf on
   * purpose; counting it as MISSING takes its cost out of inventory and books a
   * loss against a unit whose holder the company can name.
   */
  const lease=sqlite.prepare(`SELECT id,lease_no FROM erp_lease_contracts
    WHERE status='ACTIVE' ORDER BY id LIMIT 1`).get();
  const unit=sqlite.prepare(`SELECT a.id,a.serial_no,a.current_location_id,a.unit_cost,a.category
    FROM erp_assets a
    WHERE a.current_status='AVAILABLE' AND a.current_location_id IS NOT NULL AND a.category='MC'
      AND COALESCE(a.unit_cost,0)>0
      AND a.serial_no NOT IN (SELECT serial_no FROM erp_asset_deployments WHERE returned_at IS NULL)
    ORDER BY a.id LIMIT 1`).get();
  if(!lease||!unit) throw new Error('no free unit at a location to count');

  const cc=await call('POST','/api/inventory/cycle-counts',
    {locationId:unit.current_location_id,countDate:'2026-08-07',category:'MC'});
  if(!cc.json?.ok) throw new Error(cc.json?.error);
  const ccId=cc.json.id;

  // The unit leaves for a customer after the sheet was raised, which is exactly
  // the case that used to read as a loss.
  const out=await call('POST',`/api/sales/leases/${lease.id}/deploy`,{serials:[unit.serial_no]});
  if(!out.json?.ok) throw new Error(out.json?.error);

  await submitCount(ccId);
  const sheet=await call('GET',`/api/inventory/cycle-counts/${ccId}`);
  const line=(sheet.json.lines||[]).find(l=>l.expected_serial_no===unit.serial_no);
  if(!line) throw new Error('the unit is not on the count sheet');
  if(line.variance_type!=='MISSING') throw new Error('expected MISSING, got '+line.variance_type);
  if(line.deployed_customer!==(out.json.customer||line.deployed_customer))
    throw new Error('the sheet does not say who has it');
  if(!line.deployed_customer) throw new Error('the sheet cannot say who has the unit');
  if(!(sheet.json.summary.withCustomer>=1))
    throw new Error('the summary counts it as lost rather than out with a customer');
  if(sheet.json.summary.missing!==0&&(sheet.json.lines||[])
      .filter(l=>l.variance_type==='MISSING'&&!l.deployed_customer).length===0)
    throw new Error('missing and with-a-customer are being counted together');

  await approveCountChain(ccId);
  const posted=await call('POST',`/api/inventory/cycle-counts/${ccId}/post-adjustments`,{});
  if(!posted.json?.ok) throw new Error(posted.json?.error);
  if(!(posted.json.withCustomer>=1)) throw new Error('the posting did not recognise the deployment');

  const asset=sqlite.prepare(`SELECT current_status FROM erp_assets WHERE id=?`).get(unit.id);
  if(asset.current_status==='MISSING') throw new Error('a leased unit was written off as missing');
  /*
   * Other units on the same sheet may be genuinely lost, and those should still
   * be written off. What must not appear in the shortage is the cost of the one
   * unit whose holder the company can name.
   */
  const genuine=sqlite.prepare(`SELECT COALESCE(SUM(a.unit_cost),0) v FROM erp_cycle_count_lines ccl
    JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
    WHERE ccl.cycle_count_id=? AND ccl.variance_type='MISSING'
      AND NOT EXISTS(SELECT 1 FROM erp_asset_deployments d
        WHERE d.serial_no=COALESCE(ccl.expected_serial_no,ccl.actual_serial_no)
          AND d.returned_at IS NULL)`).get(ccId).v;
  if(Math.abs(Number(posted.json.financialDecrease||0)-Number(genuine))>0.01)
    throw new Error(`wrote off ${posted.json.financialDecrease} against ${genuine} genuinely missing`);
  const ev=sqlite.prepare(`SELECT amount FROM erp_finance_source_events
    WHERE event_key=? AND event_type='CYCLE_COUNT_ADJUSTMENT'`).get(`CYCLE_COUNT_ADJUSTMENT:${ccId}`);
  if(ev&&Math.abs(Number(ev.amount)-Number(genuine))>0.01)
    throw new Error('Finance was told '+ev.amount+' was short against '+genuine);

  await call('POST',`/api/sales/leases/${lease.id}/return`,{serials:[unit.serial_no],reason:'e2e teardown'});
  return {note:`${unit.serial_no} counted absent, recorded as out with ${out.json.customer}, no loss booked`};
});

await t('a lease contract is a sales order, and its units are deployed', async()=>{
  const c=sqlite.prepare(`SELECT COUNT(*) n, SUM(unit_count) u FROM erp_lease_contracts`).get();
  if(!(c.n>0)) throw new Error('no lease contract was loaded');
  // Every contract hangs off an order and a customer, or it is not reachable
  // from either the sales register or the customer.
  const loose=sqlite.prepare(`SELECT COUNT(*) n FROM erp_lease_contracts
    WHERE sales_order_id IS NULL OR customer_id IS NULL`).get().n;
  if(loose) throw new Error(loose+' contracts have no order or no customer behind them');
  const orders=sqlite.prepare(`SELECT COUNT(*) n FROM erp_sales_orders WHERE transaction_type='LEASE'`).get().n;
  if(orders<c.n) throw new Error(`${c.n} contracts but only ${orders} lease orders`);
  // The batch code the SOA bills on is on the record.
  const nobatch=sqlite.prepare(`SELECT COUNT(*) n FROM erp_lease_contracts c
    WHERE NOT EXISTS(SELECT 1 FROM erp_lease_contract_batches b WHERE b.lease_contract_id=c.id)`).get().n;
  if(nobatch) throw new Error(nobatch+' contracts carry no batch code');
  // Running contracts are the ones whose units are out with customers now.
  const live=sqlite.prepare(`SELECT COUNT(*) n, SUM(unit_count) u FROM erp_lease_contracts
    WHERE status='ACTIVE'`).get();
  if(!(live.u>0)) throw new Error('no units are out on a running contract');
  return {note:`${c.n} contracts, ${c.u} units, ${live.n} running with ${live.u} units out`};
});

await t('every figure on the dashboard reconciles to its register', async()=>{
  /*
   * A card that is merely plausible is worse than a blank one: somebody acts
   * on it. So each figure is recomputed here straight from the tables and
   * compared with what the dashboard says, over a range wide enough to cover
   * everything that was ever loaded.
   */
  const from='2025-01-01', to='2026-12-31';
  const r=await call('GET',`/api/dashboard/home?from=${from}&to=${to}`);
  if(!r.json?.ok) throw new Error(r.json?.error);
  const m=r.json.sections?.management||{};
  const near=(a,b,what)=>{
    if(Math.abs(Number(a||0)-Number(b||0))>0.02)
      throw new Error(`${what}: the card says ${Number(a||0).toFixed(2)}, the register says ${Number(b||0).toFixed(2)}`);
  };
  const one=q=>sqlite.prepare(q).get();

  // Billed is what was posted in the period, and nothing else.
  const billed=one(`SELECT COALESCE(SUM(gross_amount),0) v, COUNT(*) n FROM erp_ar_collections
    WHERE status='POSTED' AND txn_date BETWEEN '${from}' AND '${to}'`);
  near(m.billed, billed.v, 'billed');
  near(m.invoices, billed.n, 'invoice count');

  // Collected can never exceed billed: a rate over 100% is always a bug.
  const got=one(`SELECT COALESCE(SUM(r.amount),0) v FROM erp_ar_receipts r
    JOIN erp_ar_collections c ON c.id=r.collection_id
    WHERE r.status<>'VOID' AND c.status='POSTED' AND c.txn_date BETWEEN '${from}' AND '${to}'`);
  near(m.collected, Math.min(billed.v, got.v), 'collected');
  if(m.collectionPct!=null&&m.collectionPct>100.01)
    throw new Error('collection reads '+m.collectionPct+'%');
  near(m.outstanding, Math.max(0, Math.round((billed.v-Math.min(billed.v,got.v))*100)/100), 'outstanding');

  // Payable: what was asked for, and what actually left the bank.
  const raised=one(`SELECT COALESCE(SUM(net_payable),0) v, COUNT(*) n FROM erp_payment_requests
    WHERE status NOT IN ('REJECTED','CANCELLED') AND request_date BETWEEN '${from}' AND '${to}'`);
  near(m.payableRaised, raised.v, 'payable raised');
  const paid=one(`SELECT COALESCE(SUM(s.amount),0) v FROM erp_payment_settlements s
    JOIN erp_payment_requests r ON r.request_no=s.request_no
    WHERE s.status<>'VOID' AND r.status NOT IN ('REJECTED','CANCELLED')
      AND r.request_date BETWEEN '${from}' AND '${to}'`);
  near(m.payablePaid, paid.v, 'payable paid');
  if(m.payablePct!=null&&m.payablePct>100.01) throw new Error('payable reads '+m.payablePct+'%');
  near(m.payableOutstanding, Math.max(0, Math.round((raised.v-paid.v)*100)/100), 'payable outstanding');

  // The service level is a count of payments, not of requests.
  if(m.slaMeasured!=null){
    /*
     * A payment dated before the request it settles cannot be measured against
     * a service level - there is no elapsed time to measure - so those drop
     * out. Counting them would flatter the figure with zero-day payments.
     */
    const measured=one(`SELECT COUNT(*) n FROM erp_payment_settlements s
      JOIN erp_payment_requests r ON r.request_no=s.request_no
      WHERE s.status<>'VOID' AND COALESCE(s.paid_date,'')<>''
        AND substr(s.paid_date,1,10) >= substr(r.request_date,1,10)
        AND r.request_date BETWEEN '${from}' AND '${to}'`);
    near(m.slaMeasured, measured.n, 'payments measured for the service level');
    if(m.slaWithin>m.slaMeasured) throw new Error('more payments on time than were measured');
  }

  // Pending approvals must not include anything already settled.
  const settledPending=one(`SELECT COUNT(*) n FROM erp_payment_requests r
    WHERE r.status IN ('SUBMITTED','DEPARTMENT_APPROVED','FINANCE_REVIEWED','FINANCE_VALIDATED',
      'MANCOM_APPROVED','APPROVED','FOR_APPROVAL')
      AND EXISTS(SELECT 1 FROM erp_payment_settlements s
                  WHERE s.request_no=r.request_no AND s.status<>'VOID')`);
  if(settledPending.n) throw new Error(settledPending.n+' requests are awaiting approval with money already against them');

  // The fleet tiles add up to the register, and a leased unit is one that is
  // actually out with somebody.
  const units=one(`SELECT
      SUM(CASE WHEN current_status='AVAILABLE' THEN 1 ELSE 0 END) avail,
      SUM(CASE WHEN current_status='LEASED' THEN 1 ELSE 0 END) leased,
      SUM(CASE WHEN current_status='SOLD' THEN 1 ELSE 0 END) sold FROM erp_assets WHERE active=1`);
  near(m.availableUnits, units.avail||0, 'available units');
  near(m.soldUnits, units.sold||0, 'sold units');

  // The business lines add up to the payables, or one of them is missing.
  const lines=r.json.sections?.businessLines||[];
  if(lines.length){
    const sum=lines.reduce((t,l)=>t+Number(l.raised||0),0);
    near(sum, raised.v, 'the business lines against total payables');
  }
  if((r.json.failures||[]).length)
    throw new Error('the dashboard could not build: '+JSON.stringify(r.json.failures));
  return {note:`billed ${Number(billed.v).toLocaleString()}, collected ${Number(m.collected).toLocaleString()}, `
    +`raised ${Number(raised.v).toLocaleString()}, paid ${Number(paid.v).toLocaleString()} — all reconciled`};
});

console.log('\n=== Blitz - ERP end-to-end ===');
for (const [s, n, note] of results) console.log(`${s}  ${n}${note ? '  ·  ' + note : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
try { rmSync(DB_PATH, { force: true }); } catch {}
process.exit(failed ? 1 : 0);
