import { Hono } from 'hono';

const app = new Hono();
const ok = (c, d) => c.json({ ok: true, ...d });
const bad = (c, m, code = 400) => c.json({ ok: false, error: m }, code);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
function userEmail(c) { return c.req.header('Cf-Access-Authenticated-User-Email') || c.get('user') || 'nrdev@nrdev.ph'; }
async function nextNo(db, table, prefix) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return `${prefix}-${String(((r && r.n) || 0) + 1).padStart(6, '0')}`;
}

/* ============ MODULE REGISTRY (single source of truth) ============ */
const T = (name, label, type = 'text', extra = {}) => ({ name, label, type, ...extra });
const REG = {
  // ---- Supply Chain ----
  pos: { label: 'Purchase Orders', group: 'Inventory & Procurement', table: 'purchase_orders', date: 'order_date', seq: { prefix: 'PO', field: 'po_no' },
    search: ['po_no', 'vendor'], cols: [T('po_no', 'PO No', 'ro'), T('vendor', 'Vendor', 'select', { lookup: 'vendors', lv: 'name', ll: 'name' }), T('order_date', 'Order Date', 'date'), T('total', 'Total', 'num'), T('status', 'Status', 'ro')],
    actions: [{ id: 'po-approve', label: 'Approve', when: 'DRAFT' }] },
  landed: { label: 'Landed Cost', group: 'Inventory & Procurement', table: 'landed_costs', seq: null,
    search: ['cost_type'], cols: [T('po_id', 'PO ID', 'num'), T('cost_type', 'Cost Type', 'select', { opts: ['Freight', 'Duties', 'Insurance', 'Handling', 'Other'] }), T('amount', 'Amount', 'num'), T('notes', 'Notes', 'textarea')] },
  receiving: { label: 'Receiving', group: 'Inventory & Procurement', custom: 'receiving' },
  serials: { label: 'Inventory', group: 'Inventory & Procurement', table: 'inventory_serials', date: 'created_at', readonly: true,
    search: ['serial_no', 'item_desc', 'motor_no'], cols: [T('serial_no', 'Serial No', 'ro'), T('item_desc', 'Item', 'ro'), T('category', 'Class', 'ro'), T('status', 'Status', 'ro'), T('location_name', 'Location', 'ro')] },
  movements: { label: 'Stock Movement', group: 'Inventory & Procurement', table: 'stock_movements', date: 'mv_date', seq: { prefix: 'MV', field: 'mv_no' },
    search: ['mv_no', 'serial_no'], cols: [T('mv_no', 'MV No', 'ro'), T('serial_no', 'Serial', 'select', { lookup: 'serials', lv: 'serial_no', ll: 'serial_no' }), T('from_loc', 'From', 'select', { lookup: 'locations', lv: 'name', ll: 'name' }), T('to_loc', 'To', 'select', { lookup: 'locations', lv: 'name', ll: 'name' }), T('mv_type', 'Type', 'select', { opts: ['TRANSFER', 'DEPLOY', 'RETURN', 'ADJUST'] }), T('mv_date', 'Date', 'date')] },
  deliveries: { label: 'Delivery', group: 'Inventory & Procurement', table: 'deliveries', date: 'requested_date', seq: { prefix: 'DR', field: 'dr_no' },
    search: ['dr_no', 'serial_no', 'destination'], cols: [T('dr_no', 'DR No', 'ro'), T('sale_id', 'Sale', 'select', { lookup: 'sales', lv: 'id', ll: 'si_no' }), T('serial_no', 'Serial', 'text'), T('destination', 'Destination', 'text'), T('requested_date', 'Requested', 'date'), T('status', 'Status', 'ro')],
    actions: [{ id: 'delivery-release', label: 'Release', when: 'FOR_DELIVERY' }, { id: 'delivery-receive', label: 'Receive', when: 'RELEASED' }] },
  // ---- Commercial ----
  sales: { label: 'Sales', group: 'Finance & Accounting', table: 'sales', date: 'sale_date', seq: { prefix: 'SI', field: 'si_no' },
    search: ['si_no'], cols: [T('si_no', 'SI No', 'ro'), T('customer_id', 'Customer', 'select', { lookup: 'customers', lv: 'id', ll: 'name' }), T('sale_date', 'Date', 'date'), T('gross', 'Gross', 'num'), T('status', 'Status', 'ro')],
    actions: [{ id: 'sale-post', label: 'Post', when: 'DRAFT' }] },
  leases: { label: 'Lease Contracts', group: 'Finance & Accounting', table: 'leases', date: 'start_date', seq: { prefix: 'LC', field: 'contract_no' },
    search: ['contract_no', 'serial_no'], cols: [T('contract_no', 'Contract', 'ro'), T('customer_id', 'Customer', 'select', { lookup: 'customers', lv: 'id', ll: 'name' }), T('serial_no', 'Serial', 'select', { lookup: 'serials', lv: 'serial_no', ll: 'serial_no' }), T('monthly', 'Monthly', 'num'), T('status', 'Status', 'ro')] },
  collections: { label: 'Collections', group: 'Finance & Accounting', table: 'collections', date: 'collect_date', seq: { prefix: 'OR', field: 'or_no' },
    search: ['or_no'], cols: [T('or_no', 'OR No', 'ro'), T('customer_id', 'Customer', 'select', { lookup: 'customers', lv: 'id', ll: 'name' }), T('amount', 'Amount', 'num'), T('collect_date', 'Date', 'date'), T('status', 'Status', 'ro')],
    actions: [{ id: 'collection-post', label: 'Post to AR', when: 'DRAFT' }] },
  // ---- Finance ----
  journal: { label: 'Journal Entries', group: 'Finance & Accounting', custom: 'journal' },
  bank: { label: 'Bank Transactions', group: 'Finance & Accounting', table: 'bank_transactions', date: 'txn_date', seq: { prefix: 'BNK', field: 'txn_no' },
    search: ['txn_no', 'reference', 'bank'], cols: [T('txn_no', 'Txn No', 'ro'), T('txn_date', 'Date', 'date'), T('bank', 'Bank', 'text'), T('type', 'Type', 'select', { opts: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'CHARGE'] }), T('amount', 'Amount', 'num'), T('reference', 'Reference', 'text')] },
  bills: { label: 'Procurement Bills', group: 'Finance & Accounting', table: 'procurement_bills', date: 'bill_date', seq: { prefix: 'BILL', field: 'bill_no' },
    search: ['bill_no', 'vendor'], cols: [T('bill_no', 'Bill No', 'ro'), T('vendor', 'Vendor', 'select', { lookup: 'vendors', lv: 'name', ll: 'name' }), T('bill_date', 'Date', 'date'), T('due_date', 'Due', 'date'), T('amount', 'Amount', 'num'), T('status', 'Status', 'text')] },
  payments: { label: 'Payments', group: 'Finance & Accounting', table: 'payments', date: 'pay_date', seq: { prefix: 'PAY', field: 'pay_no' },
    search: ['pay_no', 'vendor'], cols: [T('pay_no', 'Pay No', 'ro'), T('vendor', 'Vendor', 'select', { lookup: 'vendors', lv: 'name', ll: 'name' }), T('bill_no', 'Bill No', 'text'), T('pay_date', 'Date', 'date'), T('amount', 'Amount', 'num'), T('method', 'Method', 'select', { opts: ['Cash', 'Check', 'Bank Transfer'] })] },
  // ---- Planning ----
  budget: { label: 'Approved Budget', group: 'Plan & Optimize', table: 'budget', seq: null,
    search: ['department', 'account'], cols: [T('year', 'Year', 'num'), T('month', 'Month', 'num'), T('department', 'Department', 'text'), T('account', 'Account', 'select', { lookup: 'accounts', lv: 'name', ll: 'name' }), T('capex_opex', 'CAPEX/OPEX', 'select', { opts: ['CAPEX', 'OPEX'] }), T('amount', 'Amount', 'num')] },
  forecast: { label: 'Forecast', group: 'Plan & Optimize', table: 'forecast', seq: null,
    search: ['department', 'account'], cols: [T('year', 'Year', 'num'), T('month', 'Month', 'num'), T('department', 'Department', 'text'), T('account', 'Account', 'select', { lookup: 'accounts', lv: 'name', ll: 'name' }), T('amount', 'Amount', 'num'), T('forecast_type', 'Type', 'select', { opts: ['Optimistic', 'Base', 'Conservative'] })] },
  // ---- Assets ----
  stations: { label: 'Stations', group: 'Asset Management', table: 'stations', seq: { prefix: 'STN', field: 'code' },
    search: ['code', 'name', 'location'], cols: [T('code', 'Code', 'ro'), T('name', 'Name', 'text'), T('location', 'Location', 'text'), T('status', 'Status', 'select', { opts: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] })] },
  station_assets: { label: 'Station Assets', group: 'Asset Management', table: 'station_assets', date: 'deployed_date', seq: null,
    search: ['station_code', 'serial_no'], cols: [T('station_code', 'Station', 'select', { lookup: 'stations', lv: 'code', ll: 'name' }), T('serial_no', 'Serial', 'select', { lookup: 'serials', lv: 'serial_no', ll: 'serial_no' }), T('asset_type', 'Type', 'text'), T('status', 'Status', 'text'), T('deployed_date', 'Deployed', 'date')] },
  battery: { label: 'Battery Mapping', group: 'Asset Management', table: 'battery_mapping', date: 'mapped_date', seq: null,
    search: ['serial_no', 'station_code'], cols: [T('serial_no', 'Battery Serial', 'select', { lookup: 'serials', lv: 'serial_no', ll: 'serial_no' }), T('station_code', 'Station', 'select', { lookup: 'stations', lv: 'code', ll: 'name' }), T('customer_id', 'Customer', 'select', { lookup: 'customers', lv: 'id', ll: 'name' }), T('status', 'Status', 'text'), T('mapped_date', 'Mapped', 'date')] },
  // ---- Documents ----
  documents: { label: 'SI / DR Documents', group: 'Finance & Accounting', table: 'documents', date: 'doc_date', seq: { prefix: 'DOC', field: 'doc_no' },
    search: ['doc_no', 'ref', 'customer'], cols: [T('doc_no', 'Doc No', 'ro'), T('doc_type', 'Type', 'select', { opts: ['SI', 'DR'] }), T('ref', 'Reference', 'text'), T('customer', 'Customer', 'text'), T('amount', 'Amount', 'num'), T('doc_date', 'Date', 'date'), T('status', 'Status', 'text')] },
  // ---- Masters ----
  items: { label: 'Items', group: 'Inventory & Procurement', table: 'items', seq: null,
    search: ['sku', 'description'], cols: [T('sku', 'SKU', 'text'), T('description', 'Description', 'text'), T('category', 'Category', 'text'), T('class', 'Class', 'text'), T('unit_cost', 'Unit Cost', 'num')] },
  customers: { label: 'Customers', group: 'Finance & Accounting', table: 'customers', seq: { prefix: 'CUS', field: 'code' },
    search: ['code', 'name'], cols: [T('code', 'Code', 'ro'), T('name', 'Name', 'text')] },
  vendors: { label: 'Vendors', group: 'Inventory & Procurement', table: 'vendors', seq: { prefix: 'VEN', field: 'code' },
    search: ['code', 'name'], cols: [T('code', 'Code', 'ro'), T('name', 'Name', 'text'), T('tin', 'TIN', 'text'), T('terms', 'Terms', 'text')] },
  accounts: { label: 'Chart of Accounts', group: 'Finance & Accounting', table: 'accounts', seq: null,
    search: ['code', 'name'], cols: [T('code', 'Code', 'text'), T('name', 'Name', 'text'), T('type', 'Type', 'select', { opts: ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] }), T('normal_side', 'Normal', 'select', { opts: ['DEBIT', 'CREDIT'] })] },
  locations: { label: 'Locations', group: 'Inventory & Procurement', table: 'locations', seq: null, search: ['name'], cols: [T('name', 'Name', 'text')] },
  users: { label: 'Users & Access', group: 'HCM', table: 'users', seq: null, search: ['email', 'name'], cols: [T('email', 'Email', 'text'), T('name', 'Name', 'text'), T('role', 'Role', 'select', { opts: ['Admin', 'Manager', 'Staff', 'Viewer'] }), T('active', 'Active', 'select', { opts: ['1', '0'] }), T('permissions', 'Module Access', 'perms')] },

  // ---- Fixed Assets ----
  fa_register: { label: 'Asset Register', group: 'Fixed Assets', table: 'fixed_assets', date: 'acquisition_date', seq: { prefix: 'FA', field: 'fa_no' },
    search: ['fa_no', 'name', 'category'], cols: [T('fa_no', 'Asset No', 'ro'), T('name', 'Name', 'text'), T('category', 'Category', 'select', { opts: ['Machinery', 'Vehicle', 'Equipment', 'Building', 'Furniture', 'IT Hardware', 'Battery Station', 'Other'] }), T('acquisition_date', 'Acquired', 'date'), T('cost', 'Cost', 'num'), T('salvage', 'Salvage', 'num'), T('life_months', 'Life (mo)', 'num'), T('method', 'Method', 'select', { opts: ['STRAIGHT_LINE', 'DECLINING'] }), T('department', 'Department', 'text'), T('location', 'Location', 'text'), T('status', 'Status', 'ro')] },
  fa_capitalization: { label: 'Capitalization', group: 'Fixed Assets', table: 'fa_capitalization', date: 'cap_date', seq: { prefix: 'CAP', field: 'cap_no' },
    search: ['cap_no', 'fa_no'], cols: [T('cap_no', 'Cap No', 'ro'), T('fa_no', 'Asset', 'select', { lookup: 'fa_register', lv: 'fa_no', ll: 'name' }), T('source_ref', 'Source Ref', 'text'), T('amount', 'Amount', 'num'), T('cap_date', 'Date', 'date'), T('notes', 'Notes', 'textarea')] },
  fa_depreciation: { label: 'Depreciation', group: 'Fixed Assets', table: 'fa_depreciation', seq: { prefix: 'DEP', field: 'dep_no' },
    search: ['dep_no', 'fa_no', 'period'], cols: [T('dep_no', 'Dep No', 'ro'), T('fa_no', 'Asset', 'select', { lookup: 'fa_register', lv: 'fa_no', ll: 'name' }), T('period', 'Period', 'text'), T('amount', 'Amount', 'num'), T('accumulated', 'Accumulated', 'num'), T('book_value', 'Book Value', 'num')] },
  fa_transfers: { label: 'Asset Transfer', group: 'Fixed Assets', table: 'fa_transfers', date: 'transfer_date', seq: { prefix: 'FTR', field: 'tr_no' },
    search: ['tr_no', 'fa_no'], cols: [T('tr_no', 'Transfer No', 'ro'), T('fa_no', 'Asset', 'select', { lookup: 'fa_register', lv: 'fa_no', ll: 'name' }), T('from_location', 'From Loc', 'text'), T('to_location', 'To Loc', 'text'), T('from_department', 'From Dept', 'text'), T('to_department', 'To Dept', 'text'), T('transfer_date', 'Date', 'date'), T('notes', 'Notes', 'textarea')] },
  fa_revaluations: { label: 'Revaluation', group: 'Fixed Assets', table: 'fa_revaluations', date: 'reval_date', seq: { prefix: 'REV', field: 'rev_no' },
    search: ['rev_no', 'fa_no'], cols: [T('rev_no', 'Reval No', 'ro'), T('fa_no', 'Asset', 'select', { lookup: 'fa_register', lv: 'fa_no', ll: 'name' }), T('reval_date', 'Date', 'date'), T('old_value', 'Old Value', 'num'), T('new_value', 'New Value', 'num'), T('notes', 'Notes', 'textarea')] },
  fa_disposals: { label: 'Disposal', group: 'Fixed Assets', table: 'fa_disposals', date: 'disposal_date', seq: { prefix: 'DSP', field: 'disp_no' },
    search: ['disp_no', 'fa_no'], cols: [T('disp_no', 'Disposal No', 'ro'), T('fa_no', 'Asset', 'select', { lookup: 'fa_register', lv: 'fa_no', ll: 'name' }), T('disposal_date', 'Date', 'date'), T('method', 'Method', 'select', { opts: ['Sale', 'Scrap', 'Donation', 'Write-off'] }), T('proceeds', 'Proceeds', 'num'), T('book_value', 'Book Value', 'num'), T('gain_loss', 'Gain/Loss', 'num'), T('notes', 'Notes', 'textarea')] },

  // ---- Project Management ----
  projects: { label: 'Projects', group: 'Project Management', table: 'projects', date: 'start_date', seq: { prefix: 'PRJ', field: 'proj_no' },
    search: ['proj_no', 'name', 'client'], cols: [T('proj_no', 'Project No', 'ro'), T('name', 'Name', 'text'), T('client', 'Client', 'text'), T('start_date', 'Start', 'date'), T('end_date', 'End', 'date'), T('budget', 'Budget', 'num'), T('manager', 'Manager', 'text'), T('status', 'Status', 'select', { opts: ['PLANNED', 'ACTIVE', 'ON_HOLD', 'CLOSED'] })] },
  project_tasks: { label: 'Project Tasks', group: 'Project Management', table: 'project_tasks', date: 'due_date', seq: { prefix: 'PT', field: 'task_no' },
    search: ['task_no', 'proj_no', 'task'], cols: [T('task_no', 'Task No', 'ro'), T('proj_no', 'Project', 'select', { lookup: 'projects', lv: 'proj_no', ll: 'name' }), T('task', 'Task', 'text'), T('assignee', 'Assignee', 'text'), T('due_date', 'Due', 'date'), T('progress', 'Progress %', 'num'), T('status', 'Status', 'select', { opts: ['OPEN', 'IN_PROGRESS', 'DONE'] })] },
  project_costs: { label: 'Project Costs', group: 'Project Management', table: 'project_costs', date: 'cost_date', seq: { prefix: 'PC', field: 'pc_no' },
    search: ['pc_no', 'proj_no'], cols: [T('pc_no', 'Cost No', 'ro'), T('proj_no', 'Project', 'select', { lookup: 'projects', lv: 'proj_no', ll: 'name' }), T('cost_type', 'Type', 'select', { opts: ['Labor', 'Material', 'Equipment', 'Subcontract', 'Overhead', 'Other'] }), T('amount', 'Amount', 'num'), T('cost_date', 'Date', 'date'), T('notes', 'Notes', 'textarea')] },

  // ---- HCM ----
  employees: { label: 'Employees', group: 'HCM', table: 'employees', date: 'hire_date', seq: { prefix: 'EMP', field: 'emp_no' },
    search: ['emp_no', 'name', 'department'], cols: [T('emp_no', 'Emp No', 'ro'), T('name', 'Name', 'text'), T('position', 'Position', 'text'), T('department', 'Department', 'text'), T('email', 'Email', 'text'), T('hire_date', 'Hired', 'date'), T('status', 'Status', 'select', { opts: ['ACTIVE', 'ON_LEAVE', 'RESIGNED'] })] },
};

/* ============ registry for client ============ */
app.get('/api/registry', (c) => {
  const out = {};
  for (const k in REG) { const m = REG[k]; out[k] = { key: k, label: m.label, group: m.group, custom: m.custom || null, readonly: !!m.readonly, date: m.date || null, cols: m.cols || [], actions: m.actions || [] }; }
  return ok(c, { modules: out });
});
app.get('/api/me', (c) => ok(c, { email: userEmail(c) }));

/* ============ dashboard ============ */
app.get('/api/dashboard', async (c) => {
  const db = c.env.DB;
  const one = async (s) => (await db.prepare(s).first()) || {};
  const bs = await db.prepare(`SELECT status, COUNT(*) n FROM inventory_serials WHERE active=1 GROUP BY status`).all();
  const cnt = {}; (bs.results || []).forEach(r => cnt[r.status] = r.n);
  const total = await one(`SELECT COUNT(*) n FROM inventory_serials WHERE active=1`);
  const sold = await one(`SELECT COUNT(*) n FROM sales WHERE status='POSTED'`);
  const leased = await one(`SELECT COUNT(*) n FROM leases WHERE status='ACTIVE'`);
  const openPO = await one(`SELECT COUNT(*) n FROM purchase_orders WHERE status IN ('APPROVED','PARTIAL')`);
  const ar = await one(`SELECT COALESCE(SUM(balance),0) v FROM customer_receivables`);
  const ap = await one(`SELECT COALESCE(SUM(balance),0) v FROM procurement_bills WHERE status!='PAID'`);
  const rev = await one(`SELECT COALESCE(SUM(gross),0) v FROM sales WHERE status='POSTED'`);
  const stations = await one(`SELECT COUNT(*) n FROM stations WHERE status='ACTIVE'`);
  return ok(c, { kpis: {
    totalSerials: total.n || 0, available: cnt.AVAILABLE || 0, sold: sold.n || 0, leased: leased.n || 0,
    deployed: cnt.DEPLOYED || 0, transferred: cnt.TRANSFERRED || 0, demo: cnt.DEMO || 0, openPOs: openPO.n || 0,
    arBalance: ar.v || 0, apBalance: ap.v || 0, revenue: rev.v || 0, stations: stations.n || 0,
  }, byStatus: cnt });
});

/* ============ lookups ============ */
app.get('/api/lookup/:key', async (c) => {
  const m = REG[c.req.param('key')]; if (!m || !m.table) return ok(c, { rows: [] });
  const rows = await c.env.DB.prepare(`SELECT * FROM ${m.table} ORDER BY id DESC LIMIT 500`).all();
  return ok(c, { rows: rows.results || [] });
});
app.get('/api/distinct/:key/:col', async (c) => {
  const m = REG[c.req.param('key')]; const col = c.req.param('col');
  if (!m || !m.table || !(m.cols || []).some(x => x.name === col)) return ok(c, { vals: [] });
  const rows = await c.env.DB.prepare(`SELECT DISTINCT ${col} v FROM ${m.table} WHERE ${col} IS NOT NULL AND ${col}!='' ORDER BY v LIMIT 200`).all();
  return ok(c, { vals: (rows.results || []).map(r => r.v) });
});

/* ============ generic list / create / get / update ============ */
app.get('/api/m/:key', async (c) => {
  const m = REG[c.req.param('key')]; if (!m || !m.table) return bad(c, 'Unknown module', 404);
  const db = c.env.DB, q = (c.req.query('q') || '').trim(), from = c.req.query('from'), to = c.req.query('to');
  const page = Math.max(1, +(c.req.query('page') || 1)), size = Math.min(200, +(c.req.query('size') || 50));
  const where = [], args = [];
  if (m.table === 'inventory_serials') where.push('active=1');
  if (q && m.search && m.search.length) { where.push('(' + m.search.map(s => `${s} LIKE ?`).join(' OR ') + ')'); m.search.forEach(() => args.push(`%${q}%`)); }
  if (m.date && from) { where.push(`${m.date} >= ?`); args.push(from); }
  if (m.date && to) { where.push(`${m.date} <= ?`); args.push(to + ' 23:59:59'); }
  const st = (c.req.query('status') || '').trim();
  if (st && (m.cols || []).some(x => x.name === 'status')) { where.push('status=?'); args.push(st); }
  const cat = (c.req.query('category') || '').trim();
  if (cat && (m.cols || []).some(x => x.name === 'category')) { where.push('category=?'); args.push(cat); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const tot = await db.prepare(`SELECT COUNT(*) n FROM ${m.table} ${w}`).bind(...args).first();
  const rows = await db.prepare(`SELECT * FROM ${m.table} ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...args, size, (page - 1) * size).all();
  return ok(c, { rows: rows.results || [], total: (tot && tot.n) || 0, page, size });
});
app.get('/api/m/:key/:id', async (c) => {
  const m = REG[c.req.param('key')]; if (!m || !m.table) return bad(c, 'Unknown module', 404);
  const row = await c.env.DB.prepare(`SELECT * FROM ${m.table} WHERE id=?`).bind(c.req.param('id')).first();
  return row ? ok(c, { row }) : bad(c, 'Not found', 404);
});
function writable(m) { return (m.cols || []).filter(x => x.type !== 'ro').map(x => ({ n: x.name, num: x.type === 'num' })); }
app.post('/api/m/:key', async (c) => {
  const m = REG[c.req.param('key')]; if (!m || !m.table || m.readonly) return bad(c, 'Not allowed', 400);
  const db = c.env.DB, b = await c.req.json();
  const fields = [], vals = [];
  for (const f of writable(m)) { if (b[f.n] !== undefined && b[f.n] !== '') { fields.push(f.n); vals.push(f.num ? num(b[f.n]) : b[f.n]); } }
  if (m.seq) { fields.push(m.seq.field); vals.push(b[m.seq.field] || await nextNo(db, m.table, m.seq.prefix)); }
  if ((m.cols || []).some(x => x.name === 'status') && !fields.includes('status')) { fields.push('status'); vals.push(defaultStatus(m.table)); }
  if ((m.cols || []).some(x => x.name === 'created_by') || m.table === 'purchase_orders') { }
  const ph = fields.map(() => '?').join(',');
  const r = await db.prepare(`INSERT INTO ${m.table} (${fields.join(',')}) VALUES (${ph})`).bind(...vals).run();
  return ok(c, { id: r.meta.last_row_id });
});
app.put('/api/m/:key/:id', async (c) => {
  const m = REG[c.req.param('key')]; if (!m || !m.table || m.readonly) return bad(c, 'Not allowed', 400);
  const db = c.env.DB, b = await c.req.json(), sets = [], vals = [];
  for (const f of writable(m)) { if (b[f.n] !== undefined) { sets.push(`${f.n}=?`); vals.push(f.num ? num(b[f.n]) : b[f.n]); } }
  if (!sets.length) return bad(c, 'Nothing to update');
  vals.push(c.req.param('id'));
  const r = await db.prepare(`UPDATE ${m.table} SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  return ok(c, { updated: r.meta.changes });
});
function defaultStatus(table) {
  if (table === 'purchase_orders' || table === 'sales' || table === 'collections' || table === 'journal_headers') return 'DRAFT';
  if (table === 'leases') return 'ACTIVE';
  if (table === 'deliveries') return 'FOR_DELIVERY';
  if (table === 'procurement_bills') return 'OPEN';
  return 'ACTIVE';
}

/* ============ special actions ============ */
app.post('/api/act/po-approve/:id', async (c) => { const r = await c.env.DB.prepare(`UPDATE purchase_orders SET status='APPROVED' WHERE id=? AND status='DRAFT'`).bind(c.req.param('id')).run(); return ok(c, { updated: r.meta.changes }); });
app.post('/api/act/delivery-release/:id', async (c) => { const r = await c.env.DB.prepare(`UPDATE deliveries SET status='RELEASED', released_by=?, delivery_date=date('now') WHERE id=?`).bind(userEmail(c), c.req.param('id')).run(); return ok(c, { updated: r.meta.changes }); });
app.post('/api/act/delivery-receive/:id', async (c) => { const r = await c.env.DB.prepare(`UPDATE deliveries SET status='RECEIVED', received_by=? WHERE id=?`).bind(userEmail(c), c.req.param('id')).run(); return ok(c, { updated: r.meta.changes }); });
app.post('/api/act/sale-post/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const s = await db.prepare(`SELECT * FROM sales WHERE id=?`).bind(id).first();
  if (!s) return bad(c, 'Not found', 404); if (s.status === 'POSTED') return bad(c, 'Already posted');
  const lines = (await db.prepare(`SELECT * FROM sale_lines WHERE sale_id=?`).bind(id).all()).results || [];
  for (const l of lines) if (l.serial_no) await db.prepare(`UPDATE inventory_serials SET status='SOLD', customer_id=? WHERE serial_no=?`).bind(s.customer_id || null, l.serial_no).run();
  await db.prepare(`UPDATE sales SET status='POSTED' WHERE id=?`).bind(id).run();
  await db.prepare(`INSERT INTO customer_receivables (customer_id, sale_id, amount, balance) VALUES (?,?,?,?)`).bind(s.customer_id || null, id, s.gross, s.gross).run();
  return ok(c, { posted: true });
});
app.post('/api/act/collection-post/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const col = await db.prepare(`SELECT * FROM collections WHERE id=?`).bind(id).first();
  if (!col) return bad(c, 'Not found', 404); if (col.status === 'POSTED') return bad(c, 'Already posted');
  let rem = col.amount;
  const recs = (await db.prepare(`SELECT * FROM customer_receivables WHERE customer_id=? AND balance>0 ORDER BY id ASC`).bind(col.customer_id).all()).results || [];
  for (const r of recs) { if (rem <= 0) break; const ap = Math.min(rem, r.balance); await db.prepare(`UPDATE customer_receivables SET balance=balance-? WHERE id=?`).bind(ap, r.id).run(); rem -= ap; }
  await db.prepare(`UPDATE collections SET status='POSTED' WHERE id=?`).bind(id).run();
  return ok(c, { posted: true, unapplied: rem });
});

/* receiving into inventory (serial-unique) */
app.post('/api/receive', async (c) => {
  const db = c.env.DB, b = await c.req.json();
  const serials = (Array.isArray(b.serials) ? b.serials : []).map(s => String(s).trim()).filter(Boolean);
  if (!serials.length) return bad(c, 'No serials');
  const locName = b.location || 'Main';
  let loc = await db.prepare(`SELECT id FROM locations WHERE name=?`).bind(locName).first();
  if (!loc) { const r = await db.prepare(`INSERT INTO locations (name) VALUES (?)`).bind(locName).run(); loc = { id: r.meta.last_row_id }; }
  const ins = [], dupes = [];
  for (const sn of serials) {
    try { await db.prepare(`INSERT INTO inventory_serials (serial_no, item_desc, category, status, location_id, location_name, po_id, unit_cost) VALUES (?,?,?, 'AVAILABLE', ?,?,?,?)`).bind(sn, b.item_desc || 'Item', b.category || null, loc.id, locName, b.po_id || null, num(b.unit_cost)).run(); ins.push(sn); }
    catch (e) { if (String(e).includes('UNIQUE')) dupes.push(sn); else throw e; }
  }
  if (ins.length) { const rn = await nextNo(db, 'receipts', 'RCV'); await db.prepare(`INSERT INTO receipts (receipt_no, po_id, location_id, qty, received_by) VALUES (?,?,?,?,?)`).bind(rn, b.po_id || null, loc.id, ins.length, userEmail(c)).run(); if (b.po_id) await db.prepare(`UPDATE purchase_orders SET status='PARTIAL' WHERE id=? AND status='APPROVED'`).bind(b.po_id).run(); }
  return ok(c, { received: ins.length, duplicatesSkipped: dupes, dupeCount: dupes.length });
});

/* journal entry create (with lines) + post */
app.post('/api/journal', async (c) => {
  const db = c.env.DB, b = await c.req.json();
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const td = lines.reduce((s, l) => s + num(l.debit), 0), tc = lines.reduce((s, l) => s + num(l.credit), 0);
  if (Math.abs(td - tc) > 0.005) return bad(c, `Not balanced: debit ${td} vs credit ${tc}`);
  if (!lines.length) return bad(c, 'No lines');
  const no = b.je_no || await nextNo(db, 'journal_headers', 'JE');
  const r = await db.prepare(`INSERT INTO journal_headers (je_no, je_date, source, description, status, created_by) VALUES (?,?,?,?, 'DRAFT', ?)`).bind(no, b.je_date || null, b.source || 'Manual', b.description || null, userEmail(c)).run();
  const jid = r.meta.last_row_id;
  for (const l of lines) await db.prepare(`INSERT INTO journal_lines (je_id, je_no, je_date, status, account_code, account_name, department, debit, credit, memo) VALUES (?,?,?, 'DRAFT', ?,?,?,?,?,?)`).bind(jid, no, b.je_date || null, l.account_code || null, l.account_name || null, l.department || null, num(l.debit), num(l.credit), l.memo || null).run();
  return ok(c, { id: jid, je_no: no });
});
app.get('/api/journal/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const h = await db.prepare(`SELECT * FROM journal_headers WHERE id=?`).bind(id).first();
  const l = await db.prepare(`SELECT * FROM journal_lines WHERE je_id=?`).bind(id).all();
  return ok(c, { header: h, lines: l.results || [] });
});
app.post('/api/act/je-post/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const h = await db.prepare(`SELECT * FROM journal_headers WHERE id=?`).bind(id).first();
  if (!h) return bad(c, 'Not found', 404); if (h.status === 'POSTED') return bad(c, 'Already posted');
  await db.prepare(`UPDATE journal_headers SET status='POSTED', posted_at=datetime('now') WHERE id=?`).bind(id).run();
  await db.prepare(`UPDATE journal_lines SET status='POSTED' WHERE je_id=?`).bind(id).run();
  return ok(c, { posted: true });
});

/* ============ reports ============ */
app.get('/api/report/gl', async (c) => {
  const db = c.env.DB, from = c.req.query('from'), to = c.req.query('to');
  const w = ["status='POSTED'"], a = [];
  if (from) { w.push('je_date>=?'); a.push(from); } if (to) { w.push('je_date<=?'); a.push(to); }
  const rows = await db.prepare(`SELECT je_no, je_date, account_code, account_name, debit, credit, memo FROM journal_lines WHERE ${w.join(' AND ')} ORDER BY je_date, je_no LIMIT 1000`).bind(...a).all();
  return ok(c, { rows: rows.results || [] });
});
app.get('/api/report/trial-balance', async (c) => {
  const db = c.env.DB, from = c.req.query('from'), to = c.req.query('to');
  const w = ["status='POSTED'"], a = [];
  if (from) { w.push('je_date>=?'); a.push(from); } if (to) { w.push('je_date<=?'); a.push(to); }
  const rows = await db.prepare(`SELECT account_code, account_name, SUM(debit) debit, SUM(credit) credit FROM journal_lines WHERE ${w.join(' AND ')} GROUP BY account_code, account_name ORDER BY account_code`).bind(...a).all();
  const data = (rows.results || []).map(r => ({ ...r, balance: (r.debit || 0) - (r.credit || 0) }));
  return ok(c, { rows: data, totalDebit: data.reduce((s, r) => s + (r.debit || 0), 0), totalCredit: data.reduce((s, r) => s + (r.credit || 0), 0) });
});
app.get('/api/report/ap-aging', async (c) => {
  const db = c.env.DB, from = c.req.query('from'), to = c.req.query('to');
  const w = ["status!='PAID'"], a = [];
  if (from) { w.push('bill_date>=?'); a.push(from); } if (to) { w.push('bill_date<=?'); a.push(to); }
  const rows = await db.prepare(`SELECT bill_no, vendor, bill_date, due_date, amount, balance, status, CAST(julianday('now')-julianday(COALESCE(due_date,bill_date)) AS INT) days FROM procurement_bills WHERE ${w.join(' AND ')} ORDER BY days DESC LIMIT 1000`).bind(...a).all();
  return ok(c, { rows: rows.results || [] });
});
app.get('/api/report/location-balances', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT COALESCE(location_name,'(none)') location, status, COUNT(*) qty FROM inventory_serials WHERE active=1 GROUP BY location_name, status ORDER BY location`).all();
  return ok(c, { rows: rows.results || [] });
});
app.get('/api/report/fin-model', async (c) => {
  const db = c.env.DB;
  const b = await db.prepare(`SELECT account, SUM(amount) budget FROM budget GROUP BY account`).all();
  const f = await db.prepare(`SELECT account, SUM(amount) forecast FROM forecast GROUP BY account`).all();
  const map = {}; (b.results || []).forEach(r => map[r.account] = { account: r.account, budget: r.budget || 0, forecast: 0 });
  (f.results || []).forEach(r => { map[r.account] = map[r.account] || { account: r.account, budget: 0, forecast: 0 }; map[r.account].forecast = r.forecast || 0; });
  const rows = Object.values(map).map(x => ({ ...x, variance: (x.forecast || 0) - (x.budget || 0) }));
  return ok(c, { rows });
});

app.all('/api/*', (c) => bad(c, 'Unknown endpoint', 404));

/* ============ Basic Auth gate wrapper ============ */
async function _ok(req, env) { const h = req.headers.get('Authorization') || ''; if (h.indexOf('Basic ') !== 0) return false; try { const d = atob(h.slice(6)); const p = d.slice(d.indexOf(':') + 1); return !!env.APP_PASS && p === env.APP_PASS; } catch (e) { return false; } }
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/logout') return new Response('Signed out. Sign in again to continue.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="E88 FinSys"' } });
    if (!(await _ok(req, env))) return new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="E88 FinSys"' } });
    if (url.pathname.indexOf('/api/') === 0) return app.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  }
};
