-- E88 FinSys v2 — full ERP additions (Cloudflare D1 / SQLite). Idempotent.

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE, name TEXT NOT NULL, tin TEXT, terms TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  type TEXT,            -- Asset|Liability|Equity|Income|Expense
  normal_side TEXT,     -- DEBIT|CREDIT
  active INTEGER DEFAULT 1
);

-- Journal
CREATE TABLE IF NOT EXISTS journal_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  je_no TEXT NOT NULL UNIQUE, je_date TEXT, source TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|POSTED|VOID
  created_by TEXT, created_at TEXT DEFAULT (datetime('now')), posted_at TEXT
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  je_id INTEGER REFERENCES journal_headers(id),
  je_no TEXT, je_date TEXT, status TEXT DEFAULT 'DRAFT',
  account_code TEXT, account_name TEXT, department TEXT,
  debit REAL DEFAULT 0, credit REAL DEFAULT 0, memo TEXT
);
CREATE INDEX IF NOT EXISTS idx_jl_acct ON journal_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_jl_status ON journal_lines(status);

-- Bank
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_no TEXT NOT NULL UNIQUE, txn_date TEXT, bank TEXT,
  type TEXT,            -- DEPOSIT|WITHDRAWAL|TRANSFER|CHARGE
  amount REAL DEFAULT 0, reference TEXT, description TEXT,
  status TEXT DEFAULT 'CLEARED', created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);

-- Planning
CREATE TABLE IF NOT EXISTS budget (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER, month INTEGER, department TEXT, account TEXT,
  capex_opex TEXT, amount REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS forecast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER, month INTEGER, department TEXT, account TEXT,
  amount REAL DEFAULT 0, forecast_type TEXT
);

-- Procurement / payables
CREATE TABLE IF NOT EXISTS procurement_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL UNIQUE, vendor TEXT, po_id INTEGER, bill_date TEXT, due_date TEXT,
  amount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT DEFAULT 'OPEN',
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_no TEXT NOT NULL UNIQUE, vendor TEXT, bill_no TEXT, pay_date TEXT,
  amount REAL DEFAULT 0, method TEXT, reference TEXT, status TEXT DEFAULT 'POSTED',
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS landed_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER, cost_type TEXT, amount REAL DEFAULT 0, notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Stock movement
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mv_no TEXT NOT NULL UNIQUE, serial_no TEXT, from_loc TEXT, to_loc TEXT,
  mv_type TEXT, mv_date TEXT, by_user TEXT, created_at TEXT DEFAULT (datetime('now'))
);

-- Stations & assets
CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE, name TEXT NOT NULL, location TEXT, status TEXT DEFAULT 'ACTIVE',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS station_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_code TEXT, serial_no TEXT, asset_type TEXT, status TEXT DEFAULT 'DEPLOYED',
  deployed_date TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS battery_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_no TEXT, station_code TEXT, customer_id INTEGER, status TEXT DEFAULT 'MAPPED',
  mapped_date TEXT, created_at TEXT DEFAULT (datetime('now'))
);

-- Documents (SI/DR standalone)
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE, doc_type TEXT, ref TEXT, customer TEXT,
  amount REAL DEFAULT 0, doc_date TEXT, status TEXT DEFAULT 'ISSUED',
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);

-- Seed a minimal chart of accounts if empty
INSERT INTO accounts (code, name, type, normal_side)
SELECT * FROM (
  SELECT '1000','Cash on Hand','Asset','DEBIT' UNION ALL
  SELECT '1010','Cash in Bank','Asset','DEBIT' UNION ALL
  SELECT '1200','Accounts Receivable','Asset','DEBIT' UNION ALL
  SELECT '1300','Inventory','Asset','DEBIT' UNION ALL
  SELECT '2000','Accounts Payable','Liability','CREDIT' UNION ALL
  SELECT '2100','VAT Payable','Liability','CREDIT' UNION ALL
  SELECT '2110','EWT Payable','Liability','CREDIT' UNION ALL
  SELECT '3000','Owner Equity','Equity','CREDIT' UNION ALL
  SELECT '4000','Sales Revenue','Income','CREDIT' UNION ALL
  SELECT '4100','Lease Revenue','Income','CREDIT' UNION ALL
  SELECT '5000','Cost of Goods Sold','Expense','DEBIT' UNION ALL
  SELECT '6000','Operating Expense','Expense','DEBIT'
) WHERE NOT EXISTS (SELECT 1 FROM accounts);
