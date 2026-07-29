-- E88 FinSys Connected Supply Chain + Sales ERP
-- Safe additive migration for the existing Cloudflare D1 database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS erp_sequences (
  code TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 6,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS erp_role_permissions (
  role_code TEXT NOT NULL,
  module TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 0,
  can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0,
  can_post INTEGER NOT NULL DEFAULT 0,
  can_export INTEGER NOT NULL DEFAULT 0,
  can_manage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(role_code, module)
);

CREATE TABLE IF NOT EXISTS erp_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role_code TEXT NOT NULL DEFAULT 'STAFF',
  department TEXT,
  live_access INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'WAREHOUSE',
  parent_code TEXT,
  address TEXT,
  partner_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_code TEXT NOT NULL UNIQUE,
  partner_type TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  email TEXT,
  phone TEXT,
  credit_status TEXT NOT NULL DEFAULT 'CLEAR',
  credit_limit REAL NOT NULL DEFAULT 0,
  overdue_balance REAL NOT NULL DEFAULT 0,
  hold_reason TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source_system TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_partners_type ON erp_partners(partner_type);
CREATE INDEX IF NOT EXISTS idx_erp_partners_credit ON erp_partners(credit_status);

CREATE TABLE IF NOT EXISTS erp_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  manufacturer TEXT,
  model TEXT,
  color TEXT,
  serialized INTEGER NOT NULL DEFAULT 0,
  base_uom TEXT NOT NULL DEFAULT 'EA',
  standard_cost REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  auto_created INTEGER NOT NULL DEFAULT 0,
  source_system TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(normalized_name, category)
);
CREATE INDEX IF NOT EXISTS idx_erp_items_category ON erp_items(category);

CREATE TABLE IF NOT EXISTS erp_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_no TEXT NOT NULL UNIQUE,
  import_type TEXT NOT NULL,
  source_file_name TEXT,
  source_hash TEXT,
  source_document_url TEXT,
  status TEXT NOT NULL DEFAULT 'PREVIEW',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  exception_rows INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  posted_at TEXT
);

CREATE TABLE IF NOT EXISTS erp_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES erp_import_batches(id),
  source_sheet TEXT,
  source_row INTEGER,
  record_type TEXT,
  external_key TEXT,
  payload_json TEXT,
  validation_status TEXT NOT NULL DEFAULT 'VALID',
  validation_message TEXT,
  posted_record_type TEXT,
  posted_record_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_erp_import_rows_batch ON erp_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_erp_import_rows_validation ON erp_import_rows(validation_status);

CREATE TABLE IF NOT EXISTS erp_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_no TEXT NOT NULL UNIQUE,
  batch_code TEXT,
  supplier_id INTEGER REFERENCES erp_partners(id),
  supplier_name TEXT,
  purchase_order_ref TEXT,
  mode_of_transport TEXT,
  incoterm TEXT,
  shipping_line TEXT,
  vessel TEXT,
  container_no TEXT,
  origin TEXT,
  destination TEXT,
  etd TEXT,
  eta TEXT,
  actual_departure TEXT,
  actual_arrival TEXT,
  warehouse_arrival TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  atlas_import_id INTEGER REFERENCES erp_import_batches(id),
  source_system TEXT,
  source_key TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_shipments_status ON erp_shipments(status);
CREATE INDEX IF NOT EXISTS idx_erp_shipments_batch ON erp_shipments(batch_code);

CREATE TABLE IF NOT EXISTS erp_shipment_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES erp_shipments(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  description TEXT,
  category TEXT,
  expected_qty REAL NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  status TEXT NOT NULL DEFAULT 'OPEN',
  source_sheet TEXT,
  UNIQUE(shipment_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_shipment_lines_ship ON erp_shipment_lines(shipment_id);

CREATE TABLE IF NOT EXISTS erp_expected_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES erp_shipments(id),
  shipment_line_id INTEGER REFERENCES erp_shipment_lines(id),
  serial_no TEXT NOT NULL,
  serial_type TEXT NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  manufacturer TEXT,
  model TEXT,
  color TEXT,
  secondary_serial TEXT,
  batch_code TEXT,
  expected_status TEXT NOT NULL DEFAULT 'EXPECTED',
  source_sheet TEXT,
  source_row INTEGER,
  UNIQUE(shipment_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_expected_serial ON erp_expected_assets(serial_no);
CREATE INDEX IF NOT EXISTS idx_erp_expected_status ON erp_expected_assets(expected_status);

CREATE TABLE IF NOT EXISTS erp_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  shipment_id INTEGER NOT NULL REFERENCES erp_shipments(id),
  location_id INTEGER NOT NULL REFERENCES erp_locations(id),
  received_at TEXT NOT NULL,
  receiving_status TEXT NOT NULL DEFAULT 'DRAFT',
  document_ref TEXT,
  document_url TEXT,
  notes TEXT,
  received_by TEXT,
  posted_by TEXT,
  posted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES erp_receipts(id),
  shipment_line_id INTEGER REFERENCES erp_shipment_lines(id),
  expected_asset_id INTEGER REFERENCES erp_expected_assets(id),
  serial_no TEXT,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  qty REAL NOT NULL DEFAULT 1,
  condition_code TEXT NOT NULL DEFAULT 'GOOD',
  acceptance_status TEXT NOT NULL DEFAULT 'MATCHED',
  exception_message TEXT,
  source_method TEXT NOT NULL DEFAULT 'MANUAL',
  qr_payload TEXT,
  UNIQUE(receipt_id, serial_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_receipt_lines_serial ON erp_receipt_lines(serial_no);

CREATE TABLE IF NOT EXISTS erp_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_no TEXT NOT NULL UNIQUE,
  serial_no TEXT NOT NULL UNIQUE,
  serial_type TEXT NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  item_name TEXT,
  category TEXT NOT NULL,
  secondary_serial TEXT,
  motor_no TEXT,
  plate_no TEXT,
  csr_no TEXT,
  batch_code TEXT,
  shipment_id INTEGER REFERENCES erp_shipments(id),
  receipt_id INTEGER REFERENCES erp_receipts(id),
  current_location_id INTEGER REFERENCES erp_locations(id),
  current_location_code TEXT,
  current_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  current_holder_type TEXT,
  current_holder_id INTEGER,
  current_holder_name TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  landed_cost REAL NOT NULL DEFAULT 0,
  condition_code TEXT NOT NULL DEFAULT 'GOOD',
  reconciliation_status TEXT NOT NULL DEFAULT 'CLEAR',
  active INTEGER NOT NULL DEFAULT 1,
  source_system TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_assets_category ON erp_assets(category);
CREATE INDEX IF NOT EXISTS idx_erp_assets_status ON erp_assets(current_status);
CREATE INDEX IF NOT EXISTS idx_erp_assets_location ON erp_assets(current_location_code);
CREATE INDEX IF NOT EXISTS idx_erp_assets_holder ON erp_assets(current_holder_type, current_holder_id);

CREATE TABLE IF NOT EXISTS erp_stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_no TEXT NOT NULL UNIQUE,
  movement_date TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  qty REAL NOT NULL DEFAULT 1,
  from_location_id INTEGER REFERENCES erp_locations(id),
  from_location_code TEXT,
  to_location_id INTEGER REFERENCES erp_locations(id),
  to_location_code TEXT,
  from_status TEXT,
  to_status TEXT,
  holder_type TEXT,
  holder_id INTEGER,
  holder_name TEXT,
  source_doc_type TEXT,
  source_doc_id INTEGER,
  source_doc_no TEXT,
  reason_code TEXT,
  notes TEXT,
  posted_by TEXT,
  posted_at TEXT DEFAULT (datetime('now')),
  reversal_of INTEGER REFERENCES erp_stock_ledger(id)
);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_serial ON erp_stock_ledger(serial_no);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_date ON erp_stock_ledger(movement_date);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_source ON erp_stock_ledger(source_doc_type, source_doc_id);

CREATE TABLE IF NOT EXISTS erp_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_no TEXT NOT NULL UNIQUE,
  assignment_type TEXT NOT NULL,
  partner_id INTEGER REFERENCES erp_partners(id),
  holder_name TEXT,
  start_date TEXT,
  expected_return_date TEXT,
  actual_return_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  purpose TEXT,
  source_request_no TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS erp_assignment_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES erp_assignments(id),
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT NOT NULL,
  role_code TEXT,
  condition_out TEXT,
  condition_in TEXT,
  UNIQUE(assignment_id, serial_no)
);

CREATE TABLE IF NOT EXISTS erp_return_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  assignment_id INTEGER REFERENCES erp_assignments(id),
  partner_id INTEGER REFERENCES erp_partners(id),
  return_date TEXT,
  return_location_id INTEGER REFERENCES erp_locations(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  reason_code TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  posted_by TEXT,
  posted_at TEXT
);

CREATE TABLE IF NOT EXISTS erp_return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES erp_return_orders(id),
  expected_asset_id INTEGER REFERENCES erp_assets(id),
  expected_serial TEXT,
  actual_asset_id INTEGER REFERENCES erp_assets(id),
  actual_serial TEXT,
  item_category TEXT,
  acceptance_status TEXT NOT NULL DEFAULT 'MATCHED',
  condition_code TEXT NOT NULL DEFAULT 'GOOD',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS erp_reconciliation_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no TEXT NOT NULL UNIQUE,
  case_type TEXT NOT NULL,
  return_id INTEGER REFERENCES erp_return_orders(id),
  assignment_id INTEGER REFERENCES erp_assignments(id),
  expected_serial TEXT,
  actual_serial TEXT,
  related_motorcycle_serial TEXT,
  current_location_code TEXT,
  status TEXT NOT NULL DEFAULT 'UNRECONCILED',
  resolution_code TEXT,
  resolution_notes TEXT,
  opened_by TEXT,
  opened_at TEXT DEFAULT (datetime('now')),
  resolved_by TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_recon_status ON erp_reconciliation_cases(status);

CREATE TABLE IF NOT EXISTS erp_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_no TEXT NOT NULL UNIQUE,
  request_date TEXT,
  requestor_email TEXT,
  requestor_name TEXT,
  department TEXT,
  purpose TEXT,
  fulfillment_method TEXT,
  partner_id INTEGER REFERENCES erp_partners(id),
  destination TEXT,
  required_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  remarks TEXT,
  source_system TEXT,
  source_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_requisition_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL REFERENCES erp_requisitions(id),
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  description TEXT,
  qty REAL NOT NULL DEFAULT 0,
  serial_required INTEGER NOT NULL DEFAULT 0,
  fulfilled_qty REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS erp_pre_release_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_no TEXT NOT NULL UNIQUE,
  assignment_id INTEGER REFERENCES erp_assignments(id),
  serial_no TEXT NOT NULL,
  check_date TEXT,
  checklist_json TEXT,
  result TEXT NOT NULL DEFAULT 'PENDING',
  defects TEXT,
  checked_by TEXT,
  approved_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_no TEXT NOT NULL UNIQUE,
  transaction_type TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES erp_partners(id),
  order_date TEXT,
  contract_start TEXT,
  contract_end TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  gross_amount REAL NOT NULL DEFAULT 0,
  delivery_address TEXT,
  source_system TEXT,
  source_key TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  posted_by TEXT,
  posted_at TEXT
);

CREATE TABLE IF NOT EXISTS erp_sales_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id INTEGER NOT NULL REFERENCES erp_sales_orders(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  description TEXT,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  line_role TEXT,
  UNIQUE(sales_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS erp_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_no TEXT NOT NULL UNIQUE,
  assignment_id INTEGER REFERENCES erp_assignments(id),
  sales_order_id INTEGER REFERENCES erp_sales_orders(id),
  requisition_id INTEGER REFERENCES erp_requisitions(id),
  requested_date TEXT,
  scheduled_date TEXT,
  actual_release_date TEXT,
  actual_delivery_date TEXT,
  origin_location_id INTEGER REFERENCES erp_locations(id),
  destination TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  proof_document_url TEXT,
  source_system TEXT,
  source_key TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_delivery_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES erp_deliveries(id),
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  item_code TEXT,
  qty REAL NOT NULL DEFAULT 1,
  UNIQUE(delivery_id, serial_no)
);

CREATE TABLE IF NOT EXISTS erp_station_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_no TEXT NOT NULL UNIQUE,
  site_name TEXT NOT NULL,
  partner_id INTEGER REFERENCES erp_partners(id),
  planned_location TEXT,
  planned_date TEXT,
  target_activation_date TEXT,
  actual_activation_date TEXT,
  progress_pct REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  budget_amount REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_station_project_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES erp_station_projects(id),
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  asset_role TEXT,
  assigned_date TEXT,
  status TEXT DEFAULT 'ASSIGNED'
);

CREATE TABLE IF NOT EXISTS erp_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_at TEXT DEFAULT (datetime('now')),
  user_email TEXT,
  environment TEXT NOT NULL DEFAULT 'LIVE',
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_type TEXT,
  record_id INTEGER,
  record_no TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_audit_module ON erp_audit_log(module, event_at);
CREATE INDEX IF NOT EXISTS idx_erp_audit_record ON erp_audit_log(record_type, record_id);

CREATE TABLE IF NOT EXISTS erp_serial_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_no TEXT NOT NULL UNIQUE,
  serial_no TEXT,
  exception_type TEXT NOT NULL,
  source_system TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  canonical_asset_id INTEGER REFERENCES erp_assets(id),
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_serial_exceptions_serial ON erp_serial_exceptions(serial_no);
CREATE INDEX IF NOT EXISTS idx_erp_serial_exceptions_status ON erp_serial_exceptions(status);

INSERT OR IGNORE INTO erp_sequences(code,prefix,width,next_value) VALUES
('ITEM_MC','MC',6,1),('ITEM_BAT','BAT',6,1),('ITEM_BSS','BSS',6,1),('ITEM_SP','SP',6,1),
('ITEM_CHG','CHG',6,1),('ITEM_OTH','OTH',6,1),('IMPORT','IMP',6,1),('SHIPMENT','SHP',6,1),
('RECEIPT','RCV',6,1),('ASSET','AST',8,1),('MOVEMENT','MV',8,1),('ASSIGNMENT','ASG',6,1),
('RETURN','RET',6,1),('RECON','REC',6,1),('REQUISITION','REQ',6,1),('CHECKLIST','PRC',6,1),
('SALES_ORDER','SO',6,1),('DELIVERY','DLV',6,1),('STATION_PROJECT','BSSP',6,1),('EXCEPTION','EXC',6,1);

INSERT OR IGNORE INTO erp_roles(code,name) VALUES
('ADMIN','System Administrator'),('SCM_MANAGER','Supply Chain Manager'),('WAREHOUSE','Warehouse User'),
('COMMERCIAL','Commercial User'),('FINANCE','Finance User'),('VIEWER','Read Only'),('STAFF','Standard Staff');

-- Broad defaults. Admin permissions are enforced server-side as full access.
INSERT OR IGNORE INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
('SCM_MANAGER','DASHBOARD',1,0,0,0,0,1,0),('SCM_MANAGER','SHIPMENTS',1,1,1,1,1,1,1),
('SCM_MANAGER','RECEIVING',1,1,1,1,1,1,1),('SCM_MANAGER','INVENTORY',1,1,1,1,1,1,1),
('SCM_MANAGER','RETURNS',1,1,1,1,1,1,1),('SCM_MANAGER','REQUISITIONS',1,1,1,1,1,1,1),
('SCM_MANAGER','DELIVERIES',1,1,1,1,1,1,1),('SCM_MANAGER','SALES',1,0,0,0,0,1,0),
('WAREHOUSE','DASHBOARD',1,0,0,0,0,0,0),('WAREHOUSE','SHIPMENTS',1,0,0,0,0,0,0),
('WAREHOUSE','RECEIVING',1,1,1,0,1,0,0),('WAREHOUSE','INVENTORY',1,1,1,0,1,0,0),
('WAREHOUSE','RETURNS',1,1,1,0,1,0,0),('WAREHOUSE','REQUISITIONS',1,0,0,0,0,0,0),
('WAREHOUSE','DELIVERIES',1,1,1,0,1,0,0),
('COMMERCIAL','DASHBOARD',1,0,0,0,0,1,0),('COMMERCIAL','SALES',1,1,1,1,1,1,0),
('COMMERCIAL','REQUISITIONS',1,1,1,0,0,1,0),('COMMERCIAL','DELIVERIES',1,1,1,0,0,1,0),
('COMMERCIAL','INVENTORY',1,0,0,0,0,1,0),('COMMERCIAL','RETURNS',1,1,1,0,0,1,0),
('FINANCE','DASHBOARD',1,0,0,0,0,1,0),('FINANCE','SALES',1,0,1,1,1,1,0),
('FINANCE','INVENTORY',1,0,0,0,0,1,0),('FINANCE','SHIPMENTS',1,0,0,0,0,1,0),
('VIEWER','DASHBOARD',1,0,0,0,0,0,0),('VIEWER','SHIPMENTS',1,0,0,0,0,0,0),
('VIEWER','INVENTORY',1,0,0,0,0,0,0),('VIEWER','SALES',1,0,0,0,0,0,0);

INSERT OR IGNORE INTO erp_settings(key,value) VALUES
('APP_NAME','E88 FinSys'),('APP_VERSION','7.0.0'),('TIMEZONE','Asia/Manila'),
('ALLOWED_DOMAIN','nrdev.ph'),('DOCUMENT_BUCKET_PREFIX','e88-finsys'),('COPYRIGHT','Copyright © 2026 AM. All rights reserved.');
