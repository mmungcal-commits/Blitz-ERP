-- E88 Enterprise System — PO-controlled inbound logistics and discrepancy reporting.
-- Flow: approved purchase order -> ATLAS expected shipment -> actual goods receipt
--       -> warehouse/retail location visibility.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_atlas_po_links (
  import_id INTEGER PRIMARY KEY REFERENCES erp_import_batches(id),
  purchase_order_id INTEGER NOT NULL REFERENCES erp_purchase_orders(id),
  purchase_order_no TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_atlas_po_links_po
  ON erp_atlas_po_links(purchase_order_id);

CREATE TABLE IF NOT EXISTS erp_shipment_po_links (
  shipment_id INTEGER PRIMARY KEY REFERENCES erp_shipments(id),
  purchase_order_id INTEGER NOT NULL REFERENCES erp_purchase_orders(id),
  purchase_order_no TEXT NOT NULL,
  atlas_import_id INTEGER REFERENCES erp_import_batches(id),
  linked_by TEXT NOT NULL,
  linked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_shipment_po_links_po
  ON erp_shipment_po_links(purchase_order_id);

CREATE TABLE IF NOT EXISTS erp_cycle_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no TEXT NOT NULL UNIQUE,
  location_id INTEGER NOT NULL REFERENCES erp_locations(id),
  category TEXT,
  count_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  assigned_to TEXT,
  instructions TEXT,
  expected_units INTEGER NOT NULL DEFAULT 0,
  counted_units INTEGER NOT NULL DEFAULT 0,
  variance_units INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  submitted_by TEXT,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_cycle_counts_location
  ON erp_cycle_counts(location_id,status,count_date);

CREATE TABLE IF NOT EXISTS erp_cycle_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_count_id INTEGER NOT NULL REFERENCES erp_cycle_counts(id),
  expected_asset_id INTEGER REFERENCES erp_assets(id),
  expected_serial_no TEXT,
  expected_item_id INTEGER REFERENCES erp_items(id),
  expected_location_id INTEGER REFERENCES erp_locations(id),
  actual_asset_id INTEGER REFERENCES erp_assets(id),
  actual_serial_no TEXT,
  actual_location_id INTEGER REFERENCES erp_locations(id),
  count_status TEXT NOT NULL DEFAULT 'NOT_COUNTED',
  variance_type TEXT,
  scan_method TEXT,
  scanned_by TEXT,
  scanned_at TEXT,
  notes TEXT,
  UNIQUE(cycle_count_id,expected_asset_id),
  UNIQUE(cycle_count_id,actual_serial_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_cycle_count_lines_variance
  ON erp_cycle_count_lines(cycle_count_id,variance_type,count_status);

CREATE TABLE IF NOT EXISTS erp_inventory_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_no TEXT NOT NULL UNIQUE,
  plan_type TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  horizon_end TEXT,
  source_location_id INTEGER REFERENCES erp_locations(id),
  destination_location_id INTEGER REFERENCES erp_locations(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  purpose TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_inventory_plans_status
  ON erp_inventory_plans(plan_type,status,plan_date);

CREATE TABLE IF NOT EXISTS erp_inventory_plan_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_plan_id INTEGER NOT NULL REFERENCES erp_inventory_plans(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  description TEXT,
  available_qty REAL NOT NULL DEFAULT 0,
  incoming_qty REAL NOT NULL DEFAULT 0,
  planned_qty REAL NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  UNIQUE(inventory_plan_id,line_no)
);

CREATE VIEW IF NOT EXISTS vw_erp_inbound_shipment_report AS
SELECT
  s.id AS shipment_id,
  s.shipment_no,
  s.batch_code,
  s.purchase_order_ref AS purchase_order_no,
  po.id AS purchase_order_id,
  po.vendor_name,
  po.order_date,
  po.expected_delivery_date,
  s.eta,
  s.status AS shipment_status,
  COALESCE(SUM(sl.expected_qty),0) AS expected_qty,
  COALESCE(SUM(sl.received_qty),0) AS received_qty,
  COALESCE(SUM(sl.received_qty),0)-COALESCE(SUM(sl.expected_qty),0) AS quantity_variance,
  (SELECT COUNT(*) FROM erp_expected_assets ea WHERE ea.shipment_id=s.id) AS expected_serials,
  (SELECT COUNT(*) FROM erp_expected_receipt_matches m WHERE m.shipment_id=s.id) AS received_serials,
  (SELECT COUNT(*) FROM erp_expected_receipt_matches m WHERE m.shipment_id=s.id AND m.match_status='MATCHED') AS matched_serials,
  (SELECT COUNT(*) FROM erp_receiving_variances v WHERE v.shipment_id=s.id AND v.status='OPEN') AS open_variances,
  (SELECT GROUP_CONCAT(DISTINCT l.code)
     FROM erp_receipts r
     JOIN erp_locations l ON l.id=r.location_id
    WHERE r.shipment_id=s.id) AS receipt_locations,
  CASE
    WHEN (SELECT COUNT(*) FROM erp_receiving_variances v WHERE v.shipment_id=s.id AND v.status='OPEN')>0
      THEN 'WITH_DISCREPANCIES'
    WHEN COALESCE(SUM(sl.received_qty),0)=0 THEN 'NOT_RECEIVED'
    WHEN COALESCE(SUM(sl.received_qty),0)<COALESCE(SUM(sl.expected_qty),0) THEN 'SHORT'
    WHEN COALESCE(SUM(sl.received_qty),0)>COALESCE(SUM(sl.expected_qty),0) THEN 'OVER'
    ELSE 'MATCHED'
  END AS reconciliation_status
FROM erp_shipments s
LEFT JOIN erp_shipment_po_links spl ON spl.shipment_id=s.id
LEFT JOIN erp_purchase_orders po
  ON po.id=spl.purchase_order_id OR po.purchase_order_no=s.purchase_order_ref
LEFT JOIN erp_shipment_lines sl ON sl.shipment_id=s.id
GROUP BY s.id;

CREATE VIEW IF NOT EXISTS vw_erp_inbound_serial_discrepancies AS
SELECT
  v.id,
  v.variance_no,
  s.shipment_no,
  s.purchase_order_ref AS purchase_order_no,
  r.receipt_no,
  l.code AS location_code,
  l.name AS location_name,
  l.location_type,
  v.variance_type,
  v.expected_serial_no,
  v.actual_serial_no,
  ei.item_code AS expected_item_code,
  ei.item_name AS expected_item_name,
  ai.item_code AS actual_item_code,
  ai.item_name AS actual_item_name,
  v.reason,
  v.status,
  v.resolution,
  v.approved_by,
  v.approved_at,
  v.created_at
FROM erp_receiving_variances v
JOIN erp_shipments s ON s.id=v.shipment_id
JOIN erp_receipts r ON r.id=v.receipt_id
JOIN erp_locations l ON l.id=r.location_id
LEFT JOIN erp_items ei ON ei.id=v.expected_item_id
LEFT JOIN erp_items ai ON ai.id=v.actual_item_id;

CREATE VIEW IF NOT EXISTS vw_erp_cycle_count_variances AS
SELECT
  cc.id AS cycle_count_id,
  cc.count_no,
  cc.count_date,
  cc.status AS count_status,
  l.code AS count_location_code,
  l.name AS count_location_name,
  ccl.variance_type,
  ccl.expected_serial_no,
  ccl.actual_serial_no,
  i.item_code,
  i.item_name,
  al.code AS actual_location_code,
  al.name AS actual_location_name,
  ccl.scan_method,
  ccl.scanned_by,
  ccl.scanned_at,
  ccl.notes
FROM erp_cycle_count_lines ccl
JOIN erp_cycle_counts cc ON cc.id=ccl.cycle_count_id
JOIN erp_locations l ON l.id=cc.location_id
LEFT JOIN erp_assets a ON a.id=COALESCE(ccl.actual_asset_id,ccl.expected_asset_id)
LEFT JOIN erp_items i ON i.id=COALESCE(ccl.expected_item_id,a.item_id)
LEFT JOIN erp_locations al ON al.id=ccl.actual_location_id
WHERE ccl.variance_type IS NOT NULL AND ccl.variance_type!='';

INSERT OR IGNORE INTO erp_sequences(code,prefix,width,next_value) VALUES
('CYCLE_COUNT','CC',7,1),('INVENTORY_PLAN','IP',7,1);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('INBOUND_FLOW','PURCHASE_ORDER>ATLAS_EXPECTED_SHIPMENT>GOODS_RECEIPT>WAREHOUSE_VISIBILITY',datetime('now')),
('ATLAS_PO_POLICY','APPROVED_PURCHASE_ORDER_REQUIRED',datetime('now')),
('GOODS_RECEIPT_LOCATION_POLICY','ACTIVE_WAREHOUSE_OR_RETAIL_REQUIRED',datetime('now')),
('CYCLE_COUNT_POLICY','SNAPSHOT>PRINT_OR_SCAN>COUNT>VARIANCE_REPORT',datetime('now')),
('INVENTORY_PLANNING_POLICY','ANALYZE>ORDER_OR_DEPLOY>APPROVE',datetime('now'));
