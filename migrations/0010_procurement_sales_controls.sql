-- E88 FinSys v7.1 — Procurement, landed cost, documents and commercial controls.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_no TEXT NOT NULL UNIQUE,
  vendor_id INTEGER REFERENCES erp_partners(id),
  vendor_name TEXT,
  order_date TEXT,
  expected_delivery_date TEXT,
  currency TEXT NOT NULL DEFAULT 'PHP',
  exchange_rate REAL NOT NULL DEFAULT 1,
  incoterm TEXT,
  payment_terms TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  source_system TEXT,
  source_key TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_po_status ON erp_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_erp_po_vendor ON erp_purchase_orders(vendor_id);

CREATE TABLE IF NOT EXISTS erp_purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES erp_purchase_orders(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  description TEXT,
  category TEXT,
  ordered_qty REAL NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  UNIQUE(purchase_order_id,line_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_po_lines_po ON erp_purchase_order_lines(purchase_order_id);

CREATE TABLE IF NOT EXISTS erp_landed_cost_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  landed_cost_no TEXT NOT NULL UNIQUE,
  shipment_id INTEGER REFERENCES erp_shipments(id),
  purchase_order_id INTEGER REFERENCES erp_purchase_orders(id),
  allocation_method TEXT NOT NULL DEFAULT 'VALUE',
  currency TEXT NOT NULL DEFAULT 'PHP',
  exchange_rate REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_cost REAL NOT NULL DEFAULT 0,
  notes TEXT,
  posted_by TEXT,
  posted_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_landed_cost_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  landed_cost_id INTEGER NOT NULL REFERENCES erp_landed_cost_headers(id),
  cost_type TEXT NOT NULL,
  vendor_name TEXT,
  reference_no TEXT,
  amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS erp_landed_cost_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  landed_cost_id INTEGER NOT NULL REFERENCES erp_landed_cost_headers(id),
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  item_id INTEGER REFERENCES erp_items(id),
  allocation_basis REAL NOT NULL DEFAULT 0,
  allocated_amount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS erp_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_no TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id INTEGER,
  record_no TEXT,
  document_type TEXT,
  file_name TEXT,
  storage_key TEXT,
  public_url TEXT,
  content_type TEXT,
  file_size INTEGER DEFAULT 0,
  file_hash TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_erp_documents_record ON erp_documents(record_type,record_id);

CREATE TABLE IF NOT EXISTS erp_customer_credit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES erp_partners(id),
  event_type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_credit_customer ON erp_customer_credit_events(customer_id,status);

CREATE TABLE IF NOT EXISTS erp_qr_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_no TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  raw_payload TEXT,
  detected_serial TEXT,
  asset_id INTEGER REFERENCES erp_assets(id),
  image_document_id INTEGER REFERENCES erp_documents(id),
  status TEXT NOT NULL DEFAULT 'FOR_REVIEW',
  reviewed_by TEXT,
  reviewed_at TEXT,
  posted_record_type TEXT,
  posted_record_id INTEGER,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO erp_sequences(code,prefix,width,next_value) VALUES
('LOCATION','LOC',5,1),('PARTNER_VENDOR','VEN',6,1),('PARTNER_CUSTOMER','CUS',6,1),
('PARTNER_EMPLOYEE','EMP',6,1),('PARTNER_SITE_PARTNER','PAR',6,1),('PURCHASE_ORDER','PO',6,1),
('LANDED_COST','LC',6,1),('DOCUMENT','DOC',8,1),('CREDIT_EVENT','CRE',8,1),('QR_REVIEW','QR',8,1);

INSERT OR IGNORE INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
('SCM_MANAGER','PROCUREMENT',1,1,1,1,1,1,1),('WAREHOUSE','PROCUREMENT',1,0,0,0,0,0,0),
('FINANCE','PROCUREMENT',1,1,1,1,1,1,0),('COMMERCIAL','CUSTOMERS',1,1,1,0,0,1,0),
('FINANCE','CUSTOMERS',1,0,1,1,1,1,0),('SCM_MANAGER','STATIONS',1,1,1,1,1,1,1),
('WAREHOUSE','STATIONS',1,0,1,0,1,0,0),('VIEWER','STATIONS',1,0,0,0,0,0,0);
