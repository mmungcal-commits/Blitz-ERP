-- 0045 · Receivables Management
--
-- Modelled on E88_SalesMonitoring_2026.xlsx, which is how E88 actually records
-- revenue today: one row per collection, five streams (motorcycle sold,
-- motorcycle leased, battery swapping, after-sales, warehouse service), each
-- carrying its own VAT split, payment method, bank reference and clearing date.
--
-- Re-runnable: every statement is CREATE ... IF NOT EXISTS or INSERT OR IGNORE.

-- ---------------------------------------------------------------------------
-- The collection register. One row per receipt, the shape of the spreadsheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_ar_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT NOT NULL UNIQUE,          -- RCPT-00001
  stream TEXT NOT NULL,                   -- MC_SOLD | MC_LEASED | BATTERY_SWAP | AFTERSALES | WAREHOUSE_SERVICE
  txn_date TEXT NOT NULL,
  sales_type TEXT,                        -- Leased | Sold | Load/Battery Swap | Aftersales | Other Charges | Adjustment
  document_no TEXT,                       -- Receipt / SI / OR number
  customer_id INTEGER REFERENCES erp_partners(id),
  customer_name TEXT NOT NULL,
  contract_ref TEXT,                      -- contract / unit no. / batch code
  unit_count REAL NOT NULL DEFAULT 0,
  department TEXT,
  cost_center TEXT,
  account_title TEXT,
  description TEXT,

  gross_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT NOT NULL DEFAULT 'VATable',   -- VATable | VAT Exempt | Zero Rated
  vat_rate REAL NOT NULL DEFAULT 0.12,
  net_amount REAL NOT NULL DEFAULT 0,
  output_vat REAL NOT NULL DEFAULT 0,

  payment_method TEXT,                    -- Cash | Bank Transfer | GCash | Maya | Check | ...
  bank_wallet TEXT,
  bank_ref TEXT,
  other_ref TEXT,
  settlement_date TEXT,
  cleared_status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | CLEARED | BOUNCED

  -- Where it came from, so a collection can be traced back to the order that
  -- earned it rather than floating on its own.
  sales_order_id INTEGER REFERENCES erp_sales_orders(id),
  sales_order_no TEXT,

  -- Posting. A collection is a record until Finance posts it; then it is money.
  status TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | POSTED | VOID
  posted_by TEXT,
  posted_at TEXT,
  journal_id INTEGER REFERENCES erp_journal_headers(id),
  void_reason TEXT,

  prepared_by TEXT,
  notes TEXT,
  source_system TEXT,
  source_key TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ar_coll_date   ON erp_ar_collections(txn_date);
CREATE INDEX IF NOT EXISTS idx_ar_coll_stream ON erp_ar_collections(stream, txn_date);
CREATE INDEX IF NOT EXISTS idx_ar_coll_cust   ON erp_ar_collections(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_coll_status ON erp_ar_collections(status);
CREATE INDEX IF NOT EXISTS idx_ar_coll_so     ON erp_ar_collections(sales_order_id);

-- ---------------------------------------------------------------------------
-- What a customer was billed, so collection can be measured against something.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_ar_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  stream TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  customer_id INTEGER REFERENCES erp_partners(id),
  customer_name TEXT NOT NULL,
  sales_order_id INTEGER REFERENCES erp_sales_orders(id),
  sales_order_no TEXT,
  contract_ref TEXT,
  description TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT NOT NULL DEFAULT 'VATable',
  vat_rate REAL NOT NULL DEFAULT 0.12,
  net_amount REAL NOT NULL DEFAULT 0,
  output_vat REAL NOT NULL DEFAULT 0,
  -- Kept in step by the route whenever a collection is applied or unapplied.
  paid_amount REAL NOT NULL DEFAULT 0,
  open_balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',    -- OPEN | PARTIAL | PAID | VOID
  department TEXT,
  cost_center TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ar_inv_cust ON erp_ar_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_inv_due  ON erp_ar_invoices(due_date, status);

-- Which collection paid which invoice, and how much of it.
CREATE TABLE IF NOT EXISTS erp_ar_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES erp_ar_collections(id),
  invoice_id INTEGER NOT NULL REFERENCES erp_ar_invoices(id),
  amount REAL NOT NULL,
  applied_by TEXT,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(collection_id, invoice_id)
);

-- ---------------------------------------------------------------------------
-- The setup lists the spreadsheet keeps on its own tab. Held as data so Finance
-- can extend them without a deployment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_ar_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type TEXT NOT NULL,                -- SALES_TYPE | PAYMENT_METHOD | BANK | ACCOUNT_TITLE | COST_CENTER | VAT_TYPE
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(list_type, value)
);

INSERT OR IGNORE INTO erp_ar_lists(list_type,value,sort_order) VALUES
  ('SALES_TYPE','Leased',1),('SALES_TYPE','Sold',2),('SALES_TYPE','Load/Battery Swap',3),
  ('SALES_TYPE','Aftersales',4),('SALES_TYPE','Other Charges',5),('SALES_TYPE','Adjustment',6),
  ('PAYMENT_METHOD','Cash',1),('PAYMENT_METHOD','Bank Transfer',2),('PAYMENT_METHOD','BDO Deposit',3),
  ('PAYMENT_METHOD','MBTC PHP Deposit',4),('PAYMENT_METHOD','MBTC USD Deposit',5),
  ('PAYMENT_METHOD','GCash',6),('PAYMENT_METHOD','Maya',7),('PAYMENT_METHOD','Check',8),
  ('BANK','BDO',1),('BANK','MBTC PHP',2),('BANK','MBTC USD',3),('BANK','GCash',4),
  ('BANK','Maya',5),('BANK','Cash on Hand',6),('BANK','Other Bank',7),
  ('VAT_TYPE','VATable',1),('VAT_TYPE','VAT Exempt',2),('VAT_TYPE','Zero Rated',3),
  ('ACCOUNT_TITLE','Cash in Bank - BDO',1),('ACCOUNT_TITLE','Xendit Clearing',2),
  ('ACCOUNT_TITLE','Accounts Receivable',3),('ACCOUNT_TITLE','Customer Deposits',4),
  ('ACCOUNT_TITLE','Sales Revenue - Leased',5),('ACCOUNT_TITLE','Sales Revenue - Sold',6),
  ('ACCOUNT_TITLE','Sales Revenue - Load/Swap',7),('ACCOUNT_TITLE','Sales Revenue - Aftersales',8),
  ('ACCOUNT_TITLE','Sales Discounts',9),('ACCOUNT_TITLE','Output VAT Payable',10),
  ('COST_CENTER','Admin',1),('COST_CENTER','Aftersales',2),('COST_CENTER','Finance and Accounting',3),
  ('COST_CENTER','Homologation & Registration',4),('COST_CENTER','HR',5),('COST_CENTER','Legal & notarial',6),
  ('COST_CENTER','Logistics',7),('COST_CENTER','Monitoring & Field',8),('COST_CENTER','Network Rollout',9),
  ('COST_CENTER','Permits & registration',10),('COST_CENTER','Procurement',11),('COST_CENTER','R&D',12),
  ('COST_CENTER','Retail',13),('COST_CENTER','Sales',14),('COST_CENTER','Service Center',15),
  ('COST_CENTER','Technology',16),('COST_CENTER','Warehouse',17);

-- Receivables Management is governed by the FINANCE module, so the people who
-- already run payables run this too. Sales and after-sales can see and raise,
-- but only Finance posts.
INSERT OR IGNORE INTO erp_role_permissions
  (role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('FINANCE','RECEIVABLES',1,1,1,1,1,1,1),
  ('FINANCE_REVIEWER','RECEIVABLES',1,1,1,0,0,1,0),
  ('CEO','RECEIVABLES',1,0,0,1,0,1,0),
  ('MANCOM','RECEIVABLES',1,0,0,0,0,1,0),
  ('COMMERCIAL','RECEIVABLES',1,1,1,0,0,1,0),
  ('DEPT_HEAD','RECEIVABLES',1,1,1,0,0,1,0),
  ('DEPT_MANAGER','RECEIVABLES',1,1,1,0,0,1,0),
  ('SCM_HEAD','RECEIVABLES',1,0,0,0,0,1,0);
