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

-- ================================================================
-- Landed-cost inventory revaluation (Option A, provisional per financial model)
-- Revalues on-hand serialized inventory to landed cost, then posts ONE balanced
-- revaluation journal so each class GL control account equals its new subledger.
-- Offset to opening-conversion equity (3100) => trial balance stays balanced.
-- Idempotent (unique source_event_key). Adjustable later by the team.
-- Landed cost: D400 83,137.60 · R280/R280 Sport 45,487.12 · Battery 24,695.61 · Locker/BSS 113,257.77
-- ================================================================

-- 1) Subledger: revalue by true type
UPDATE erp_assets SET unit_cost=24695.61
 WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(category,''))='BAT'
   AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=erp_assets.id);
UPDATE erp_assets SET unit_cost=113257.77
 WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(category,''))='BSS'
   AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=erp_assets.id);
UPDATE erp_assets SET unit_cost=CASE
   WHEN item_id IN (SELECT item_id FROM vw_erp_inventory_by_item_class WHERE class_code='D400') THEN 83137.60
   WHEN item_id IN (SELECT item_id FROM vw_erp_inventory_by_item_class WHERE class_code IN ('R280','RSPORT')) THEN 45487.12
   ELSE unit_cost END
 WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(category,''))='MC'
   AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=erp_assets.id);

-- 2) Balanced revaluation journal (header)
INSERT OR IGNORE INTO erp_journal_headers(
  journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,
  source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,
  status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at)
SELECT 'JE-INV-LANDED-REVAL-2026',e.id,date('now'),(SELECT id FROM erp_accounting_periods WHERE entity_id=e.id ORDER BY fiscal_year DESC,period_no DESC LIMIT 1),'REVALUATION','FINANCE','REVALUATION',
  'LANDED-COST-REVAL','FINANCE_LANDED_COST_REVALUATION_2026',
  'Inventory revaluation to landed cost (provisional, per financial model)','PHP',1,0,0,
  'POSTED','system-reval','system-reval',datetime('now'),'system-reval',datetime('now'),'system-reval',datetime('now')
FROM erp_legal_entities e
WHERE e.entity_code='E88';

-- helper: delta per class = new subledger - current GL
-- MC -> 1200
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,1,a.id,'Revalue motorcycles to landed cost',
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END,
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1200'
CROSS JOIN (SELECT ROUND(
   (SELECT COALESCE(SUM(unit_cost),0) FROM erp_assets x WHERE x.active=1 AND x.current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(x.category,''))='MC' AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=x.id))
 - (SELECT COALESCE(SUM(debit-credit),0) FROM vw_erp_general_ledger WHERE account_code='1200'),2) delta) d
WHERE h.source_event_key='FINANCE_LANDED_COST_REVALUATION_2026';
-- BAT -> 1220
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,2,a.id,'Revalue batteries to landed cost',
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END,
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1220'
CROSS JOIN (SELECT ROUND(
   (SELECT COALESCE(SUM(unit_cost),0) FROM erp_assets x WHERE x.active=1 AND x.current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(x.category,''))='BAT' AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=x.id))
 - (SELECT COALESCE(SUM(debit-credit),0) FROM vw_erp_general_ledger WHERE account_code='1220'),2) delta) d
WHERE h.source_event_key='FINANCE_LANDED_COST_REVALUATION_2026';
-- BSS -> 1225
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,3,a.id,'Revalue lockers/BSS to landed cost',
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END,
  CASE WHEN d.delta>0 THEN d.delta ELSE 0 END,CASE WHEN d.delta<0 THEN -d.delta ELSE 0 END
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1225'
CROSS JOIN (SELECT ROUND(
   (SELECT COALESCE(SUM(unit_cost),0) FROM erp_assets x WHERE x.active=1 AND x.current_status NOT IN ('SOLD','WRITTEN_OFF') AND UPPER(COALESCE(x.category,''))='BSS' AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=x.id))
 - (SELECT COALESCE(SUM(debit-credit),0) FROM vw_erp_general_ledger WHERE account_code='1225'),2) delta) d
WHERE h.source_event_key='FINANCE_LANDED_COST_REVALUATION_2026';
-- Equity offset -> 3100 (balancing) computed from the inventory lines just posted
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,4,a.id,'Opening inventory revaluation to equity',
  CASE WHEN n.net_inv<0 THEN -n.net_inv ELSE 0 END,CASE WHEN n.net_inv>0 THEN n.net_inv ELSE 0 END,
  CASE WHEN n.net_inv<0 THEN -n.net_inv ELSE 0 END,CASE WHEN n.net_inv>0 THEN n.net_inv ELSE 0 END
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='3100'
CROSS JOIN (SELECT ROUND(COALESCE(SUM(l.debit-l.credit),0),2) net_inv
   FROM erp_journal_lines l JOIN erp_journal_headers hh ON hh.id=l.journal_id
   WHERE hh.source_event_key='FINANCE_LANDED_COST_REVALUATION_2026') n
WHERE h.source_event_key='FINANCE_LANDED_COST_REVALUATION_2026';

-- Header totals from lines
UPDATE erp_journal_headers SET
  total_debit=(SELECT COALESCE(SUM(debit),0) FROM erp_journal_lines l WHERE l.journal_id=erp_journal_headers.id),
  total_credit=(SELECT COALESCE(SUM(credit),0) FROM erp_journal_lines l WHERE l.journal_id=erp_journal_headers.id)
 WHERE source_event_key='FINANCE_LANDED_COST_REVALUATION_2026';

-- Vendor accreditation directory (authoritative, from E88 accreditation portal)
CREATE TABLE IF NOT EXISTS erp_vendor_accreditation(
  partner_code TEXT PRIMARY KEY, vendor_name TEXT NOT NULL, status TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')));
DELETE FROM erp_vendor_accreditation;
INSERT INTO erp_vendor_accreditation(partner_code,vendor_name,status) VALUES
 ('EV-2026-0003','APSAY ELECTRONICS ENGINEERING SERVICES','Accredited'),
 ('EV-2026-0004','Golden Laptops Incorporated','Accredited'),
 ('EV-2026-0007','Western Guaranty Corporation','Accredited'),
 ('EV-2026-0008','CAIO BUILDERS INCORPORATED','Disapproved'),
 ('EV-2026-0009','DISINI LAW OFFICE','Accredited'),
 ('EV-2026-0010','TRIPLE-A PEST TERMINATOR, INC.','Accredited'),
 ('EV-2026-0011','F.C. De Jesus Electrical Services','Accredited'),
 ('EV-2026-0012','HORWIN HUANGSHAN INTERNATIONAL INC','Accredited'),
 ('EV-2026-0013','i30 Degree Electrical Engineering Services','Accredited'),
 ('EV-2026-0014','ERT Solutions and Services OPC','Accredited'),
 ('EV-2026-0015','BIOMIC WHIZ TRADING','Disapproved'),
 ('EV-2026-0016','STM BUILDERS AND TRADING CORP.','Resubmitted - For approval'),
 ('EV-2026-0017','Constructspace Inc.','Disapproved'),
 ('EV-2026-0018','ThingsPh Inc.','Blocked'),
 ('EV-2026-0019','TGG ELECTRICAL AND INDUSTRIAL SERVICES','Resubmitted - For approval'),
 ('EV-2026-0021','PRESTIGE INT''L CONTAINER CO.','Accredited'),
 ('EV-2026-0022','DIGICORE INTEGRATED IT SOLUTION','Disapproved'),
 ('EV-2026-0023','SGR INDUSTRIES CORPORATION','Disapproved'),
 ('EV-2026-0024','RAR Engineering Services','Disapproved'),
 ('EV-2026-0025','Tech One Global Phils., Inc.','Accredited'),
 ('EV-2026-0026','Business Partner Ent. Phils. Inc.','Disapproved'),
 ('EV-2026-0027','AXL Electro Mechanical Services','Resubmitted - For approval'),
 ('EV-2026-0028','Integrated Control System and Supply Corp.','Accredited'),
 ('EV-2026-0030','3G POWERPLUS 2C CORPORATION','Endorsed by requestor - for document review');
