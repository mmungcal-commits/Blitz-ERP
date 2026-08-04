-- 0033_rfp_alignment.sql
-- Aligns the Payables RFP module with the live RFP workflow.
-- ADDITIVE ONLY: creates new erp_rfp_* tables. It does not ALTER or drop any
-- existing table, so running it on the live e88-v7 database is safe (upgrade_existing).

CREATE TABLE IF NOT EXISTS erp_rfp_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('mancom_min','100000');

-- Approval / return trail per RFP (adds MANCOM tier, returns-with-reason, e-signature, SoD data)
CREATE TABLE IF NOT EXISTS erp_rfp_approvals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfp_ref     TEXT NOT NULL,
  stage       TEXT NOT NULL,
  decision    TEXT NOT NULL,
  actor       TEXT,
  actor_name  TEXT,
  reason      TEXT,
  signature   TEXT,
  amount      REAL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_rfp_approvals_ref ON erp_rfp_approvals(rfp_ref);

CREATE TABLE IF NOT EXISTS erp_rfp_cash_advances (
  id          TEXT PRIMARY KEY,
  rfp_ref     TEXT,
  requestor   TEXT,
  department  TEXT,
  amount      REAL DEFAULT 0,
  purpose     TEXT,
  status      TEXT DEFAULT 'PENDING',
  liq_date    TEXT,
  spent       REAL DEFAULT 0,
  variance    REAL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_rfp_liquidation_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  advance_id  TEXT NOT NULL,
  activity    TEXT,
  amount      REAL DEFAULT 0,
  receipt_ref TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_rfp_liq_adv ON erp_rfp_liquidation_lines(advance_id);

CREATE TABLE IF NOT EXISTS erp_rfp_proof_of_payment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfp_ref     TEXT NOT NULL,
  reference   TEXT,
  paid_at     TEXT,
  actor       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_rfp_pop_ref ON erp_rfp_proof_of_payment(rfp_ref);
