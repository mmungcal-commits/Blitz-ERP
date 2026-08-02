-- 0028_operational_setup.sql
-- Safe operational corrections found from the live backup:
--  (1) No bank account existed -> vendor payments (P2P) could not complete.
-- Idempotent: safe to run repeatedly.

INSERT OR IGNORE INTO erp_bank_accounts
  (bank_account_code, entity_id, bank_name, account_name, account_number_masked, currency, gl_account_id, opening_balance, active)
SELECT 'BDO-MAIN',
       (SELECT id FROM erp_legal_entities WHERE entity_code='E88'),
       'BDO', 'E88 Operating Account', '****0000', 'PHP',
       (SELECT id FROM erp_chart_accounts WHERE account_code='1010'),
       0, 1
WHERE NOT EXISTS (SELECT 1 FROM erp_bank_accounts WHERE bank_account_code='BDO-MAIN');

-- Product registration: item profile (type) + media (photos / 3D models), D1-backed, free.
CREATE TABLE IF NOT EXISTS erp_item_profile(
  item_id INTEGER PRIMARY KEY,
  product_type TEXT DEFAULT 'SERIALIZED',
  inventoriable INTEGER DEFAULT 1,
  description TEXT,
  sale_price REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS erp_item_media(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo',
  file_name TEXT,
  content_type TEXT,
  data_base64 TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_media_item ON erp_item_media(item_id);
