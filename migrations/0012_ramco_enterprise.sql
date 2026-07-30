-- E88 FinSys v8.0 — Ramco-style enterprise workbench, data-quality layer, and planning controls.
-- Idempotent and safe for an already-loaded D1 database.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_asset_quality (
  asset_id INTEGER PRIMARY KEY REFERENCES erp_assets(id),
  canonical_serial_key TEXT,
  asset_class TEXT NOT NULL DEFAULT 'STOCK_ITEM',
  count_in_kpi INTEGER NOT NULL DEFAULT 0,
  quality_status TEXT NOT NULL DEFAULT 'REVIEW',
  quality_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_quality_class ON erp_asset_quality(asset_class, count_in_kpi);
CREATE INDEX IF NOT EXISTS idx_asset_quality_status ON erp_asset_quality(quality_status);
CREATE INDEX IF NOT EXISTS idx_asset_quality_key ON erp_asset_quality(canonical_serial_key);

-- Rebuild the reporting classification without deleting source evidence.
DELETE FROM erp_asset_quality;
INSERT INTO erp_asset_quality(asset_id,canonical_serial_key,asset_class,count_in_kpi,quality_status,quality_reason,updated_at)
SELECT
  a.id,
  upper(replace(trim(a.serial_no),'.0','')),
  CASE
    WHEN a.category='MC' AND (upper(a.serial_no) LIKE 'R5%' OR upper(COALESCE(a.secondary_serial,'')) LIKE 'R5%' OR (a.source_system='ATLAS' AND upper(a.item_name) NOT LIKE '%PART%')) THEN 'MOTORCYCLE'
    WHEN a.category='BAT' AND upper(a.item_name) NOT LIKE '%CHARGER%' AND upper(a.item_name) NOT LIKE '%BATTERY BOX%' AND upper(a.item_name) NOT LIKE '%BATTERY LOCK%' AND upper(a.item_name) NOT LIKE '%BATTERY CONNECTOR%' AND (upper(a.serial_no) LIKE '519%' OR (a.source_system='ATLAS' AND length(a.serial_no)>=16)) THEN 'BATTERY'
    WHEN (a.category='BSS' OR upper(a.item_name) LIKE '%LOCKER%' OR upper(a.item_name) LIKE '%SWAPPING STATION%' OR upper(a.item_name) LIKE '%SPACEPORT%')
         AND upper(a.item_name) NOT LIKE '%BRACKET%'
         AND upper(a.item_name) NOT LIKE '%SIGNAGE%'
         AND upper(a.item_name) NOT LIKE '%CANOPY%'
         AND upper(a.item_name) NOT LIKE '%POLE%'
         AND (upper(a.serial_no) LIKE '9M%' OR upper(a.serial_no) LIKE 'RIDEBOXLOCKER-9M%' OR a.source_system='ATLAS') THEN 'SWAPPING_STATION'
    WHEN (a.category='CHG' OR upper(a.item_name) LIKE '%CHARGER%')
         AND upper(a.serial_no) NOT LIKE upper(a.item_code)||'-%' THEN 'CHARGER'
    WHEN a.category='SP' OR upper(a.item_name) LIKE '%PART%' OR upper(a.item_name) LIKE '%BRACKET%' OR upper(a.item_name) LIKE '%COVER%' OR upper(a.item_name) LIKE '%REFLECTOR%' OR upper(a.item_name) LIKE '%MANUAL%' OR upper(a.item_name) LIKE '%BOOKLET%' THEN 'SPARE_PART'
    ELSE 'STOCK_ITEM'
  END,
  CASE
    WHEN a.category='MC' AND (upper(a.serial_no) LIKE 'R5%' OR upper(COALESCE(a.secondary_serial,'')) LIKE 'R5%' OR (a.source_system='ATLAS' AND upper(a.item_name) NOT LIKE '%PART%')) THEN 1
    WHEN a.category='BAT' AND upper(a.item_name) NOT LIKE '%CHARGER%' AND upper(a.item_name) NOT LIKE '%BATTERY BOX%' AND upper(a.item_name) NOT LIKE '%BATTERY LOCK%' AND upper(a.item_name) NOT LIKE '%BATTERY CONNECTOR%' AND (upper(a.serial_no) LIKE '519%' OR (a.source_system='ATLAS' AND length(a.serial_no)>=16)) THEN 1
    WHEN (a.category='BSS' OR upper(a.item_name) LIKE '%LOCKER%' OR upper(a.item_name) LIKE '%SWAPPING STATION%' OR upper(a.item_name) LIKE '%SPACEPORT%')
         AND upper(a.item_name) NOT LIKE '%BRACKET%'
         AND upper(a.item_name) NOT LIKE '%SIGNAGE%'
         AND upper(a.item_name) NOT LIKE '%CANOPY%'
         AND upper(a.item_name) NOT LIKE '%POLE%'
         AND (upper(a.serial_no) LIKE '9M%' OR upper(a.serial_no) LIKE 'RIDEBOXLOCKER-9M%' OR a.source_system='ATLAS') THEN 1
    WHEN (a.category='CHG' OR upper(a.item_name) LIKE '%CHARGER%')
         AND upper(a.serial_no) NOT LIKE upper(a.item_code)||'-%' THEN 1
    ELSE 0
  END,
  CASE
    WHEN a.source_system='LEGACY_DB' AND upper(a.serial_no) LIKE upper(a.item_code)||'-%' THEN 'LEGACY_QUANTITY_PROXY'
    WHEN a.serial_no LIKE '%.0' THEN 'NORMALIZED'
    WHEN length(trim(a.serial_no))<5 THEN 'REVIEW'
    ELSE 'VERIFIED'
  END,
  CASE
    WHEN a.source_system='LEGACY_DB' AND upper(a.serial_no) LIKE upper(a.item_code)||'-%' THEN 'Legacy quantity row represented as a generated serial; excluded from serialized KPI counts and included in stock balances.'
    WHEN a.serial_no LIKE '%.0' THEN 'Spreadsheet numeric suffix removed for reporting key.'
    WHEN length(trim(a.serial_no))<5 THEN 'Serial is too short for automatic verification.'
    ELSE 'Source-backed serial record.'
  END,
  datetime('now')
FROM erp_assets a;


-- Consolidate obvious spreadsheet suffix variants only when the unsuffixed base serial also exists.
UPDATE erp_asset_quality
SET canonical_serial_key=(
      SELECT upper(rtrim(rtrim(trim(a.serial_no),'0123456789'),'-_ '))
      FROM erp_assets a WHERE a.id=erp_asset_quality.asset_id
    ),
    quality_status='SUFFIX_VARIANT',
    quality_reason='Numeric suffix variant linked to an existing base serial; retained as source evidence but excluded from physical-asset counts.',
    updated_at=datetime('now')
WHERE asset_id IN (
  SELECT a.id
  FROM erp_assets a
  WHERE (upper(trim(a.serial_no)) GLOB '*-[0-9]*' OR upper(trim(a.serial_no)) GLOB '*_[0-9]*')
    AND EXISTS (
      SELECT 1 FROM erp_assets b
      WHERE b.id<>a.id
        AND upper(trim(b.serial_no))=upper(rtrim(rtrim(trim(a.serial_no),'0123456789'),'-_ '))
    )
);

-- Keep only one physical record per canonical serial in KPI counts. All rows remain available for audit and reconciliation.
UPDATE erp_asset_quality
SET count_in_kpi=0,
    quality_status='DUPLICATE_SUFFIX',
    quality_reason='Duplicate or suffixed representation of the same canonical physical serial; excluded from KPI counts.',
    updated_at=datetime('now')
WHERE count_in_kpi=1
  AND EXISTS (
    SELECT 1
    FROM erp_asset_quality q2
    WHERE q2.canonical_serial_key=erp_asset_quality.canonical_serial_key
      AND q2.asset_id<erp_asset_quality.asset_id
      AND q2.count_in_kpi=1
  );

DROP VIEW IF EXISTS vw_erp_serialized_assets;
CREATE VIEW vw_erp_serialized_assets AS
SELECT a.*,
  CASE q.asset_class WHEN 'MOTORCYCLE' THEN 'MC' WHEN 'BATTERY' THEN 'BAT' WHEN 'SWAPPING_STATION' THEN 'BSS' WHEN 'CHARGER' THEN 'CHG' ELSE a.category END kpi_category,
  q.canonical_serial_key,q.asset_class,q.quality_status,q.quality_reason
FROM erp_assets a
JOIN erp_asset_quality q ON q.asset_id=a.id
WHERE a.active=1 AND q.count_in_kpi=1;

CREATE VIEW IF NOT EXISTS vw_erp_stock_balances AS
SELECT
  a.item_id,a.item_code,a.item_name,
  CASE WHEN q.asset_class='SPARE_PART' THEN 'SP' ELSE COALESCE(a.category,'OTH') END category,
  COALESCE(a.current_location_code,'UNASSIGNED') location_code,
  COALESCE(a.current_status,'AVAILABLE') status,
  COUNT(*) quantity,
  SUM(COALESCE(a.unit_cost,0)) total_cost,
  MIN(a.created_at) first_recorded_at,
  MAX(a.updated_at) last_updated_at
FROM erp_assets a
JOIN erp_asset_quality q ON q.asset_id=a.id
WHERE a.active=1 AND q.count_in_kpi=0
GROUP BY a.item_id,a.item_code,a.item_name,CASE WHEN q.asset_class='SPARE_PART' THEN 'SP' ELSE COALESCE(a.category,'OTH') END,COALESCE(a.current_location_code,'UNASSIGNED'),COALESCE(a.current_status,'AVAILABLE');

CREATE TABLE IF NOT EXISTS erp_budget_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  department TEXT NOT NULL,
  cost_center TEXT NOT NULL DEFAULT '',
  account_title TEXT NOT NULL,
  capex_opex TEXT NOT NULL DEFAULT 'OPEX',
  amount REAL NOT NULL DEFAULT 0,
  version_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'WORKING',
  notes TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year,month,department,cost_center,account_title,capex_opex)
);
CREATE INDEX IF NOT EXISTS idx_budget_overrides_period ON erp_budget_overrides(year,month,department);

CREATE TABLE IF NOT EXISTS erp_plan_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  department TEXT NOT NULL,
  cost_center TEXT NOT NULL DEFAULT '',
  account_title TEXT NOT NULL,
  capex_opex TEXT NOT NULL DEFAULT 'OPEX',
  amount REAL NOT NULL DEFAULT 0,
  forecast_version TEXT NOT NULL DEFAULT 'LATEST',
  status TEXT NOT NULL DEFAULT 'WORKING',
  notes TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year,month,department,cost_center,account_title,capex_opex,forecast_version)
);
CREATE INDEX IF NOT EXISTS idx_plan_forecasts_period ON erp_plan_forecasts(year,month,department);

CREATE TABLE IF NOT EXISTS erp_plan_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  department TEXT NOT NULL,
  cost_center TEXT NOT NULL DEFAULT '',
  account_title TEXT NOT NULL,
  capex_opex TEXT NOT NULL DEFAULT 'OPEX',
  amount REAL NOT NULL DEFAULT 0,
  source_document TEXT,
  notes TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year,month,department,cost_center,account_title,capex_opex)
);
CREATE INDEX IF NOT EXISTS idx_plan_actuals_period ON erp_plan_actuals(year,month,department);

CREATE TABLE IF NOT EXISTS erp_bank_reconciliation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reconciliation_no TEXT NOT NULL UNIQUE,
  bank_code TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  bank_date TEXT,
  bank_reference TEXT,
  bank_description TEXT,
  deposit_amount REAL NOT NULL DEFAULT 0,
  withdrawal_amount REAL NOT NULL DEFAULT 0,
  bank_charges REAL NOT NULL DEFAULT 0,
  system_reference TEXT,
  system_amount REAL NOT NULL DEFAULT 0,
  variance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNMATCHED',
  department TEXT,
  cost_center TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  matched_by TEXT,
  matched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_recon_bank_date ON erp_bank_reconciliation(bank_code,bank_date);
CREATE INDEX IF NOT EXISTS idx_bank_recon_status ON erp_bank_reconciliation(status);

CREATE TABLE IF NOT EXISTS erp_workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id INTEGER,
  record_no TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  action TEXT NOT NULL,
  remarks TEXT,
  acted_by TEXT,
  acted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_record ON erp_workflow_events(record_type,record_id,acted_at);

INSERT OR IGNORE INTO erp_sequences(code,prefix,width,next_value) VALUES
('BANK_RECON','BR',8,1),('BUDGET_VERSION','BV',5,1),('JOURNAL','JE',8,1);

INSERT OR IGNORE INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
('FINANCE','FINANCE',1,1,1,1,1,1,1),
('FINANCE','MASTERS',1,1,1,1,0,1,1),
('FINANCE','DATA_QUALITY',1,0,0,1,0,1,0),
('SCM_MANAGER','MASTERS',1,1,1,1,0,1,1),
('SCM_MANAGER','DATA_QUALITY',1,0,1,1,0,1,1),
('WAREHOUSE','MASTERS',1,0,0,0,0,0,0),
('WAREHOUSE','DATA_QUALITY',1,0,0,0,0,0,0),
('COMMERCIAL','MASTERS',1,1,1,0,0,1,0),
('VIEWER','FINANCE',1,0,0,0,0,0,0),
('VIEWER','MASTERS',1,0,0,0,0,0,0),
('VIEWER','DATA_QUALITY',1,0,0,0,0,0,0);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','8.0.0',datetime('now')),
('UI_STYLE','RAMCO_ENTERPRISE_WORKBENCH',datetime('now')),
('SERIAL_KPI_POLICY','VERIFIED_PHYSICAL_ASSETS_ONLY',datetime('now')),
('LEGACY_QUANTITY_POLICY','AGGREGATE_AS_STOCK_BALANCE',datetime('now')),
('BUDGET_LAYOUT','EXCEL_MONTHLY_DEPARTMENT_COST_CENTER_ACCOUNT',datetime('now'));
