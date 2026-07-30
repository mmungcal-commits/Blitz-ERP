-- E88 FinSys v8.1.2 per-user module access and station lifecycle reconciliation.
-- Safe to rerun against the existing D1 database.

CREATE TABLE IF NOT EXISTS erp_user_module_access (
  user_id INTEGER NOT NULL REFERENCES erp_users(id),
  module TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT,
  PRIMARY KEY(user_id,module)
);

CREATE INDEX IF NOT EXISTS idx_erp_user_module_access_user
  ON erp_user_module_access(user_id,allowed);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','8.1.2',datetime('now')),
('USER_ACCESS_POLICY','EXPLICIT_MODULE_ALLOWLIST_WITH_ROLE_ACTIONS',datetime('now')),
('STATION_ASSET_POLICY','CANONICAL_HOLDER_IS_AUTHORITATIVE',datetime('now'));
