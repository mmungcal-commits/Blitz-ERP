-- E88 FinSys v8.1 — ATLAS expected shipment and controlled actual receiving workbench.
-- ATLAS creates expected records only. Inventory is created only from approved actual receipts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_expected_receipt_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES erp_shipments(id),
  shipment_line_id INTEGER REFERENCES erp_shipment_lines(id),
  expected_asset_id INTEGER REFERENCES erp_expected_assets(id),
  receipt_id INTEGER NOT NULL REFERENCES erp_receipts(id),
  receipt_line_id INTEGER NOT NULL REFERENCES erp_receipt_lines(id),
  expected_serial_no TEXT,
  actual_serial_no TEXT NOT NULL,
  expected_item_id INTEGER REFERENCES erp_items(id),
  actual_item_id INTEGER REFERENCES erp_items(id),
  match_status TEXT NOT NULL,
  variance_reason TEXT,
  matched_by TEXT,
  matched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(receipt_line_id),
  UNIQUE(expected_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_expected_receipt_shipment ON erp_expected_receipt_matches(shipment_id,match_status);
CREATE INDEX IF NOT EXISTS idx_expected_receipt_serials ON erp_expected_receipt_matches(expected_serial_no,actual_serial_no);

CREATE TABLE IF NOT EXISTS erp_receiving_variances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variance_no TEXT NOT NULL UNIQUE,
  shipment_id INTEGER NOT NULL REFERENCES erp_shipments(id),
  receipt_id INTEGER NOT NULL REFERENCES erp_receipts(id),
  receipt_line_id INTEGER NOT NULL REFERENCES erp_receipt_lines(id),
  variance_type TEXT NOT NULL,
  expected_serial_no TEXT,
  actual_serial_no TEXT,
  expected_item_id INTEGER REFERENCES erp_items(id),
  actual_item_id INTEGER REFERENCES erp_items(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(receipt_line_id)
);
CREATE INDEX IF NOT EXISTS idx_receiving_variances_status ON erp_receiving_variances(status,variance_type);

CREATE VIEW IF NOT EXISTS vw_erp_shipment_receiving_summary AS
SELECT
  s.id shipment_id,s.shipment_no,s.batch_code,s.supplier_name,s.status,
  COALESCE(SUM(l.expected_qty),0) expected_qty,
  COALESCE(SUM(l.received_qty),0) received_qty,
  CASE WHEN COALESCE(SUM(l.expected_qty),0)-COALESCE(SUM(l.received_qty),0)>0 THEN COALESCE(SUM(l.expected_qty),0)-COALESCE(SUM(l.received_qty),0) ELSE 0 END remaining_qty,
  (SELECT COUNT(*) FROM erp_expected_assets e WHERE e.shipment_id=s.id) expected_serials,
  (SELECT COUNT(*) FROM erp_expected_assets e WHERE e.shipment_id=s.id AND e.expected_status='RECEIVED') matched_serials,
  (SELECT COUNT(*) FROM erp_expected_assets e WHERE e.shipment_id=s.id AND e.expected_status='SUBSTITUTED') substituted_serials,
  (SELECT COUNT(*) FROM erp_receiving_variances v WHERE v.shipment_id=s.id AND v.status='OPEN') open_variances
FROM erp_shipments s
LEFT JOIN erp_shipment_lines l ON l.shipment_id=s.id
GROUP BY s.id;

INSERT OR IGNORE INTO erp_sequences(code,prefix,width,next_value) VALUES
('RECEIVING_VARIANCE','RV',7,1);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','8.1.0',datetime('now')),
('ATLAS_POLICY','EXPECTED_SHIPMENT_ONLY',datetime('now')),
('RECEIVING_POLICY','ACTUAL_RECEIPT_CREATES_INVENTORY',datetime('now')),
('SERIAL_VARIANCE_POLICY','SUBSTITUTED_SERIAL_TO_QUARANTINE',datetime('now'));
