-- E88 FinSys clean module-first workspace.
-- Existing imported ERP data remains untouched and available for rollback.

CREATE TABLE IF NOT EXISTS erp_user_workspace_access (
  user_id INTEGER NOT NULL REFERENCES erp_users(id),
  module_code TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT,
  PRIMARY KEY(user_id,module_code)
);

CREATE INDEX IF NOT EXISTS idx_erp_user_workspace_access
  ON erp_user_workspace_access(user_id,allowed,module_code);

CREATE TABLE IF NOT EXISTS erp_module_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT NOT NULL UNIQUE,
  module_code TEXT NOT NULL,
  category_code TEXT NOT NULL,
  record_type TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  entity_name TEXT,
  department TEXT,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  owner_email TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_module_records_module_date
  ON erp_module_records(module_code,transaction_date,updated_at);

CREATE INDEX IF NOT EXISTS idx_erp_module_records_module_status
  ON erp_module_records(module_code,status);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','9.0.0-shell',datetime('now')),
('SYSTEM_BUILD_MODE','MODULE_FIRST_NO_EXCEL_INTEGRATION',datetime('now')),
('LEGACY_DATA_POLICY','PRESERVED_HIDDEN_FOR_CONTROLLED_INTEGRATION',datetime('now')),
('COPYRIGHT_OWNER','AL23',datetime('now'));
