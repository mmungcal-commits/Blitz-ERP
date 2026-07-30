-- E88 FinSys v8.1.1 application login and activation.
-- Safe to rerun: no existing operational table is replaced or rebuilt.

CREATE TABLE IF NOT EXISTS erp_user_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES erp_users(id),
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  activated_at TEXT,
  activation_token_hash TEXT,
  activation_expires_at TEXT,
  reset_token_hash TEXT,
  reset_expires_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_user_credentials_activation
  ON erp_user_credentials(activation_token_hash);
CREATE INDEX IF NOT EXISTS idx_erp_user_credentials_reset
  ON erp_user_credentials(reset_token_hash);

CREATE TABLE IF NOT EXISTS erp_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES erp_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_sessions_user ON erp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_erp_sessions_expiry ON erp_sessions(expires_at);

CREATE TABLE IF NOT EXISTS erp_auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  event_type TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  ip_address TEXT,
  user_agent TEXT,
  event_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_auth_events_email_time
  ON erp_auth_events(email,event_at);

INSERT OR IGNORE INTO erp_user_credentials(user_id)
SELECT id FROM erp_users;
