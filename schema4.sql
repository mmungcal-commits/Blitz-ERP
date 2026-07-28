-- E88 ERP — Ramco-parity additions: Fixed Assets, Project Management, HCM. Idempotent.

-- ---------- Users & Access (from schema3) ----------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, name TEXT, role TEXT DEFAULT 'Staff',
  active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- Fixed Assets ----------
CREATE TABLE IF NOT EXISTS fixed_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fa_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT,
  acquisition_date TEXT, cost REAL DEFAULT 0, salvage REAL DEFAULT 0,
  life_months INTEGER DEFAULT 0, method TEXT DEFAULT 'STRAIGHT_LINE',
  department TEXT, location TEXT, serial_no TEXT,
  book_value REAL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fa_status ON fixed_assets(status);

CREATE TABLE IF NOT EXISTS fa_capitalization (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cap_no TEXT NOT NULL UNIQUE, fa_no TEXT, source_ref TEXT,
  amount REAL DEFAULT 0, cap_date TEXT, notes TEXT,
  status TEXT DEFAULT 'CAPITALIZED', created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dep_no TEXT NOT NULL UNIQUE, fa_no TEXT, period TEXT,
  amount REAL DEFAULT 0, accumulated REAL DEFAULT 0, book_value REAL DEFAULT 0,
  status TEXT DEFAULT 'POSTED', created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tr_no TEXT NOT NULL UNIQUE, fa_no TEXT, from_location TEXT, to_location TEXT,
  from_department TEXT, to_department TEXT, transfer_date TEXT, notes TEXT,
  status TEXT DEFAULT 'DONE', created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_revaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rev_no TEXT NOT NULL UNIQUE, fa_no TEXT, reval_date TEXT,
  old_value REAL DEFAULT 0, new_value REAL DEFAULT 0, notes TEXT,
  status TEXT DEFAULT 'POSTED', created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fa_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  disp_no TEXT NOT NULL UNIQUE, fa_no TEXT, disposal_date TEXT,
  method TEXT, proceeds REAL DEFAULT 0, book_value REAL DEFAULT 0,
  gain_loss REAL DEFAULT 0, notes TEXT,
  status TEXT DEFAULT 'DISPOSED', created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- Project Management ----------
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proj_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, client TEXT,
  start_date TEXT, end_date TEXT, budget REAL DEFAULT 0,
  manager TEXT, status TEXT NOT NULL DEFAULT 'PLANNED',
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT NOT NULL UNIQUE, proj_no TEXT, task TEXT, assignee TEXT,
  due_date TEXT, progress INTEGER DEFAULT 0, status TEXT DEFAULT 'OPEN',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pc_no TEXT NOT NULL UNIQUE, proj_no TEXT, cost_type TEXT,
  amount REAL DEFAULT 0, cost_date TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------- HCM ----------
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, position TEXT,
  department TEXT, email TEXT, hire_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT DEFAULT (datetime('now'))
);
