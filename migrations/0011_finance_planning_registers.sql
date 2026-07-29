-- E88 FinSys v7.1 — source registers and finance/planning tables used by the connected ERP.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_sales_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  source_module TEXT NOT NULL,
  transaction_date TEXT,
  sales_type TEXT,
  document_no TEXT,
  customer_id INTEGER REFERENCES erp_partners(id),
  customer_name TEXT,
  contract_or_unit_no TEXT,
  department TEXT,
  cost_center TEXT,
  account_title TEXT,
  description TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT,
  vat_rate REAL NOT NULL DEFAULT 0,
  net_of_vat REAL NOT NULL DEFAULT 0,
  output_vat REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  bank_wallet TEXT,
  bank_reference TEXT,
  other_reference TEXT,
  settlement_date TEXT,
  cleared_status TEXT,
  notes TEXT,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(source_system, source_sheet, source_row)
);
CREATE INDEX IF NOT EXISTS idx_erp_sales_receipts_date ON erp_sales_receipts(transaction_date);
CREATE INDEX IF NOT EXISTS idx_erp_sales_receipts_customer ON erp_sales_receipts(customer_id);

CREATE TABLE IF NOT EXISTS erp_procurement_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id TEXT,
  request_date TEXT,
  request_no TEXT,
  requestor_payee TEXT,
  department TEXT,
  cost_center TEXT,
  project_site TEXT,
  account_title TEXT,
  procurement_category TEXT,
  description TEXT,
  po_no TEXT,
  supplier_invoice_no TEXT,
  invoice_date TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT,
  vat_rate REAL NOT NULL DEFAULT 0,
  net_of_vat REAL NOT NULL DEFAULT 0,
  input_vat REAL NOT NULL DEFAULT 0,
  ewt_rate REAL NOT NULL DEFAULT 0,
  ewt_amount REAL NOT NULL DEFAULT 0,
  net_payable REAL NOT NULL DEFAULT 0,
  payment_terms TEXT,
  due_date TEXT,
  aging_status TEXT,
  approval_stage TEXT,
  payment_status TEXT,
  payment_reference TEXT,
  paid_date TEXT,
  attachment_url TEXT,
  remarks TEXT,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(source_system, source_sheet, source_row)
);
CREATE INDEX IF NOT EXISTS idx_erp_procurement_register_po ON erp_procurement_register(po_no);
CREATE INDEX IF NOT EXISTS idx_erp_procurement_register_status ON erp_procurement_register(payment_status, approval_stage);

CREATE TABLE IF NOT EXISTS erp_payment_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT,
  payment_date TEXT,
  request_no TEXT,
  payee TEXT,
  department TEXT,
  cost_center TEXT,
  account_title TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  ewt_amount REAL NOT NULL DEFAULT 0,
  net_payable REAL NOT NULL DEFAULT 0,
  bank TEXT,
  payment_reference TEXT,
  payment_status TEXT,
  payment_variance REAL NOT NULL DEFAULT 0,
  remarks TEXT,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(source_system, source_sheet, source_row)
);

CREATE TABLE IF NOT EXISTS erp_budget_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  department TEXT,
  cost_center TEXT,
  account_title TEXT,
  capex_opex TEXT,
  amount REAL NOT NULL DEFAULT 0,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(year, month, department, cost_center, account_title, capex_opex, source_system, source_row)
);
CREATE INDEX IF NOT EXISTS idx_erp_budget_plan_period ON erp_budget_plan(year, month);
CREATE INDEX IF NOT EXISTS idx_erp_budget_plan_dept ON erp_budget_plan(department, cost_center);

CREATE TABLE IF NOT EXISTS erp_planning_drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_model TEXT NOT NULL,
  driver_group TEXT,
  driver_name TEXT NOT NULL,
  unit_basis TEXT,
  plan_year INTEGER NOT NULL,
  value REAL,
  notes TEXT,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(business_model, driver_name, plan_year, source_system, source_sheet, source_row)
);
CREATE INDEX IF NOT EXISTS idx_erp_planning_drivers_year ON erp_planning_drivers(plan_year);

CREATE TABLE IF NOT EXISTS erp_opening_data_control (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL UNIQUE,
  source_file_name TEXT,
  source_hash TEXT,
  source_rows INTEGER NOT NULL DEFAULT 0,
  normalized_rows INTEGER NOT NULL DEFAULT 0,
  exception_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'LOADED',
  loaded_at TEXT DEFAULT (datetime('now')),
  notes TEXT
);

INSERT OR IGNORE INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
('SCM_MANAGER','CUSTOMERS',1,0,0,0,0,1,0),
('COMMERCIAL','CUSTOMERS',1,1,1,0,0,1,0),
('FINANCE','CUSTOMERS',1,0,1,1,1,1,0),
('FINANCE','PLANNING',1,1,1,1,1,1,1),
('SCM_MANAGER','PLANNING',1,0,0,0,0,1,0),
('VIEWER','PLANNING',1,0,0,0,0,0,0);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','7.1.0',datetime('now')),
('OPENING_DATA_MODE','EMBEDDED_ACTUAL_SOURCE_DATA',datetime('now')),
('ITEM_CODE_POLICY','AUTO_BY_CATEGORY_SEQUENCE',datetime('now')),
('DUPLICATE_SERIAL_POLICY','CANONICAL_ASSET_PLUS_OPEN_EXCEPTION',datetime('now'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_import_rows_source ON erp_import_rows(import_id,source_sheet,source_row);
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_station_project_asset ON erp_station_project_assets(project_id,serial_no,asset_role);
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_return_line_source ON erp_return_lines(return_id,expected_serial,actual_serial,item_category);
