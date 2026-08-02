-- 0024_landed_cost_at_receipt.sql
-- Landed-cost rates used to value units at goods receipt, so each received
-- serial posts at landed cost and the GOODS_RECEIPT event books
-- Dr Inventory (1200/1220/1225) / Cr GR-IR (2050) for the right amount.
--
-- Values are PROVISIONAL (FX 57.00 + placeholder freight/duty from the Landed
-- Cost workbook). Update landed_unit_cost with confirmed figures; the receipt
-- logic reads this table live, so no code change is needed to re-rate.

CREATE TABLE IF NOT EXISTS erp_landed_cost_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,            -- MC / BAT / BSS / SP / CHG / OTH
  model TEXT,                        -- specific model, or NULL for a category default
  landed_unit_cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  source TEXT,
  effective_from TEXT DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_landed_cost_cat_model ON erp_landed_cost_rates(category,model,active);

DELETE FROM erp_landed_cost_rates WHERE source='WORKBOOK_v1';
INSERT INTO erp_landed_cost_rates(category,model,landed_unit_cost,currency,source) VALUES
  ('MC','D400',64560,'PHP','WORKBOOK_v1'),
  ('MC','R280',32982,'PHP','WORKBOOK_v1'),
  ('MC','R280 SPORT',32982,'PHP','WORKBOOK_v1'),   -- proxy = R280 pending confirmed FOB
  ('MC',NULL,32982,'PHP','WORKBOOK_v1'),           -- category fallback
  ('BAT',NULL,20596,'PHP','WORKBOOK_v1'),          -- AMPACE 7428 (single model)
  ('BSS',NULL,64156,'PHP','WORKBOOK_v1');          -- YUNKU 5-door
