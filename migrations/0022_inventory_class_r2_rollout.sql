PRAGMA foreign_keys = ON;

-- v13.1: preserve the Excel source-of-truth classification.
-- Motorcycles, batteries, lockers/BSS, chargers, and spare parts are
-- separate inventory classes, separate GL control accounts, and separate
-- reconciliation lines. No combined motorcycle/parts or battery/BSS buckets.

INSERT OR IGNORE INTO erp_chart_accounts(
  account_code,account_name,account_type,financial_statement,normal_balance,
  parent_account_code,control_type,cash_flow_group,system_account,allow_manual_posting
) VALUES
('1225','Inventory - Lockers and BSS','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1235','Inventory - Spare Parts','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1245','Inventory - Chargers','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1248','Inventory - Other','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1330','Lease Battery Pool','ASSET','BALANCE_SHEET','DEBIT','1300','FIXED_ASSET','INVESTING',1,0),
('1340','Charging Equipment','ASSET','BALANCE_SHEET','DEBIT','1300','FIXED_ASSET','INVESTING',1,0),
('5030','Cost of Lockers and BSS Sold','COGS','INCOME_STATEMENT','DEBIT','5000','COGS','OPERATING',1,0),
('5040','Cost of Spare Parts Sold','COGS','INCOME_STATEMENT','DEBIT','5000','COGS','OPERATING',1,0),
('5050','Cost of Chargers Sold','COGS','INCOME_STATEMENT','DEBIT','5000','COGS','OPERATING',1,0),
('5090','Cost of Other Inventory Sold','COGS','INCOME_STATEMENT','DEBIT','5000','COGS','OPERATING',1,0);

UPDATE erp_chart_accounts SET account_name='Inventory - Motorcycles' WHERE account_code='1200';
UPDATE erp_chart_accounts SET account_name='Inventory - Batteries' WHERE account_code='1220';
UPDATE erp_chart_accounts SET account_name='Battery Inventory / Swap Cost' WHERE account_code='5020';

-- Normalize the item master using the uploaded Excel item descriptions and material codes.
-- Preserve distinct material codes when legacy and operational item masters use the same description.
-- The legacy table has a UNIQUE(normalized_name, category) constraint, so the search key is
-- disambiguated before both rows are moved into the motorcycle class.
UPDATE erp_items
SET normalized_name=trim(normalized_name||' '||item_code),updated_at=datetime('now')
WHERE UPPER(COALESCE(category,'')) NOT IN ('MC','MOTORCYCLE','MOTORCYCLES')
  AND (UPPER(COALESCE(item_code,'')) GLOB 'R280*' OR UPPER(COALESCE(item_code,'')) GLOB 'D400*')
  AND EXISTS(
    SELECT 1 FROM erp_items x
    WHERE x.id<>erp_items.id AND x.normalized_name=erp_items.normalized_name
      AND UPPER(COALESCE(x.category,'')) IN ('MC','MOTORCYCLE','MOTORCYCLES')
  );

UPDATE erp_items
SET category = CASE
  WHEN UPPER(COALESCE(item_code,'')) GLOB 'R280*'
    OR UPPER(COALESCE(item_code,'')) GLOB 'D400*'
    OR UPPER(COALESCE(item_name,'')) LIKE '%MOTORCYCLE%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%NRD R280%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%NRD D400%' THEN 'MC'
  WHEN UPPER(COALESCE(item_name,'')) LIKE '%CHARGER%'
    OR UPPER(COALESCE(item_code,'')) GLOB 'BATCH*' THEN 'CHG'
  WHEN UPPER(COALESCE(item_code,''))='ESP00263'
    OR UPPER(COALESCE(item_name,'')) LIKE '%BATTERY%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%AMPACE%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%7428%' THEN 'BAT'
  WHEN UPPER(COALESCE(item_code,'')) IN ('ESP00262','ESP00291')
    OR UPPER(COALESCE(item_name,'')) LIKE '%LOCKER%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%RIDEBOX RACK%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%BSS%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%SWAP%STATION%' THEN 'BSS'
  WHEN UPPER(COALESCE(category,'')) IN ('SP','SPARE PART','SPARE PARTS','PART','PARTS') THEN 'SP'
  WHEN UPPER(COALESCE(category,'')) IN ('MC','MOTORCYCLE','MOTORCYCLES') THEN 'MC'
  WHEN UPPER(COALESCE(category,'')) IN ('BAT','BATTERY','BATTERIES') THEN 'BAT'
  WHEN UPPER(COALESCE(category,'')) IN ('BSS','LOCKER','LOCKERS','RIDEBOX') THEN 'BSS'
  WHEN UPPER(COALESCE(category,'')) IN ('CHG','CHARGER','CHARGERS') THEN 'CHG'
  WHEN UPPER(COALESCE(item_code,'')) LIKE 'ESP%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%PANEL%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%COVER%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%SEAT%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%FENDER%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%CONTROLLER%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%GLOVE BOX%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%HEAD LIGHT%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%WHEEL%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%BRAKE%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%MIRROR%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%TIRE%'
    OR UPPER(COALESCE(item_name,'')) LIKE '%TYRE%' THEN 'SP'
  ELSE 'OTH'
END,
updated_at=datetime('now');

UPDATE erp_assets
SET category=COALESCE((SELECT i.category FROM erp_items i WHERE i.id=erp_assets.item_id),'OTH'),
    updated_at=datetime('now')
WHERE active=1;

-- Reclassify the v12 combined opening balances without changing total assets.
-- This is a posted, auditable journal rather than a direct alteration of historical lines.
INSERT OR IGNORE INTO erp_journal_headers(
  journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,source_no,
  source_event_key,description,currency,exchange_rate,total_debit,total_credit,status,
  created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at)
SELECT 'JE-INVENTORY-CLASS-RECLASS-V13-1',
  (SELECT id FROM erp_legal_entities WHERE entity_code='E88' LIMIT 1),
  '2026-07-31',NULL,'RECLASSIFICATION','INVENTORY','OPENING_RECLASSIFICATION',
  'INV-CLASS-V13-1','INVENTORY_CLASS_RECLASS:V13.1',
  'Separate lockers/BSS inventory and lease battery pool from combined v12 balances',
  'PHP',1,
  ROUND(
    COALESCE((SELECT SUM(a.unit_cost) FROM erp_assets a
      WHERE a.active=1 AND a.category='BSS' AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)),0)
    + COALESCE((SELECT SUM(f.net_book_value) FROM erp_fixed_asset_books f
      JOIN erp_assets a ON a.id=f.asset_id WHERE a.category='BAT' AND f.status IN ('ACTIVE','PENDING_APPROVAL')),0),2),
  ROUND(
    COALESCE((SELECT SUM(a.unit_cost) FROM erp_assets a
      WHERE a.active=1 AND a.category='BSS' AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)),0)
    + COALESCE((SELECT SUM(f.net_book_value) FROM erp_fixed_asset_books f
      JOIN erp_assets a ON a.id=f.asset_id WHERE a.category='BAT' AND f.status IN ('ACTIVE','PENDING_APPROVAL')),0),2),
  'POSTED','SYSTEM_ROLLOUT','SYSTEM_ROLLOUT',datetime('now'),'SYSTEM_ROLLOUT',datetime('now'),'SYSTEM_ROLLOUT',datetime('now')
WHERE NOT EXISTS(SELECT 1 FROM erp_journal_headers WHERE journal_no='JE-INVENTORY-CLASS-RECLASS-V13-1');

INSERT INTO erp_journal_lines(journal_id,line_no,account_id,business_line,description,debit,credit,base_debit,base_credit)
SELECT h.id,1,a.id,'RIDEBOX','Reclassify lockers/BSS inventory from combined battery account',x.amount,0,x.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1225'
JOIN (SELECT ROUND(COALESCE(SUM(ast.unit_cost),0),2) amount FROM erp_assets ast
  WHERE ast.active=1 AND ast.category='BSS' AND ast.current_status NOT IN ('SOLD','WRITTEN_OFF')
  AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=ast.id)) x
WHERE h.journal_no='JE-INVENTORY-CLASS-RECLASS-V13-1' AND x.amount>0
  AND NOT EXISTS(SELECT 1 FROM erp_journal_lines l WHERE l.journal_id=h.id AND l.line_no=1);

INSERT INTO erp_journal_lines(journal_id,line_no,account_id,business_line,description,debit,credit,base_debit,base_credit)
SELECT h.id,2,a.id,'RIDEBOX','Remove lockers/BSS inventory from combined battery account',0,x.amount,0,x.amount
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1220'
JOIN (SELECT ROUND(COALESCE(SUM(ast.unit_cost),0),2) amount FROM erp_assets ast
  WHERE ast.active=1 AND ast.category='BSS' AND ast.current_status NOT IN ('SOLD','WRITTEN_OFF')
  AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=ast.id)) x
WHERE h.journal_no='JE-INVENTORY-CLASS-RECLASS-V13-1' AND x.amount>0
  AND NOT EXISTS(SELECT 1 FROM erp_journal_lines l WHERE l.journal_id=h.id AND l.line_no=2);

INSERT INTO erp_journal_lines(journal_id,line_no,account_id,business_line,description,debit,credit,base_debit,base_credit)
SELECT h.id,3,a.id,'ENERGY','Reclassify deployed battery pool from motorcycle lease assets',x.amount,0,x.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1330'
JOIN (SELECT ROUND(COALESCE(SUM(f.net_book_value),0),2) amount FROM erp_fixed_asset_books f
  JOIN erp_assets ast ON ast.id=f.asset_id WHERE ast.category='BAT' AND f.status IN ('ACTIVE','PENDING_APPROVAL')) x
WHERE h.journal_no='JE-INVENTORY-CLASS-RECLASS-V13-1' AND x.amount>0
  AND NOT EXISTS(SELECT 1 FROM erp_journal_lines l WHERE l.journal_id=h.id AND l.line_no=3);

INSERT INTO erp_journal_lines(journal_id,line_no,account_id,business_line,description,debit,credit,base_debit,base_credit)
SELECT h.id,4,a.id,'ENERGY','Remove deployed battery pool from motorcycle lease assets',0,x.amount,0,x.amount
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1310'
JOIN (SELECT ROUND(COALESCE(SUM(f.net_book_value),0),2) amount FROM erp_fixed_asset_books f
  JOIN erp_assets ast ON ast.id=f.asset_id WHERE ast.category='BAT' AND f.status IN ('ACTIVE','PENDING_APPROVAL')) x
WHERE h.journal_no='JE-INVENTORY-CLASS-RECLASS-V13-1' AND x.amount>0
  AND NOT EXISTS(SELECT 1 FROM erp_journal_lines l WHERE l.journal_id=h.id AND l.line_no=4);

DROP VIEW IF EXISTS vw_erp_inventory_by_item_class;
CREATE VIEW vw_erp_inventory_by_item_class AS
SELECT
  CASE
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%D400%' THEN 'D400'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%SPORT%' THEN 'RSPORT'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%R280%' THEN 'R280'
    WHEN upper(i.item_code) LIKE 'MC-%' THEN 'R280'
    WHEN upper(i.item_name) LIKE '%LOCKER%' THEN 'BSS'
    WHEN upper(i.item_name) LIKE '%CHARGER%' THEN 'CHG'
    WHEN upper(i.item_name) LIKE '%AMPACE%'
      OR (upper(i.item_name) LIKE '%BATTERY%'
          AND upper(i.item_name) NOT LIKE '%BOX%' AND upper(i.item_name) NOT LIKE '%LOCK%'
          AND upper(i.item_name) NOT LIKE '%CONNECTOR%' AND upper(i.item_name) NOT LIKE '%CHARGER%'
          AND upper(i.item_name) NOT LIKE '%HOLDER%' AND upper(i.item_name) NOT LIKE '%CABLE%') THEN 'BAT'
    WHEN upper(i.item_code) LIKE 'BAT-%' OR upper(i.item_code) LIKE 'BAT0%' THEN 'BAT'
    WHEN upper(i.item_code) LIKE 'BSS%' THEN 'BSS'
    WHEN upper(i.item_code) LIKE 'CHG%' OR upper(i.item_code) LIKE 'BATCH%' THEN 'CHG'
    ELSE 'SP' END class_code,
  CASE
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%D400%' THEN 'Motorcycle D400'
    WHEN upper(i.item_code) LIKE 'MC-%' AND upper(i.item_name) LIKE '%SPORT%' THEN 'Motorcycle R280 Sport'
    WHEN upper(i.item_code) LIKE 'MC-%' THEN 'Motorcycle R280'
    WHEN upper(i.item_name) LIKE '%LOCKER%' OR upper(i.item_code) LIKE 'BSS%' THEN 'Lockers / BSS'
    WHEN upper(i.item_name) LIKE '%CHARGER%' OR upper(i.item_code) LIKE 'CHG%' OR upper(i.item_code) LIKE 'BATCH%' THEN 'Chargers'
    WHEN upper(i.item_name) LIKE '%AMPACE%' OR upper(i.item_code) LIKE 'BAT-%' OR upper(i.item_code) LIKE 'BAT0%' THEN 'Batteries'
    ELSE 'Spare Parts & Accessories' END class_name,
  i.id item_id,i.item_code,i.item_name,
  l.id location_id,COALESCE(l.code,'UNASSIGNED') location_code,COALESCE(l.name,'Unassigned') location_name,
  a.current_status,
  COUNT(a.id) quantity,
  SUM(CASE WHEN a.current_status NOT IN ('SOLD','WRITTEN_OFF') THEN 1 ELSE 0 END) on_hand_quantity,
  SUM(CASE WHEN a.current_status='AVAILABLE' THEN 1 ELSE 0 END) available_quantity,
  SUM(CASE WHEN a.current_status='LEASED' THEN 1 ELSE 0 END) leased_quantity,
  SUM(CASE WHEN a.current_status='SOLD' THEN 1 ELSE 0 END) sold_quantity,
  SUM(CASE WHEN a.current_holder_name IS NOT NULL OR a.current_status IN ('ASSIGNED','LEASED','DEMO','PILOT_TEST','EMPLOYEE_ASSIGNED','INTERNAL_ASSIGNED') THEN 1 ELSE 0 END) deployed_quantity,
  SUM(CASE WHEN a.current_status='QUARANTINE' THEN 1 ELSE 0 END) quarantine_quantity,
  SUM(CASE WHEN a.current_status NOT IN ('SOLD','WRITTEN_OFF') AND COALESCE(a.unit_cost,0)<=0 THEN 1 ELSE 0 END) unvalued_quantity,
  ROUND(COALESCE(SUM(CASE WHEN a.current_status NOT IN ('SOLD','WRITTEN_OFF') AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id) THEN a.unit_cost ELSE 0 END),0),2) inventory_value
FROM erp_items i
LEFT JOIN erp_assets a ON a.item_id=i.id AND a.active=1 AND a.current_status!='WRITTEN_OFF'
LEFT JOIN erp_locations l ON l.id=a.current_location_id
WHERE i.active=1
GROUP BY i.id,l.id,a.current_status;

DROP VIEW IF EXISTS vw_erp_inventory_class_reconciliation;
CREATE VIEW vw_erp_inventory_class_reconciliation AS
WITH classes(class_code,class_name,account_code,cogs_account_code) AS (
  VALUES
    ('MC','Motorcycles','1200','5000'),
    ('BAT','Batteries','1220','5020'),
    ('BSS','Lockers / BSS','1225','5030'),
    ('SP','Spare Parts','1235','5040'),
    ('CHG','Chargers','1245','5050'),
    ('OTH','Other Inventory','1248','5090')
), subledger AS (
  SELECT COALESCE(NULLIF(category,''),'OTH') class_code,
    COUNT(*) units,
    SUM(CASE WHEN COALESCE(unit_cost,0)>0 THEN 1 ELSE 0 END) valued_units,
    SUM(CASE WHEN COALESCE(unit_cost,0)<=0 THEN 1 ELSE 0 END) unvalued_units,
    ROUND(COALESCE(SUM(unit_cost),0),2) subledger_value
  FROM erp_assets a
  WHERE a.active=1 AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
    AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)
  GROUP BY COALESCE(NULLIF(category,''),'OTH')
), ledger AS (
  SELECT account_code,ROUND(COALESCE(SUM(debit-credit),0),2) gl_value
  FROM vw_erp_general_ledger
  WHERE account_code IN ('1200','1220','1225','1235','1245','1248')
  GROUP BY account_code
)
SELECT c.class_code,c.class_name,c.account_code,c.cogs_account_code,
  COALESCE(s.units,0) units,COALESCE(s.valued_units,0) valued_units,
  COALESCE(s.unvalued_units,0) unvalued_units,
  ROUND(COALESCE(s.subledger_value,0),2) subledger_value,
  ROUND(COALESCE(l.gl_value,0),2) gl_value,
  ROUND(COALESCE(s.subledger_value,0)-COALESCE(l.gl_value,0),2) difference
FROM classes c
LEFT JOIN subledger s ON s.class_code=c.class_code
LEFT JOIN ledger l ON l.account_code=c.account_code;

DROP VIEW IF EXISTS vw_erp_inventory_gl_reconciliation;
CREATE VIEW vw_erp_inventory_gl_reconciliation AS
SELECT
  ROUND(COALESCE(SUM(subledger_value),0),2) inventory_subledger,
  ROUND(COALESCE(SUM(gl_value),0),2) inventory_general_ledger
FROM vw_erp_inventory_class_reconciliation;

DROP VIEW IF EXISTS vw_erp_operational_finance_reconciliation;
CREATE VIEW vw_erp_operational_finance_reconciliation AS
SELECT
  (SELECT COUNT(*) FROM erp_assets WHERE active=1) serialized_assets,
  (SELECT COUNT(*) FROM erp_assets WHERE active=1 AND unit_cost>0) valued_assets,
  (SELECT COUNT(*) FROM erp_assets WHERE active=1 AND unit_cost<=0) unvalued_assets,
  (SELECT inventory_subledger FROM vw_erp_inventory_gl_reconciliation) inventory_subledger,
  (SELECT inventory_general_ledger FROM vw_erp_inventory_gl_reconciliation) inventory_general_ledger,
  (SELECT ROUND(COALESCE(SUM(net_book_value),0),2) FROM erp_fixed_asset_books WHERE status IN ('ACTIVE','PENDING_APPROVAL')) fixed_asset_subledger,
  (SELECT ROUND(COALESCE(SUM(debit-credit),0),2) FROM vw_erp_general_ledger
    WHERE account_code IN ('1300','1310','1320','1330','1340','1390')) fixed_asset_general_ledger,
  (SELECT COUNT(*) FROM erp_finance_source_events WHERE status='ERROR') posting_errors,
  (SELECT COUNT(*) FROM erp_inventory_valuation_exceptions WHERE status='OPEN') open_valuation_exceptions;

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','13.1.0-inventory-class-r2-rollout',datetime('now')),
('INVENTORY_CLASS_POLICY','MOTORCYCLE_BATTERY_LOCKER_BSS_CHARGER_SPARE_PART_SEPARATE_QUANTITY_VALUE_GL',datetime('now')),
('R2_DOCUMENT_POLICY','R2_BINDING_REQUIRED_FOR_SUPPORTING_DOCUMENTS_AND_CONTRACTS',datetime('now'));
