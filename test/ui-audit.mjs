/*
 * TEMPORARY UI audit harness. Finds rendering defects across module screens.
 *   node test/__ui_audit.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { WORKSPACE_GROUPS, WORKSPACE_TOOLS, WORKSPACE_ADDONS, WORKSPACE_MODULES } from '../src/lib/workspace.js';
import { definitionFor } from '../src/lib/module-definitions.js';

const SHOTS = fileURLToPath(new URL('./__screens__/audit/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };

const SESSION = { ok:true,
  user:{ email:'mmungcal@nrdev.ph', displayName:'Mark Alexis Mungcal', preferredName:'Alexis',
    role:'FINANCE', scope:'OPERATIONS', canUseAdminScope:1 },
  workspaceAccess: WORKSPACE_MODULES.map(m=>m.code),
  workspaceCatalog:{ groups:WORKSPACE_GROUPS, tools:WORKSPACE_TOOLS, addons:WORKSPACE_ADDONS } };

/* ---------------------------------------------------- generic module data */
function defOf(code){
  const m = WORKSPACE_MODULES.find(x=>x.code===code);
  if(!m) return null;
  try{ return definitionFor(m); }catch{ return null; }
}
function submodulesOf(d){
  return (d.recordTypes||[]).map((rt,i)=>({
    submodule_code:String(rt).toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    submodule_name:rt, sequence_no:(i+1)*10, record_type:rt,
    connected_module_code:'', posting_event_type:'' }));
}
const AMTS = [1250000.5, 87450, 0, 340900.75, 12500];
function recordsFor(code, n=5){
  const d = defOf(code); if(!d) return [];
  const rows=[];
  for(let i=0;i<n;i++){
    const payload={};
    (d.fields||[]).forEach((f,fi)=>{
      if(f.type==='number') payload[f.key]= [412, 18400000, 3.5, 0, 97][ (fi+i)%5 ];
      else if(f.type==='date') payload[f.key]='2026-0'+((i%9)+1)+'-14';
      else if(f.type==='month') payload[f.key]='2026-0'+((i%9)+1);
      else if(f.type==='select') payload[f.key]=(f.options&&f.options[i%(f.options.length||1)])||'';
      else if(f.type==='checkbox') payload[f.key]= i%2===0;
      else payload[f.key]= f.label.toUpperCase().replace(/[^A-Z ]/g,'')+' '+(1000+i);
    });
    rows.push({ id:i+1, record_no:`${d.prefix}-${String(i+1).padStart(8,'0')}`,
      record_type:d.recordTypes[i%d.recordTypes.length],
      transaction_date:'2026-0'+((i%9)+1)+'-1'+(i%9),
      description:'Connected operational document number '+(i+1)+' for '+d.plural,
      entity_name:'E88 VENTURES CORPORATION', department:'FINANCE',
      amount:AMTS[i%AMTS.length], status:d.workflow.stages[i%d.workflow.stages.length],
      owner_email:'mmungcal@nrdev.ph', updated_at:'2026-08-0'+((i%8)+1)+' 09:1'+i+':00',
      business_channel:['B2B','B2C','B2B2C'][i%3], payload });
  }
  return rows;
}
function summaryFor(code){
  const d = defOf(code); if(!d) return { ok:true };
  const recent = recordsFor(code,5);
  const statusCounts = d.workflow.stages.map((s,i)=>({ status:s, count:[12,7,5,3,0,0][i]||0 }));
  const typeCounts = d.recordTypes.map((t,i)=>({ record_type:t, count:[9,6,4,2,1][i]||1 }));
  return { ok:true, module:WORKSPACE_MODULES.find(m=>m.code===code),
    definition:{ ...d, submodules:submodulesOf(d) }, statusCounts, typeCounts,
    counts:{ total:27, drafts:12, pending:7, completed:8, b2b:14, b2c:9, b2b2c:4 }, recent };
}

/* ------------------------------------------------------- domain fixtures */
const JOURNALS = { ok:true, rows:[
  { id:1, journal_no:'JV-2026-000001', journal_date:'2026-03-04', journal_type:'SALES', source_type:'RECEIVABLES',
    description:'March lease billing - JAMO BUSINESS SOLUTIONS', total_debit:121706.59, total_credit:121706.59,
    entity_code:'E88', status:'POSTED' },
  { id:2, journal_no:'JV-2026-000002', journal_date:'2026-03-11', journal_type:'PURCHASE', source_type:'PAYABLES',
    description:'Ampace cells - landed cost allocation', total_debit:410000, total_credit:410000,
    entity_code:'E88', status:'FOR_APPROVAL' },
  { id:3, journal_no:'JV-2026-000003', journal_date:'2026-03-20', journal_type:'CASH', source_type:'TREASURY',
    description:'Collection deposit BDO', total_debit:40000, total_credit:40000, entity_code:'E88', status:'DRAFT' },
]};
const FIN_DASH = { ok:true, filters:{ entity:'E88', dateFrom:'2026-01-01', dateTo:'2026-08-08' },
  balances:{ cash:4820100.25, receivables:1876540.4, payables:990233.17, revenue:12450900.8, expenses:8120400.35, profit:4330500.45 },
  activity:[{ period:'2026-01', revenue:2100000, expenses:1400000 },{ period:'2026-02', revenue:2400000, expenses:1600000 },
    { period:'2026-03', revenue:3100000, expenses:2000000 }],
  worklist:{ submitted:7, approved:4, drafts:12 },
  events:{ captured:31, prepared:22, errors:2, no_effect:5 },
  bank:{ statement_balance:4711200.1, unmatched:3 },
  inventory:{ gl_balance:18400000, inventory_value:18250000, variance:150000 },
  overdue:{ amount:412300.55, documents:6 } };
const AGING = { ok:true, totals:{ total:990233.17, current:400000, d30:250000, d60:200000, d90:140233.17 }, rows:[
  { id:1, document_no:'AP-0001', partner_name:'Yunku Industrial', document_date:'2026-05-02', due_date:'2026-06-01',
    open_balance:250000, bucket:'31-60', currency:'PHP', status:'POSTED' },
  { id:2, document_no:'AP-0002', partner_name:'Ampace Cells', document_date:'2026-06-15', due_date:'2026-09-15',
    open_balance:400000, bucket:'CURRENT', currency:'PHP', status:'POSTED' },
]};
const RFP = { ok:true, rows:[
  { id:1, rfp_no:'RFP-2026-00001', payee_name:'Yunku Industrial', request_date:'2026-07-01', due_date:'2026-07-15',
    gross_amount:250000, ewt_amount:5000, net_payable:245000, status:'FOR_APPROVAL', currency:'PHP' },
  { id:2, rfp_no:'RFP-2026-00002', payee_name:'Ampace Cells', request_date:'2026-07-08', due_date:'2026-07-30',
    gross_amount:410000, ewt_amount:8200, net_payable:401800, status:'PAID', currency:'PHP' },
]};
const AR_ROWS = [
  { id:1, entry_no:'AR-2026-00001', stream:'MC_LEASED', txn_date:'2026-03-04', customer_name:'JAMO BUSINESS SOLUTIONS',
    document_no:'OR-1001', description:'March lease billing', gross_amount:121706.59, net_amount:108666.6,
    output_vat:13039.99, collected:40000, balance:81706.59, payment_method:'Bank Transfer',
    cleared_status:'CLEARED', status:'POSTED' },
  { id:2, entry_no:'AR-2026-00002', stream:'MC_SOLD', txn_date:'2026-03-08', customer_name:'ANGKAS RIDERS INC',
    document_no:'SI-2201', description:'Two units D400', gross_amount:250000, net_amount:223214.29,
    output_vat:26785.71, collected:0, balance:250000, payment_method:'GCash',
    cleared_status:'PENDING', status:'DRAFT' },
];
const AR_TOTALS = { n:2, gross:371706.59, net:331880.89, vat:39825.7, posted:121706.59, draft:250000, cleared:121706.59 };

/* Shapes copied from the real routes so screens are not artificially degraded. */
const PNL = { revenue:12450900.8, cogs:6120300.4, grossProfit:6330600.4,
  operatingExpenses:2000100.1, netIncome:4330500.3 };
const BS = { assets:24800100.5, liabilities:9902330.2, equity:10567270, currentYearEarnings:4330500.3,
  totalLiabilitiesEquity:24800100.5, difference:0, balanced:true };
const FIN_STATEMENTS = { ok:true, filters:{ entity:'E88' },
  accounts:[{ account_code:'4100', account_name:'Lease Revenue', account_type:'REVENUE',
    financial_statement:'PNL', normal_balance:'CREDIT', balance:12450900.8 },
    { account_code:'5100', account_name:'Cost of Units Sold', account_type:'COGS',
      financial_statement:'PNL', normal_balance:'DEBIT', balance:6120300.4 }],
  balanceAccounts:[{ account_code:'1010', account_name:'Cash in Bank - BDO', account_type:'ASSET',
    financial_statement:'BS', normal_balance:'DEBIT', balance:4820100.25 },
    { account_code:'2010', account_name:'Trade Payables', account_type:'LIABILITY',
      financial_statement:'BS', normal_balance:'CREDIT', balance:9902330.2 }],
  pnl:PNL, balanceSheet:BS,
  cashFlow:[{ cash_flow_group:'OPERATING', net_change:3100200.5 },
    { cash_flow_group:'INVESTING', net_change:-810400.25 }] };
const ACCOUNTS = { ok:true, rows:[
  { id:1, account_code:'1010', account_name:'Cash in Bank - BDO', account_type:'ASSET', control_type:'BANK',
    normal_balance:'DEBIT', financial_statement:'BS', cash_flow_group:'OPERATING', active:1 },
  { id:2, account_code:'1200', account_name:'Trade Receivables', account_type:'ASSET', control_type:'AR',
    normal_balance:'DEBIT', financial_statement:'BS', cash_flow_group:'OPERATING', active:1 },
  { id:3, account_code:'4100', account_name:'Lease Revenue', account_type:'REVENUE', control_type:'',
    normal_balance:'CREDIT', financial_statement:'PNL', cash_flow_group:'OPERATING', active:1 },
]};
const BAL_ROWS = ACCOUNTS.rows.map((a,i)=>({ ...a, debit:[4820100.25,1876540.4,0][i],
  credit:[0,0,12450900.8][i], balance:[4820100.25,1876540.4,-12450900.8][i], entries:[12,9,31][i] }));
const BALANCES = { ok:true, filters:{ entity:'E88' }, rows:BAL_ROWS,
  totals:{ debit:6696640.65, credit:12450900.8, entries:52 },
  byType:[{ label:'ASSET', value:6696640.65 },{ label:'REVENUE', value:12450900.8 }], balanced:false };
const TRIAL = { ok:true, filters:{ entity:'E88' }, rows:BAL_ROWS,
  totals:{ debit:12450900.8, credit:12450900.8 }, balanced:true };
const GL = { ok:true, filters:{ entity:'E88' }, rows:[
  { journal_no:'JV-2026-000001', journal_date:'2026-03-04', account_code:'1200', account_name:'Trade Receivables',
    description:'March lease billing', base_debit:121706.59, base_credit:0, department:'FINANCE',
    cost_center:'SALES', business_line:'MC_LEASE', source_type:'RECEIVABLES', status:'POSTED' },
  { journal_no:'JV-2026-000001', journal_date:'2026-03-04', account_code:'4100', account_name:'Lease Revenue',
    description:'March lease billing', base_debit:0, base_credit:108666.6, department:'FINANCE',
    cost_center:'SALES', business_line:'MC_LEASE', source_type:'RECEIVABLES', status:'POSTED' },
]};
const TAX = { ok:true, filters:{ entity:'E88' }, rows:[
  { tax_code:'VAT-OUT', tax_name:'Output VAT 12%', rate:12, taxable_amount:1086666, tax_amount:130399.92, documents:14 },
  { tax_code:'EWT-2', tax_name:'Expanded Withholding 2%', rate:2, taxable_amount:660000, tax_amount:13200, documents:6 },
]};
const BUDGET = { ok:true, year:new Date().getFullYear(), rows:[
  { department:'FINANCE', cost_center:'SHARED', account_title:'Professional Fees',
    budget_amount:1200000, actual_amount:930400.55, variance:269599.45, utilizationPct:77.53 },
  { department:'RIDEBOX', cost_center:'STATIONS', account_title:'Rent and Utilities',
    budget_amount:2400000, actual_amount:2610900.1, variance:-210900.1, utilizationPct:108.79 },
]};
const PERIODS = { ok:true, entity:'E88', year:2026, rows:[
  { id:1, period_code:'2026-01', start_date:'2026-01-01', end_date:'2026-01-31', status:'CLOSED', entity_code:'E88' },
  { id:2, period_code:'2026-08', start_date:'2026-08-01', end_date:'2026-08-31', status:'OPEN', entity_code:'E88' },
]};
const MASTER = { ok:true,
  entities:[{ id:1, entity_code:'E88', entity_name:'E88 Ventures', currency:'PHP' }],
  accounts:ACCOUNTS.rows, periods:PERIODS.rows,
  taxCodes:[{ id:1, tax_code:'VAT-OUT', tax_name:'Output VAT', rate:12 }],
  partners:[{ id:1, partner_code:'CUS-000001', name:'JAMO BUSINESS SOLUTIONS', partner_type:'CUSTOMER' }],
  bankAccounts:[{ id:1, bank_account_code:'BDO-01', bank_name:'BDO', account_name:'E88 Operating' }] };
const BANK_ACCOUNTS = { ok:true, rows:[
  { id:1, bank_account_code:'BDO-01', bank_name:'BDO', account_name:'E88 Operating',
    account_number_masked:'****1234', currency:'PHP', opening_balance:1000000, entity_code:'E88',
    account_code:'1010', account_name:'Cash in Bank - BDO',
    statement_balance:4711200.1, unmatched:1, active:1 },
]};
const BANK_TXNS = { ok:true, rows:[
  { id:1, bank_account_id:1, bank_account_code:'BDO-01', bank_name:'BDO', account_name:'E88 Operating',
    transaction_date:'2026-03-20', direction:'CREDIT', amount:40000, reference:'BDO-77123',
    description:'Collection deposit', status:'MATCHED', journal_no:'JV-2026-000003', account_code:'1010' },
  { id:2, bank_account_id:1, bank_account_code:'BDO-01', bank_name:'BDO', account_name:'E88 Operating',
    transaction_date:'2026-03-25', direction:'DEBIT', amount:250000, reference:'CHK-0091',
    description:'Vendor payment', status:'UNMATCHED', journal_no:null, account_code:null },
]};
const BANK_RECS = { ok:true, rows:[
  { id:1, reconciliation_no:'BR-2026-0001', bank_account_code:'BDO-01', bank_name:'BDO',
    statement_date:'2026-03-31', statement_ending_balance:4711200.1, book_ending_balance:4820100.25,
    outstanding_deposits:0, outstanding_payments:0, adjustments:0,
    difference:108900.15, status:'SUBMITTED', prepared_by:'mmungcal@nrdev.ph' },
]};
const FIXED_ASSETS = { ok:true,
  rows:[{ id:1, asset_code:'FA-000001', asset_name:'RideBox Station 4', category:'BSS', serial_no:'S-1',
    acquisition_date:'2026-01-15', acquisition_cost:850000, useful_life_months:60,
    accumulated_depreciation:70833.33, net_book_value:779166.67, status:'ACTIVE', entity_code:'E88' }],
  candidates:[{ id:9, serial_no:'R5FBMX0B2RL000423', category:'MC', item_name:'D400 Motorcycle',
    unit_cost:180000, current_location_code:'WH-MAIN' }],
  runs:[{ id:1, run_no:'DEP-2026-03', period_code:'2026-03', assets:1, amount:14166.67, status:'POSTED' }] };
const SOURCE_EVENTS = { ok:true, rows:[
  { id:1, event_type:'GOODS_RECEIPT', entity_code:'E88', source_no:'SHP-0001', event_date:'2026-03-02',
    amount:850000, status:'JOURNAL_PREPARED', journal_no:'JV-2026-000002', message:'' },
  { id:2, event_type:'SALE_COGS', entity_code:'E88', source_no:'SO-000001', event_date:'2026-03-06',
    amount:180000, status:'ERROR', journal_no:null, message:'No cost on serial R5FBMX0B2RL000423' },
]};
const BUSINESS_LINES = { ok:true,
  lines:[{ line_code:'MC_LEASE', name:'Motorcycle lease', description:'Lease of units to riders', sort_order:1 },
    { line_code:'BSS', name:'RideBox battery swapping', description:'Station rent, lease and power', sort_order:2 },
    { line_code:'SHARED', name:'Shared services', description:'Overheads not attributable to a line', sort_order:3 }],
  rules:[{ id:1, line_code:'BSS', match_type:'PAYEE', match_value:'PHILPOWER CORPORATION', priority:1 },
    { id:2, line_code:'MC_LEASE', match_type:'ACCOUNT', match_value:'Lease Revenue', priority:1 }],
  hosts:[{ payee_key:'PHILPOWER CORPORATION', payee_name:'PHILPOWER CORPORATION', requests:12,
    amount:1840500.25, average:153375.02, department:'RIDEBOX', chosen:true },
    { payee_key:'JAMO BUSINESS SOLUTIONS', payee_name:'JAMO BUSINESS SOLUTIONS', requests:4,
      amount:320000, average:80000, department:'OPERATIONS', chosen:false }],
  canEdit:true };
const INV_VISIBILITY = { ok:true, page:1, size:50, total:2,
  rows:[{ id:1, serial_no:'R5FBMX0B2RL000423', item_code:'MC-D400', item_name:'D400 Motorcycle',
    kpi_category:'MC', current_status:'AVAILABLE', current_location_code:'WH-MAIN',
    current_location_name:'Main Warehouse', reconciliation_status:'RECONCILED', unit_cost:180000,
    current_holder_name:'', updated_at:'2026-08-01 10:00:00' },
    { id:2, serial_no:'B-1', item_code:'BAT-72V', item_name:'72V Battery', kpi_category:'BAT',
      current_status:'LEASED', current_location_code:'RB-QC1', current_location_name:'RideBox QC 1',
      reconciliation_status:'UNRECONCILED', unit_cost:0, current_holder_name:'ANGKAS RIDERS INC',
      updated_at:'2026-08-02 11:00:00' }],
  byLocation:[{ location_id:1, location_code:'WH-MAIN', location_name:'Main Warehouse', location_type:'WAREHOUSE',
      total_units:412, available_units:300, quarantine_units:12, unreconciled_units:4 },
    { location_id:2, location_code:'RB-QC1', location_name:'RideBox QC 1', location_type:'STATION',
      total_units:97, available_units:60, quarantine_units:0, unreconciled_units:2 }],
  summary:{ total_units:509, available_units:360, quarantine_units:12, deployed_units:97,
    unvalued_units:3, unreconciled_units:6, inventory_value:20800000 } };
const INV_BY_CLASS = { ok:true, totalItems:2,
  rows:[{ cls:'D400', class_name:'D400 Motorcycles', item_count:1, total:412, available:300, leased:97,
      sold:15, deployed:97, quarantine:12, unvalued:3, inventory_value:18400000 },
    { cls:'BAT', class_name:'Batteries', item_count:1, total:97, available:60, leased:37, sold:0,
      deployed:37, quarantine:0, unvalued:0, inventory_value:2400000 },
    { cls:'SP', class_name:'Spare Parts', item_count:1, total:0, available:0, leased:0, sold:4,
      deployed:0, quarantine:0, unvalued:0, inventory_value:0 }],
  items:[{ class_code:'D400', class_name:'D400 Motorcycles', item_id:1, item_code:'MC-D400',
      item_name:'D400 Motorcycle', total:412, available:300, leased:97, sold:15, deployed:97,
      quarantine:12, unvalued:3, inventory_value:18400000 },
    { class_code:'BAT', class_name:'Batteries', item_id:2, item_code:'BAT-72V', item_name:'72V Battery',
      total:97, available:60, leased:37, sold:0, deployed:37, quarantine:0, unvalued:0,
      inventory_value:2400000 }] };
const INV_ANALYSIS = { ok:true,
  rows:[{ item_id:1, item_code:'MC-D400', item_name:'D400 Motorcycle Complete Unit Assembly', category:'D400',
      standard_cost:180000, on_hand_qty:412, available_qty:300, quarantine_qty:12, deployed_qty:97,
      unvalued_qty:3, leased_qty:97, sold_qty:15, inventory_value:18400000, primary_location:'WH-MAIN',
      incoming_qty:40, open_po_qty:20 },
    { item_id:2, item_code:'BAT-72V', item_name:'72V Lithium Battery Pack', category:'BAT',
      standard_cost:24000, on_hand_qty:97, available_qty:60, quarantine_qty:0, deployed_qty:37,
      unvalued_qty:0, leased_qty:37, sold_qty:0, inventory_value:2400000, primary_location:'RB-QC1',
      incoming_qty:0, open_po_qty:0 },
    { item_id:3, item_code:'SP-BRK-001', item_name:'Brake Pad Set', category:'SP',
      standard_cost:850, on_hand_qty:0, available_qty:0, quarantine_qty:0, deployed_qty:0,
      unvalued_qty:0, leased_qty:0, sold_qty:4, inventory_value:0, primary_location:'WH-MAIN',
      incoming_qty:120, open_po_qty:200 }],
  byStatus:[{ status:'AVAILABLE', qty:360 },{ status:'LEASED', qty:134 }],
  totals:{ items:3, units:509, value:20800000 } };
const STATEMENTS = { ok:true,
  rows:[{ id:1, statement_no:'SOA-2026-00001', period_month:'2026-03', customer_name:'JAMO BUSINESS SOLUTIONS',
    opening_balance:6000, billed_amount:121706.59, collected_amount:40000, closing_balance:87706.59, status:'DRAFT' }],
  months:[{ label:'2026-03' },{ label:'2026-02' }],
  customers:[{ label:'JAMO BUSINESS SOLUTIONS', n:4 }] };

const unmocked = new Set();
const server = createServer(async (req,res)=>{
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')){
    res.setHeader('content-type','application/json');
    const p = path.slice(4);
    const J = o => res.end(JSON.stringify(o));
    if (p === '/session') return J(SESSION);
    let m;
    if ((m = p.match(/^\/workspace\/modules\/([a-z0-9-]+)\/definition$/))){
      const d = defOf(m[1]);
      return J({ ok:true, definition: d ? { ...d, submodules:submodulesOf(d) } : null });
    }
    if ((m = p.match(/^\/workspace\/modules\/([a-z0-9-]+)\/summary$/))) return J(summaryFor(m[1]));
    if ((m = p.match(/^\/workspace\/modules\/([a-z0-9-]+)\/records$/)))
      return J({ ok:true, rows:recordsFor(m[1]), total:5 });
    if ((m = p.match(/^\/workspace\/modules\/([a-z0-9-]+)\/records\/(\d+)$/))){
      const d = defOf(m[1]); const rows = recordsFor(m[1]);
      return J({ ok:true, record:rows[Number(m[2])-1]||rows[0], documents:[],
        definition: d?{...d, submodules:submodulesOf(d)}:null, connected:{} });
    }
    if (p.startsWith('/workspace/modules/') && p.endsWith('/change-requests')) return J({ ok:true, rows:[] });
    if (p === '/finance/dashboard') return J(FIN_DASH);
    if (p === '/finance/journals') return J(JOURNALS);
    if (p.startsWith('/finance/aging/')) return J(AGING);
    if (p === '/finance/payment-requests') return J(RFP);
    if (p === '/receivables/collections')
      return J({ ok:true, rows:AR_ROWS, page:1, size:50, total:2, totals:AR_TOTALS,
        byStream:[{label:'MC_LEASED',value:121706.59},{label:'MC_SOLD',value:250000}], byMethod:[],
        streams:{ MC_SOLD:'Motorcycle sold', MC_LEASED:'Motorcycle leased' } });
    if (p === '/receivables/summary')
      return J({ ok:true, totals:AR_TOTALS, byStream:[{label:'MC_LEASED',value:121706.59}],
        byMonth:[{label:'2026-03',value:371706.59}], byCustomer:[{label:'JAMO BUSINESS SOLUTIONS',value:121706.59}],
        billed:121706.59, billedCount:1, collected:40000, outstanding:81706.59,
        collectionPct:32.86, receivablesPct:67.14 });
    if (p === '/receivables/lists')
      return J({ ok:true, lists:{ SALES_TYPE:['Leased','Sold'], PAYMENT_METHOD:['Cash','Bank Transfer','GCash'],
        BANK:['BDO'], VAT_TYPE:['VATable'], ACCOUNT_TITLE:['Cash in Bank - BDO'], COST_CENTER:['Sales'] },
        streams:{ MC_SOLD:'Motorcycle sold', MC_LEASED:'Motorcycle leased' },
        customers:[{ id:1, partner_code:'CUS-000001', name:'JAMO BUSINESS SOLUTIONS' }] });
    if (p === '/finance/reports/financial-statements') return J(FIN_STATEMENTS);
    if (p === '/finance/reports/budget-actual') return J(BUDGET);
    if (p === '/finance/reports/trial-balance') return J(TRIAL);
    if (p === '/finance/reports/general-ledger') return J(GL);
    if (p === '/finance/reports/tax-summary') return J(TAX);
    if (p === '/finance/accounts/balances') return J(BALANCES);
    if (p === '/finance/accounts') return J(ACCOUNTS);
    if (p === '/finance/periods') return J(PERIODS);
    if (p === '/finance/master-data') return J(MASTER);
    if (p === '/finance/bank-accounts') return J(BANK_ACCOUNTS);
    if (p === '/finance/bank-transactions') return J(BANK_TXNS);
    if (p === '/finance/bank-reconciliations') return J(BANK_RECS);
    if (p === '/finance/fixed-assets') return J(FIXED_ASSETS);
    if (p === '/finance/source-events') return J(SOURCE_EVENTS);
    if (p === '/finance/business-lines') return J(BUSINESS_LINES);
    if (p === '/inventory/visibility') return J(INV_VISIBILITY);
    if (p === '/inventory/analysis') return J(INV_ANALYSIS);
    if (p === '/inventory/by-class') return J(INV_BY_CLASS);
    if (p === '/receivables/statements') return J(STATEMENTS);
    if (p === '/dashboard/home')
      return J({ ok:true, user:{ name:'Alexis Mungcal', role:'FINANCE', email:'mmungcal@nrdev.ph' },
        sections:{}, waiting:[], activity:[], progress:{}, trends:{},
        period:{ from:'2026-08-01', to:'2026-08-31' } });
    unmocked.add(p.replace(/\d+/g,':n'));
    return J({ ok:true, rows:[], data:[], items:[], lines:[], total:0, summary:{},
      totals:{}, counts:{ total:0, completed:0 }, balances:{}, worklist:{}, events:{}, bank:{},
      inventory:{}, overdue:{}, statusCounts:[], typeCounts:[], recent:[], activity:[],
      locations:[], vendors:[], items2:[], assets:[], orders:[], customers:[], accounts:[],
      periods:[], plans:[], movements:[], shipments:[], requisitions:[], deliveries:[],
      journals:[], panels:[], lists:{}, streams:{}, config:{}, links:[] });
  }
  try{
    const name = path === '/' ? 'index.html' : path.slice(1);
    const file = await readFile(join(PUBLIC, name));
    res.setHeader('content-type', TYPES[extname(name)] || 'application/octet-stream');
    res.end(file);
  }catch{ res.statusCode = 404; res.end('not found'); }
});
await new Promise(r=>server.listen(0,r));
const base = `http://127.0.0.1:${server.address().port}`;

/* =========================================================== the audit ==== */
const AUDIT = () => {
  const out = [];
  const add = (kind, detail) => out.push({ kind, detail });
  const VW = window.innerWidth;
  const sel = el => {
    if (!el) return '?';
    if (el.id) return el.tagName.toLowerCase()+'#'+el.id;
    const cls = (el.className && typeof el.className === 'string')
      ? '.'+el.className.trim().split(/\s+/).slice(0,3).join('.') : '';
    let p = el.parentElement, chain = '';
    if (p && p.className && typeof p.className==='string')
      chain = p.tagName.toLowerCase()+'.'+p.className.trim().split(/\s+/)[0]+' > ';
    return chain + el.tagName.toLowerCase() + cls;
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const scrollableAncestor = el => {
    for (let p = el.parentElement; p; p = p.parentElement){
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return p;
    }
    return null;
  };

  /* ---- 1. literal broken text in rendered text nodes ---- */
  const PATTERNS = [
    ['TEXT-undefined', /\bundefined\b/],
    ['TEXT-NaN', /NaN/],
    ['TEXT-null', /(^|[^a-zA-Z])null([^a-zA-Z]|$)/],
    ['TEXT-InvalidDate', /Invalid Date/],
    ['TEXT-objectObject', /\[object Object\]/],
    ['TEXT-exponent', /\d[eE][+-]\d/],
  ];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      const t = n.parentElement && n.parentElement.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEMPLATE') return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }});
  const seenText = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()){
    const txt = n.nodeValue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    for (const [kind, re] of PATTERNS){
      if (re.test(txt)){
        const k = kind+'|'+sel(el)+'|'+txt.trim().slice(0,60);
        if (seenText.has(k)) continue; seenText.add(k);
        add(kind, sel(el)+' :: "'+txt.trim().replace(/\s+/g,' ').slice(0,120)+'"');
      }
    }
    // empty currency: a peso/dollar sign with nothing numeric after it
    if (/(₱|\$)\s*$/.test(txt.trim()) && !/\d/.test(txt)){
      const own = (el.textContent||'').trim();
      if (/(₱|\$)\s*$/.test(own)){
        const k='TEXT-emptyCurrency|'+sel(el);
        if (!seenText.has(k)){ seenText.add(k); add('TEXT-emptyCurrency', sel(el)+' :: "'+own.slice(-20)+'"'); }
      }
    }
  }
  // input values that render broken text
  document.querySelectorAll('input,textarea').forEach(el=>{
    const v = el.value;
    if (!v || !visible(el)) return;
    if (/undefined|NaN|Invalid Date|\[object Object\]/.test(v))
      add('INPUT-brokenValue', sel(el)+' [name='+(el.name||'')+'] value="'+v.slice(0,60)+'"');
  });

  /* ---- 2. cards ---- */
  document.querySelectorAll('.workspace-card, .ramco-window, .ramco-detail-panel, figure.viz, article.workspace-kpi')
    .forEach(card=>{
      if (!visible(card) && card.offsetHeight === 0 && card.offsetWidth === 0) return;
      const h = card.offsetHeight;
      if (h < 24) { add('CARD-zeroHeight', sel(card)+' offsetHeight='+h); return; }
      const header = card.querySelector(':scope > header, :scope > figcaption');
      if (header){
        const bodyText = [...card.children].filter(c=>c!==header)
          .map(c=>(c.textContent||'').trim()).join('');
        const bodyEls = [...card.children].filter(c=>c!==header).length;
        if (!bodyText && bodyEls === 0) add('CARD-emptyBody', sel(card)+' header="'+(header.textContent||'').trim().replace(/\s+/g,' ').slice(0,60)+'" body has no children');
        else if (!bodyText && bodyEls > 0) add('CARD-emptyBody', sel(card)+' header="'+(header.textContent||'').trim().replace(/\s+/g,' ').slice(0,60)+'" body renders no text ('+bodyEls+' empty children)');
        const title = header.querySelector('h2,h3,b,.viz-title') || header;
        if (!(title.textContent||'').trim()) add('CARD-blankTitle', sel(card)+' header title is empty');
      }
      if (card.classList.contains('workspace-kpi')){
        const strong = card.querySelector('strong');
        const label = card.querySelector('span');
        if (strong && !(strong.textContent||'').trim())
          add('KPI-blankValue', sel(card)+' label="'+((label&&label.textContent)||'').trim()+'" value is empty');
        if (label && !(label.textContent||'').trim())
          add('KPI-blankLabel', sel(card)+' value="'+((strong&&strong.textContent)||'').trim()+'" label is empty');
      }
    });

  /* ---- 3. elements outside the viewport ---- */
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2)
    add('PAGE-sideScroll', 'document scrollWidth='+de.scrollWidth+' clientWidth='+de.clientWidth);
  const offenders = [];
  document.querySelectorAll('body *').forEach(el=>{
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const over = r.right > VW + 1;
    const under = r.left < -1;
    if (!over && !under) return;
    if (scrollableAncestor(el)) return;      // legitimately inside a scroller
    offenders.push({ el, r, over, under });
  });
  // keep only the outermost offender of each chain
  offenders.filter(o=>!offenders.some(p=>p.el!==o.el && p.el.contains(o.el))).forEach(o=>{
    add(o.over?'CLIP-rightOfViewport':'CLIP-leftOfViewport',
      sel(o.el)+' rect left='+Math.round(o.r.left)+' right='+Math.round(o.r.right)+' vw='+VW
      +' text="'+(o.el.textContent||'').trim().replace(/\s+/g,' ').slice(0,60)+'"');
  });

  /* ---- 4. visually clipped text ---- */
  const clipSeen = new Set();
  document.querySelectorAll('body *').forEach(el=>{
    if (!visible(el)) return;
    if (el.children.length > 2) return;                 // want text holders
    const t = (el.textContent||'').trim();
    if (!t) return;
    if (el.scrollWidth <= el.clientWidth + 2) return;
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    if (ox !== 'hidden' && ox !== 'visible') return;
    if (el.clientWidth === 0) return;
    const k = sel(el)+'|'+t.slice(0,30);
    if (clipSeen.has(k)) return; clipSeen.add(k);
    add('CLIP-textCut', sel(el)+' scrollW='+el.scrollWidth+' clientW='+el.clientWidth
      +' overflow='+ox+' ellipsis='+(cs.textOverflow||'-')+' text="'+t.replace(/\s+/g,' ').slice(0,60)+'"');
  });

  /* ---- 5. table header/body arity ---- */
  document.querySelectorAll('table').forEach((tb,i)=>{
    const heads = [...tb.querySelectorAll('thead th')];
    const firstRow = tb.querySelector('tbody tr');
    if (!heads.length || !firstRow) return;
    const headSpan = heads.reduce((s,th)=>s+(Number(th.colSpan)||1),0);
    const cells = [...firstRow.children];
    const cellSpan = cells.reduce((s,td)=>s+(Number(td.colSpan)||1),0);
    if (headSpan !== cellSpan)
      add('TABLE-arity', sel(tb)+' #'+i+' '+headSpan+' header cells vs '+cellSpan+' first-row cells'
        +' headers=['+heads.map(h=>(h.textContent||'').trim()).join(',').slice(0,120)+']'
        +' row=['+cells.map(c=>(c.textContent||'').trim()).join('|').slice(0,120)+']');
  });

  /* ---- 6. numeric cells not right-aligned ---- */
  const numRe = /^[\d,.\-()₱$ ]+$/;
  const colBad = new Map();
  document.querySelectorAll('table').forEach(tb=>{
    const heads = [...tb.querySelectorAll('thead th')].map(h=>(h.textContent||'').replace(/\s+/g,' ').trim());
    [...tb.querySelectorAll('tbody tr')].forEach(tr=>{
      [...tr.children].forEach((td,ci)=>{
        const t = (td.textContent||'').trim();
        if (!t || t === '-' || !numRe.test(t)) return;
        if (!/\d/.test(t)) return;
        if (t.length < 2) return;                       // single digit counts read fine either way
        const al = getComputedStyle(td).textAlign;
        if (al === 'right' || al === 'end') return;
        const key = sel(tb)+'|col'+ci+'|'+(heads[ci]||'?');
        const cur = colBad.get(key) || { n:0, sample:t, align:al };
        cur.n++; colBad.set(key, cur);
      });
    });
  });
  // Identifier columns (account codes, document numbers) are meant to be left
  // aligned; only quantity/amount columns count.
  const idCol = /^(code|account|no\.?|number|ref(erence)?|id|serial|step|cycle|year|period|month|matrix|from|to)$/i;
  colBad.forEach((v,k)=>{
    if (v.n < 2) return;                                 // one cell may be a label
    if (idCol.test(k.split('|').pop().trim())) return;
    add('TABLE-numNotRight', k+' :: '+v.n+' numeric cells align='+v.align+' e.g. "'+v.sample+'"');
  });

  /* ---- 7. mismatched sibling card heights in one grid row ---- */
  const gridSeen = new Set();
  document.querySelectorAll('.setup-grid, .workspace-kpis, .module-report-grid, .viz-grid, .connected-module-grid, .ramco-layout, .home-grid')
    .forEach(grid=>{
      const cs = getComputedStyle(grid);
      if (cs.display !== 'grid' && cs.display !== 'flex') return;
      const kids = [...grid.children].filter(k=>visible(k) && k.offsetHeight>0);
      const rows = new Map();
      kids.forEach(k=>{
        const top = Math.round(k.getBoundingClientRect().top/8)*8;
        if (!rows.has(top)) rows.set(top,[]);
        rows.get(top).push(k);
      });
      rows.forEach(list=>{
        for (let i=0;i<list.length-1;i++){
          const a=list[i], b=list[i+1];
          const ha=a.offsetHeight, hb=b.offsetHeight;
          const hi=Math.max(ha,hb), lo=Math.min(ha,hb);
          if (lo>0 && hi/lo >= 1.8 && hi-lo >= 120){
            const k = sel(grid)+'|'+sel(a)+'|'+sel(b);
            if (gridSeen.has(k)) continue; gridSeen.add(k);
            add('GRID-heightMismatch', sel(grid)+' row: '+sel(a)+' ('+ha+'px) beside '+sel(b)+' ('+hb+'px)'
              +' a="'+(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,40)+'"'
              +' b="'+(b.textContent||'').trim().replace(/\s+/g,' ').slice(0,40)+'"');
          }
        }
      });
    });

  return out;
};

/* ================================================================ driver == */
const SCREENS = [
  ['fa-general-accounting',      ['center','records','balances','reports','setup']],
  ['fa-receivables-payables',    ['center','approvals','reports','setup']],
  ['fa-receivables-management',  ['center','records','statements']],
  ['fa-fixed-assets',            ['center','records','reports']],
  ['fa-management-accounting',   ['center','reports']],
  ['fa-consolidation-reporting', ['center','reports']],
  ['fa-financial-services',      ['center','records']],
  ['fa-planning-budgeting',      ['center','records']],
  ['fa-grants-funds',            ['center','records','reports','setup']],
  ['ip-supplier-portal',         ['center']],
  ['ip-inbound-logistics',       ['center']],
  ['ip-warehouse-management',    ['center']],
  ['ip-cycle-counting',          ['center']],
  ['ip-sourcing-purchasing',     ['center']],
  ['ip-inventory-analysis',      ['center','records','reports']],
  ['sd-order-management',        ['center']],
  ['sd-outbound-logistics',      ['center']],
  ['sd-service-management',      ['center']],
  ['qm-inspection-sampling',     ['center']],
  ['lm-command-center',          ['center','records','reports','setup']],
  ['hcm-payroll-benefits',       ['center','records']],
  ['pm-billing',                 ['center','setup']],
  ['srp-timesheet',              ['center','records']],
  ['eam-work-management',        ['center']],
  ['fm-contracts',               ['center']],
  ['mf-costing',                 ['center']],
];
const WIDTHS = [1440, 1100];

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport:{ width:1440, height:960 } });
let jsErrors = [];
page.on('pageerror', e=>jsErrors.push('pageerror: '+String(e.message||e)));
page.on('console', m=>{ if (m.type()==='error') jsErrors.push('console: '+m.text().slice(0,200)); });

const defects = [];
const push = (screen,width,kind,detail)=>defects.push([screen,String(width),kind,detail]);
const clean = [];
const skipped = [];

async function measure(screen){
  const found = { };
  for (const width of WIDTHS){
    await page.setViewportSize({ width, height:960 });
    await page.waitForTimeout(280);
    let list = await page.evaluate(AUDIT);
    // re-measure geometry findings after a settle to kill false positives
    await page.waitForTimeout(220);
    const list2 = await page.evaluate(AUDIT);
    const geo = new Set(['CLIP-rightOfViewport','CLIP-leftOfViewport','CLIP-textCut','PAGE-sideScroll',
      'GRID-heightMismatch','CARD-zeroHeight']);
    const keys2 = new Set(list2.map(d=>d.kind+'|'+d.detail));
    list = list.filter(d=>!geo.has(d.kind) || keys2.has(d.kind+'|'+d.detail));
    for (const d of list) push(screen, width, d.kind, d.detail);
    found[width] = list.length;
    const safe = screen.replace(/[^a-z0-9]+/gi,'_');
    try{ await page.screenshot({ path:`${SHOTS}${safe}__${width}.png`, fullPage:true }); }catch{}
  }
  await page.setViewportSize({ width:1440, height:960 });
  return found;
}

async function boot(){
  jsErrors = [];
  await page.goto(base, { waitUntil:'networkidle' });
  await page.waitForSelector('.home-hello h1, #homeModules, [data-workspace]', { timeout:15000 });
}

/* ------------------------------------------------- optional focused probe */
if (process.env.PROBE){
  const [code, section] = process.env.PROBE.split(':');
  await boot();
  if (await page.locator('#homeModules').count()) await page.locator('#homeModules').click();
  await page.locator(`[data-workspace="${code}"]`).click();
  await page.waitForSelector('.erp-workbench', { timeout:12000 });
  if (section && section !== 'center'){
    await page.evaluate(s=>{const b=document.querySelector(`[data-workbench-section="${s}"]`)
      ||document.querySelector(`[data-section="${s}"]`); if(b)b.click();}, section);
    await page.waitForTimeout(1200);
  }
  for (const w of [1440,1100]){
    await page.setViewportSize({ width:w, height:960 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(()=>{
      const de=document.documentElement;
      const out={ doc:{ scrollW:de.scrollWidth, clientW:de.clientWidth }, widest:[], cards:[] };
      document.querySelectorAll('body *').forEach(el=>{
        const r=el.getBoundingClientRect();
        if (r.right > de.clientWidth+1)
          out.widest.push({ tag:el.tagName, cls:String(el.className||'').slice(0,60),
            id:el.id, left:Math.round(r.left), right:Math.round(r.right), w:Math.round(r.width),
            ownScrollW:el.scrollWidth, ownClientW:el.clientWidth,
            ox:getComputedStyle(el).overflowX, txt:(el.textContent||'').trim().slice(0,40) });
      });
      document.querySelectorAll('.workspace-card').forEach(c=>{
        out.cards.push({ cls:String(c.className), h:c.offsetHeight, kids:c.children.length,
          html:c.innerHTML.replace(/\s+/g,' ').slice(0,180) });
      });
      return out;
    });
    console.log('--- PROBE '+process.env.PROBE+' @'+w, JSON.stringify(info.doc));
    info.widest.slice(0,25).forEach(x=>console.log('   WIDE', JSON.stringify(x)));
    info.cards.filter(c=>c.kids<=1).forEach(c=>console.log('   CARD', JSON.stringify(c)));
  }
  await browser.close(); server.close(); process.exit(0);
}

/* ------------------------------------------------------------- dashboard */
try{
  await boot();
  await measure('HOME-dashboard');
  clean.push('HOME-dashboard opened');
}catch(e){ push('HOME-dashboard','-','SCREEN-didNotOpen', String(e.message).slice(0,140)); }
for (const e of jsErrors) push('HOME-dashboard','1440','JS-error', e);

/* -------------------------------------------------------------- launchpad */
try{
  jsErrors = [];
  await page.locator('#homeModules').click();
  await page.waitForSelector('.enterprise-launchpad', { timeout:10000 });
  await measure('LAUNCHPAD-moduleMap');
}catch(e){ push('LAUNCHPAD-moduleMap','-','SCREEN-didNotOpen', String(e.message).slice(0,140)); }
for (const e of jsErrors) push('LAUNCHPAD-moduleMap','1440','JS-error', e);

/* ----------------------------------------------------------- each module */
const t0 = Date.now();
for (const [code, sections] of SCREENS){
  if (Date.now()-t0 > 300000){ skipped.push(code+' (time budget)'); continue; }
  let opened = false;
  for (let attempt=0; attempt<2 && !opened; attempt++){
    try{
      jsErrors = [];
      await boot();
      if (await page.locator('#homeModules').count()) await page.locator('#homeModules').click();
      await page.waitForSelector(`[data-workspace="${code}"]`, { timeout:8000 });
      await page.locator(`[data-workspace="${code}"]`).click();
      await page.waitForSelector('.erp-workbench, .workspace-card, .workspace-error, figure.viz', { timeout:12000 });
      await page.waitForTimeout(400);
      opened = true;
    }catch(e){
      if (attempt === 1) push(code,'-','SCREEN-didNotOpen','module button/shell never appeared: '+String(e.message).slice(0,120));
    }
  }
  if (!opened) continue;

  for (const section of sections){
    const screen = code+':'+section;
    try{
      if (section !== 'center'){
        const ok = await page.evaluate(s=>{
          const b = document.querySelector(`[data-workbench-section="${s}"]`)
                 || document.querySelector(`[data-section="${s}"]`);
          if (!b) return false; b.click(); return true;
        }, section);
        if (!ok){ push(screen,'-','SCREEN-noTab','no tab button for section "'+section+'"'); continue; }
        await page.waitForTimeout(900);
      }
      const err = await page.locator('.workspace-error').count();
      if (err){
        const msg = (await page.locator('.workspace-error').first().innerText()).replace(/\s+/g,' ').slice(0,160);
        push(screen,'1440','SCREEN-errorState', msg);
      }
      await measure(screen);
    }catch(e){
      push(screen,'-','SCREEN-didNotOpen', String(e.message).slice(0,140));
    }
  }
  for (const e of new Set(jsErrors)) push(code,'1440','JS-error', e);
}

await browser.close();
server.close();

/* ------------------------------------------------------------------ output */
const seen = new Set();
const uniq = defects.filter(d=>{ const k=d.join('|'); if(seen.has(k))return false; seen.add(k); return true; });
console.log('\n===== DEFECTS =====');
for (const [s,w,k,d] of uniq) console.log(`${s} | ${w} | ${k} | ${d}`);
console.log(`\nTOTAL DEFECT LINES: ${uniq.length}`);
const byKind = {};
for (const [,,k] of uniq) byKind[k]=(byKind[k]||0)+1;
console.log('BY KIND: '+Object.entries(byKind).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(', '));
console.log('SKIPPED: '+(skipped.join(', ')||'none'));
console.log('UNMOCKED API PATHS HIT: '+[...unmocked].sort().join(', '));
console.log('SHOTS: '+SHOTS);
