-- E88 Enterprise System v12.0
-- Operational purpose rules, serial valuation controls, lease-fleet capitalization,
-- and module/submodule connectivity based on the E88 SCM source workbooks.

ALTER TABLE erp_assets ADD COLUMN acquisition_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_assets ADD COLUMN freight_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_assets ADD COLUMN duty_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_assets ADD COLUMN other_landed_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_assets ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'UNVALUED';
ALTER TABLE erp_assets ADD COLUMN valuation_status TEXT NOT NULL DEFAULT 'UNVALUED';
ALTER TABLE erp_assets ADD COLUMN capitalization_status TEXT NOT NULL DEFAULT 'INVENTORY';
ALTER TABLE erp_assets ADD COLUMN placed_in_service_date TEXT;

ALTER TABLE erp_delivery_assets ADD COLUMN financial_treatment TEXT;
ALTER TABLE erp_delivery_assets ADD COLUMN return_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE erp_delivery_assets ADD COLUMN finance_event_id INTEGER REFERENCES erp_finance_source_events(id);

ALTER TABLE erp_return_orders ADD COLUMN source_delivery_id INTEGER REFERENCES erp_deliveries(id);
ALTER TABLE erp_return_orders ADD COLUMN source_sales_order_id INTEGER REFERENCES erp_sales_orders(id);
ALTER TABLE erp_return_orders ADD COLUMN return_type TEXT NOT NULL DEFAULT 'CUSTODY_RETURN';
ALTER TABLE erp_return_orders ADD COLUMN refund_net_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_return_orders ADD COLUMN refund_tax_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_return_orders ADD COLUMN refund_gross_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_return_orders ADD COLUMN restock_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_return_orders ADD COLUMN customer_credit_event_id INTEGER REFERENCES erp_finance_source_events(id);
ALTER TABLE erp_return_orders ADD COLUMN inventory_return_event_id INTEGER REFERENCES erp_finance_source_events(id);

ALTER TABLE erp_fixed_asset_books ADD COLUMN capitalization_event_id INTEGER REFERENCES erp_finance_source_events(id);
ALTER TABLE erp_fixed_asset_books ADD COLUMN capitalization_journal_id INTEGER REFERENCES erp_journal_headers(id);
ALTER TABLE erp_fixed_asset_books ADD COLUMN source_delivery_id INTEGER REFERENCES erp_deliveries(id);
ALTER TABLE erp_fixed_asset_books ADD COLUMN ownership_status TEXT NOT NULL DEFAULT 'COMPANY_OWNED';

ALTER TABLE erp_landed_cost_headers ADD COLUMN input_vat_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_landed_cost_headers ADD COLUMN invoice_total REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_landed_cost_lines ADD COLUMN tax_recoverable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE erp_payment_requests ADD COLUMN landed_cost_id INTEGER REFERENCES erp_landed_cost_headers(id);


INSERT OR IGNORE INTO erp_chart_accounts(
  account_code,account_name,account_type,financial_statement,normal_balance,parent_account_code,
  control_type,cash_flow_group,system_account,allow_manual_posting
) VALUES('2250','Customer Deposits and Refundable Lease Deposits','LIABILITY','BALANCE_SHEET','CREDIT','2200',
  'CUSTOMER_DEPOSIT','OPERATING',1,0);
INSERT OR IGNORE INTO erp_chart_accounts(
  account_code,account_name,account_type,financial_statement,normal_balance,parent_account_code,
  control_type,cash_flow_group,system_account,allow_manual_posting
) VALUES('2060','Accrued Freight, Duties and Landed Costs','LIABILITY','BALANCE_SHEET','CREDIT','2000',
  'LANDED_COST_ACCRUAL','OPERATING',1,0);

CREATE TABLE IF NOT EXISTS erp_transaction_purpose_rules (
  purpose_code TEXT PRIMARY KEY,
  purpose_name TEXT NOT NULL,
  holder_type TEXT NOT NULL,
  durable_treatment TEXT NOT NULL,
  consumable_treatment TEXT NOT NULL,
  target_status TEXT NOT NULL,
  finance_event_type TEXT,
  return_required INTEGER NOT NULL DEFAULT 0,
  approval_required INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

INSERT OR REPLACE INTO erp_transaction_purpose_rules(
  purpose_code,purpose_name,holder_type,durable_treatment,consumable_treatment,target_status,
  finance_event_type,return_required,approval_required,notes
) VALUES
('SALE','Customer Sale','CUSTOMER','ISSUE_TO_CUSTOMER','ISSUE_TO_CUSTOMER','SOLD','SALE_COGS',0,1,'Revenue and output VAT are posted from the commercial document; inventory cost is posted upon delivery.'),
('LEASE','Customer Lease','CUSTOMER','CAPITALIZE_TO_LEASE_FLEET','CONSUME_TO_LEASE_COST','LEASED','CAPITALIZATION',1,1,'Company retains ownership. Units are transferred from inventory to lease fleet and depreciated.'),
('DEMO','Customer or Event Demo','CUSTOMER','CUSTODY_ONLY','CONSUME_IF_AUTHORIZED','DEMO',NULL,1,1,'No immediate P&L for durable assets; return and condition assessment are mandatory.'),
('PILOT','Pilot Test','CUSTOMER','CUSTODY_ONLY','CONSUME_IF_AUTHORIZED','PILOT_TEST',NULL,1,1,'Temporary deployment with return control.'),
('EMPLOYEE_USE','Employee Assignment','EMPLOYEE','CAPITALIZE_TO_PPE','CONSUME_TO_INTERNAL_EXPENSE','EMPLOYEE_ASSIGNED','CAPITALIZATION',1,1,'Durable company assets remain company-owned; consumables are expensed.'),
('INTERNAL_USE','Department/Internal Use','DEPARTMENT','CAPITALIZE_TO_PPE','CONSUME_TO_INTERNAL_EXPENSE','INTERNAL_ASSIGNED','CAPITALIZATION',1,1,'Treatment depends on durable versus consumable classification.'),
('PROJECT_DEPLOYMENT','Project or BSS Deployment','PROJECT_SITE','CAPITALIZE_TO_PROJECT_ASSET','CONSUME_TO_PROJECT_COST','PROJECT_ASSIGNED','CAPITALIZATION',1,1,'BSS, batteries, motorcycles and chargers remain company assets when deployed.'),
('DEALER_RETAIL','Dealer/Consignment','DEALER','CUSTODY_ONLY','CUSTODY_ONLY','CONSIGNED',NULL,1,1,'No revenue until dealer sale or customer acceptance is confirmed.'),
('REPLACEMENT','Warranty or Aftersales Replacement','CUSTOMER','ISSUE_TO_WARRANTY','ISSUE_TO_WARRANTY','REPLACEMENT_ISSUED','WARRANTY_ISSUE',1,1,'Outgoing and returned serials must be reconciled.'),
('INVENTORY_TRANSFER','Warehouse or Site Transfer','WAREHOUSE','LOCATION_TRANSFER','LOCATION_TRANSFER','AVAILABLE',NULL,0,1,'Location/custody movement only; no P&L.'),
('WRITE_OFF','Approved Write-off','INTERNAL','WRITE_OFF','WRITE_OFF','WRITTEN_OFF','INVENTORY_WRITE_OFF',0,1,'Requires approved loss, damage, theft or disposal request.'),
('DONATION','Approved Donation','EXTERNAL_PARTY','ISSUE_TO_DONATION','ISSUE_TO_DONATION','DONATED','DONATION_ISSUE',0,1,'Company inventory is issued to an approved donation expense.');


CREATE TABLE IF NOT EXISTS erp_return_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  obligation_no TEXT NOT NULL UNIQUE,
  source_delivery_id INTEGER NOT NULL REFERENCES erp_deliveries(id),
  source_delivery_no TEXT NOT NULL,
  assignment_id INTEGER REFERENCES erp_assignments(id),
  issued_asset_id INTEGER REFERENCES erp_assets(id),
  issued_serial_no TEXT,
  expected_return_serial_no TEXT,
  purpose_code TEXT NOT NULL,
  holder_type TEXT,
  holder_id INTEGER,
  holder_name TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  return_order_id INTEGER REFERENCES erp_return_orders(id),
  received_asset_id INTEGER REFERENCES erp_assets(id),
  received_serial_no TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  closed_by TEXT,
  closed_at TEXT,
  notes TEXT,
  UNIQUE(source_delivery_id,issued_asset_id,purpose_code)
);
CREATE INDEX IF NOT EXISTS idx_erp_return_obligation_worklist
  ON erp_return_obligations(status,due_date,purpose_code);

CREATE TABLE IF NOT EXISTS erp_inventory_valuation_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER REFERENCES erp_assets(id),
  item_id INTEGER REFERENCES erp_items(id),
  serial_no TEXT,
  item_code TEXT,
  exception_type TEXT NOT NULL,
  source_document_type TEXT,
  source_document_id INTEGER,
  source_document_no TEXT,
  exception_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  proposed_unit_cost REAL NOT NULL DEFAULT 0,
  current_unit_cost REAL NOT NULL DEFAULT 0,
  finance_event_id INTEGER REFERENCES erp_finance_source_events(id),
  journal_id INTEGER REFERENCES erp_journal_headers(id),
  requested_by TEXT,
  requested_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_valuation_exception_worklist
  ON erp_inventory_valuation_exceptions(status,exception_type,requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_open_asset_valuation_exception
  ON erp_inventory_valuation_exceptions(asset_id,exception_type)
  WHERE status='OPEN';

CREATE TABLE IF NOT EXISTS erp_module_submodules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_code TEXT NOT NULL,
  submodule_code TEXT NOT NULL,
  submodule_name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL DEFAULT 10,
  record_type TEXT,
  connected_module_code TEXT,
  posting_event_type TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(module_code,submodule_code)
);
CREATE INDEX IF NOT EXISTS idx_erp_module_submodules
  ON erp_module_submodules(module_code,active,sequence_no);

INSERT OR IGNORE INTO erp_module_submodules(module_code,submodule_code,submodule_name,sequence_no,record_type,connected_module_code,posting_event_type) VALUES
('fa-general-accounting','chart-of-accounts','Chart of Accounts',10,'ACCOUNT',NULL,NULL),
('fa-general-accounting','journal-entry','Journal Entry',20,'JOURNAL',NULL,NULL),
('fa-general-accounting','period-close','Period Close',30,'ACCOUNTING_PERIOD',NULL,NULL),
('fa-general-accounting','general-ledger','General Ledger',40,'REPORT',NULL,NULL),
('fa-receivables-payables','customer-invoice','Customer Invoice',10,'AR_DOCUMENT','sd-order-management','CUSTOMER_INVOICE'),
('fa-receivables-payables','supplier-bill','Supplier Bill',20,'AP_DOCUMENT','ip-sourcing-purchasing','SUPPLIER_BILL'),
('fa-receivables-payables','receipt-application','Receipt Application',30,'RECEIPT',NULL,'CUSTOMER_RECEIPT'),
('fa-receivables-payables','supplier-payment','Supplier Payment',40,'PAYMENT',NULL,'SUPPLIER_PAYMENT'),
('fa-fixed-assets','capitalization','Asset Capitalization',10,'FIXED_ASSET','ip-inventory-analysis','CAPITALIZATION'),
('fa-fixed-assets','depreciation','Depreciation Run',20,'DEPRECIATION',NULL,'DEPRECIATION'),
('fa-fixed-assets','asset-transfer','Asset Transfer',30,'ASSET_TRANSFER','eam-asset-lifecycle',NULL),
('fa-fixed-assets','asset-disposal','Asset Disposal',40,'ASSET_DISPOSAL',NULL,'ASSET_RETIREMENT'),
('sd-crm','lead-opportunity','Lead and Opportunity',10,'OPPORTUNITY',NULL,NULL),
('sd-crm','customer-master','Customer Master',20,'CUSTOMER','sd-customer-portal',NULL),
('sd-crm','activity','Sales Activity',30,'CRM_ACTIVITY',NULL,NULL),
('sd-order-management','quotation','Quotation',10,'QUOTATION','sd-crm',NULL),
('sd-order-management','sales-order','Sales Order',20,'SALES_ORDER','sd-pim',NULL),
('sd-order-management','allocation','Serial Allocation',30,'ALLOCATION','ip-inventory-analysis',NULL),
('sd-order-management','delivery','Delivery and Acceptance',40,'DELIVERY','sd-outbound-logistics','SALE_COGS'),
('sd-order-management','billing','Customer Billing',50,'CUSTOMER_INVOICE','fa-receivables-payables','CUSTOMER_INVOICE'),
('sd-order-management','return-credit','Return and Credit',60,'RETURN','fa-receivables-payables','CUSTOMER_CREDIT'),
('sd-lease-contract-management','lease-contract','Lease Contract',10,'LEASE_CONTRACT','sd-crm',NULL),
('sd-lease-contract-management','annex-units','Annex A Unit Register',20,'LEASE_UNIT','ip-inventory-analysis','CAPITALIZATION'),
('sd-lease-contract-management','billing-schedule','Lease Billing Schedule',30,'LEASE_BILLING','fa-receivables-payables','LEASE_BILLING'),
('sd-lease-contract-management','deposit','Security Deposit',40,'LEASE_DEPOSIT','fa-receivables-payables','LEASE_DEPOSIT'),
('sd-lease-contract-management','return-termination','Return and Termination',50,'LEASE_RETURN','sd-outbound-logistics',NULL),
('sd-warranty-management','warranty-registration','Warranty Registration',10,'WARRANTY',NULL,NULL),
('sd-warranty-management','claim','Warranty Claim',20,'WARRANTY_CLAIM','qm-nonconformance-capa',NULL),
('sd-warranty-management','replacement','Replacement Issue',30,'REPLACEMENT','ip-warehouse-management','WARRANTY_ISSUE'),
('sd-service-management','service-request','Service Request',10,'SERVICE_REQUEST','sd-customer-portal',NULL),
('sd-service-management','work-order','Service Work Order',20,'SERVICE_WORK_ORDER','eam-work-order-management',NULL),
('sd-service-management','parts-issue','Parts Issue',30,'PARTS_ISSUE','ip-warehouse-management','INVENTORY_CONSUMPTION'),
('sd-outbound-logistics','requisition','Requisition Slip',10,'REQUISITION','ip-warehouse-management',NULL),
('sd-outbound-logistics','pre-release','Pre-release and PDI',20,'PRE_RELEASE','qm-inspection-sampling',NULL),
('sd-outbound-logistics','goods-issue','Goods Issue and Gate Pass',30,'GOODS_ISSUE','ip-warehouse-management',NULL),
('sd-outbound-logistics','last-mile','Last-mile Delivery',40,'DELIVERY','sd-order-management',NULL),
('sd-outbound-logistics','proof-return','Proof of Delivery and Return',50,'POD_RETURN','ip-warehouse-management',NULL),
('ip-sourcing-purchasing','purchase-requisition','Purchase Requisition',10,'PURCHASE_REQUISITION',NULL,NULL),
('ip-sourcing-purchasing','rfq-vendor-quote','RFQ and Vendor Quotations',20,'RFQ','ip-supplier-portal',NULL),
('ip-sourcing-purchasing','purchase-order','Purchase Order',30,'PURCHASE_ORDER','ip-inbound-logistics',NULL),
('ip-sourcing-purchasing','goods-receipt','Goods Receipt',40,'GOODS_RECEIPT','ip-inbound-logistics','GOODS_RECEIPT'),
('ip-sourcing-purchasing','supplier-bill','Supplier Bill Matching',50,'SUPPLIER_BILL','fa-receivables-payables','SUPPLIER_BILL'),
('ip-inbound-logistics','manifest','ATLAS Supplier Manifest',10,'EXPECTED_MANIFEST','ip-supplier-portal',NULL),
('ip-inbound-logistics','shipment','STELLAR Shipment',20,'SHIPMENT','ip-sourcing-purchasing',NULL),
('ip-inbound-logistics','customs-freight','Customs, Freight and Charges',30,'LANDED_COST',NULL,'LANDED_COST'),
('ip-inbound-logistics','receiving','Goods Receipt and Serial Match',40,'RECEIPT','ip-warehouse-management','GOODS_RECEIPT'),
('ip-inbound-logistics','putaway','Putaway and Quarantine',50,'PUTAWAY','qm-inspection-sampling',NULL),
('ip-warehouse-management','goods-issuance','Goods Issuance Slip',10,'GOODS_ISSUE','sd-outbound-logistics',NULL),
('ip-warehouse-management','goods-return','Goods Return Form',20,'GOODS_RETURN','sd-outbound-logistics',NULL),
('ip-warehouse-management','gate-pass','Gate Pass',30,'GATE_PASS','sd-outbound-logistics',NULL),
('ip-warehouse-management','stock-transfer','Stock Transfer Order',40,'STOCK_TRANSFER','ip-inventory-analysis',NULL),
('ip-warehouse-management','repair-quarantine','Repair and Quarantine',50,'REPAIR_QUARANTINE','qm-nonconformance-capa',NULL),
('ip-cycle-counting','count-plan','Cycle Count Plan',10,'COUNT_PLAN','ip-inventory-analysis',NULL),
('ip-cycle-counting','count-entry','Count Entry',20,'COUNT_ENTRY',NULL,NULL),
('ip-cycle-counting','variance-approval','Variance Approval',30,'COUNT_VARIANCE','fa-general-accounting','CYCLE_COUNT_ADJUSTMENT'),
('ip-inventory-analysis','serial-availability','Serial Availability',10,'INVENTORY_VISIBILITY','sd-order-management',NULL),
('ip-inventory-analysis','valuation','Inventory Valuation',20,'INVENTORY_VALUATION','fa-general-accounting',NULL),
('ip-inventory-analysis','aging-reorder','Aging and Reorder',30,'INVENTORY_ANALYSIS','sd-demand-planning',NULL),
('ip-inventory-analysis','reconciliation','Inventory to GL Reconciliation',40,'RECONCILIATION','fa-general-accounting',NULL),
('qm-inspection-sampling','incoming-inspection','Incoming Inspection',10,'QUALITY_INSPECTION','ip-inbound-logistics',NULL),
('qm-inspection-sampling','pre-delivery-inspection','Pre-delivery Inspection',20,'PDI','sd-outbound-logistics',NULL),
('qm-inspection-sampling','accept-reject','Acceptance and Rejection',30,'QUALITY_DECISION','ip-warehouse-management',NULL),
('qm-nonconformance-capa','nonconformance','Nonconformance',10,'NONCONFORMANCE',NULL,NULL),
('qm-nonconformance-capa','capa','Corrective and Preventive Action',20,'CAPA','eam-work-order-management',NULL),
('eam-work-order-management','maintenance-request','Maintenance Request',10,'MAINTENANCE_REQUEST',NULL,NULL),
('eam-work-order-management','work-order','Work Order',20,'WORK_ORDER','ip-warehouse-management',NULL),
('eam-work-order-management','parts-labor','Parts and Labor',30,'WORK_COST','fa-general-accounting','INVENTORY_CONSUMPTION'),
('hcm-payroll','payroll-input','Payroll Input',10,'PAYROLL_INPUT',NULL,NULL),
('hcm-payroll','payroll-run','Payroll Run',20,'PAYROLL_RUN','fa-general-accounting','PAYROLL'),
('hcm-payroll','payslip-government','Payslip and Government Reports',30,'PAYROLL_REPORT',NULL,NULL);

-- Controlled provisional standard costs from the E88 financial model.
-- They are applied only where the item description clearly identifies the model/asset class.
UPDATE erp_items SET standard_cost=83137.60,updated_at=datetime('now')
WHERE standard_cost=0 AND item_code LIKE 'MC-%' AND UPPER(item_name) LIKE '%D400%';
UPDATE erp_items SET standard_cost=45487.12,updated_at=datetime('now')
WHERE standard_cost=0 AND item_code LIKE 'MC-%' AND UPPER(item_name) LIKE '%R280%';
UPDATE erp_items SET standard_cost=24695.61,updated_at=datetime('now')
WHERE standard_cost=0 AND category='BAT' AND UPPER(item_name) LIKE 'RIDEBOX BATTERY%'
  AND UPPER(item_name) NOT LIKE '%CHARGER%';
UPDATE erp_items SET standard_cost=113257.77,updated_at=datetime('now')
WHERE standard_cost=0 AND (
  item_code='ESP00262' OR
  (item_code LIKE 'BSS-%' AND (UPPER(item_name) LIKE '%RIDEBOX LOCKER%' OR UPPER(item_name) LIKE '%SWAPPING STATION%'))
);

UPDATE erp_assets
SET unit_cost=(SELECT i.standard_cost FROM erp_items i WHERE i.id=erp_assets.item_id),
    acquisition_cost=(SELECT i.standard_cost FROM erp_items i WHERE i.id=erp_assets.item_id),
    cost_source='FINANCIAL_MODEL_STANDARD_2026',valuation_status='PROVISIONAL_STANDARD',
    landed_cost=(SELECT i.standard_cost FROM erp_items i WHERE i.id=erp_assets.item_id),
    updated_at=datetime('now')
WHERE unit_cost=0 AND item_id IN (SELECT id FROM erp_items WHERE standard_cost>0);

UPDATE erp_assets
SET acquisition_cost=CASE WHEN acquisition_cost=0 THEN unit_cost ELSE acquisition_cost END,
    landed_cost=CASE WHEN landed_cost=0 THEN unit_cost ELSE landed_cost END,
    cost_source=CASE WHEN unit_cost>0 AND cost_source='UNVALUED' THEN 'OPENING_DATA' ELSE cost_source END,
    valuation_status=CASE WHEN unit_cost>0 AND valuation_status='UNVALUED' THEN 'VALUED' ELSE valuation_status END
WHERE unit_cost>0;

INSERT OR IGNORE INTO erp_inventory_valuation_exceptions(
  asset_id,item_id,serial_no,item_code,exception_type,exception_message,requested_by
)
SELECT a.id,a.item_id,a.serial_no,a.item_code,'MISSING_UNIT_COST',
  'No approved actual or controlled standard unit cost is available. Financial issue or capitalization is blocked until resolved.',
  'system-migration'
FROM erp_assets a
WHERE a.active=1 AND a.unit_cost<=0;

-- Create the valuation uplift opening journal after controlled standard costs are loaded.
INSERT OR IGNORE INTO erp_journal_headers(
  journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,
  source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,
  status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at
)
SELECT 'JE-OPENING-VALUATION-V12',e.id,date('now'),p.id,'OPENING','FINANCE','CUTOVER_VALUATION',
  'VALUATION-V12','FINANCE_CUTOVER_VALUATION_V12',
  'Controlled provisional valuation of opening serialized inventory','PHP',1,v.total,v.total,
  'POSTED','system-cutover','system-cutover',datetime('now'),'system-cutover',datetime('now'),
  'system-cutover',datetime('now')
FROM erp_legal_entities e
JOIN erp_accounting_periods p ON p.entity_id=e.id
  AND p.fiscal_year=CAST(strftime('%Y','now') AS INTEGER)
  AND p.period_no=CAST(strftime('%m','now') AS INTEGER)
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) total
  FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND unit_cost>0
) v
WHERE e.entity_code='E88' AND v.total>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,1,a.id,'Provisional motorcycles and other serialized inventory',v.amount,0,v.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1200'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND unit_cost>0
    AND UPPER(COALESCE(category,'')) NOT IN ('BAT','BSS')
) v
WHERE h.source_event_key='FINANCE_CUTOVER_VALUATION_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,2,a.id,'Provisional batteries and BSS inventory',v.amount,0,v.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1220'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF') AND unit_cost>0
    AND UPPER(COALESCE(category,'')) IN ('BAT','BSS')
) v
WHERE h.source_event_key='FINANCE_CUTOVER_VALUATION_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,3,a.id,'Opening valuation conversion equity',0,h.total_credit,0,h.total_credit
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='3100'
WHERE h.source_event_key='FINANCE_CUTOVER_VALUATION_V12';

INSERT OR IGNORE INTO erp_finance_source_events(
  event_key,event_type,source_module,source_type,source_no,event_date,entity_code,
  amount,currency,payload_json,financial_effect,status,journal_id,captured_by,processed_by,processed_at
)
SELECT 'FINANCE_CUTOVER_VALUATION_V12','OPENING_INVENTORY','FINANCE','CUTOVER_VALUATION',
  'VALUATION-V12',h.journal_date,'E88',h.total_debit,'PHP',
  '{"source":"financial_model_standard_2026","valuation_status":"provisional"}',
  'ACCOUNTING','POSTED',h.id,'system-cutover','system-cutover',datetime('now')
FROM erp_journal_headers h WHERE h.source_event_key='FINANCE_CUTOVER_VALUATION_V12';

-- Historical assets explicitly marked LEASED are reclassified to the fixed-asset subledger.
INSERT OR IGNORE INTO erp_journal_headers(
  journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,
  source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,
  status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at
)
SELECT 'JE-LEASE-FLEET-CUTOVER-V12',e.id,date('now'),p.id,'RECLASSIFICATION','FIXED_ASSETS','LEASE_FLEET_CUTOVER',
  'LEASE-FLEET-V12','LEASE_FLEET_CUTOVER_V12','Reclassify historical leased serials from inventory to lease fleet','PHP',1,v.total,v.total,
  'POSTED','system-cutover','system-cutover',datetime('now'),'system-cutover',datetime('now'),'system-cutover',datetime('now')
FROM erp_legal_entities e
JOIN erp_accounting_periods p ON p.entity_id=e.id
  AND p.fiscal_year=CAST(strftime('%Y','now') AS INTEGER)
  AND p.period_no=CAST(strftime('%m','now') AS INTEGER)
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) total FROM erp_assets
  WHERE active=1 AND current_status='LEASED' AND unit_cost>0 AND category IN ('MC','BAT','BSS','CHG')
) v
WHERE e.entity_code='E88' AND v.total>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,1,a.id,'Motorcycles, batteries and charging equipment held for lease',v.amount,0,v.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1310'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status='LEASED' AND unit_cost>0 AND category IN ('MC','BAT','CHG')
) v
WHERE h.source_event_key='LEASE_FLEET_CUTOVER_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,2,a.id,'RideBox and battery swapping equipment in service',v.amount,0,v.amount,0
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1320'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status='LEASED' AND unit_cost>0 AND category='BSS'
) v
WHERE h.source_event_key='LEASE_FLEET_CUTOVER_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,3,a.id,'Remove motorcycles and other lease units from inventory',0,v.amount,0,v.amount
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1200'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status='LEASED' AND unit_cost>0 AND category IN ('MC','CHG')
) v
WHERE h.source_event_key='LEASE_FLEET_CUTOVER_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,4,a.id,'Remove batteries and BSS lease units from inventory',0,v.amount,0,v.amount
FROM erp_journal_headers h JOIN erp_chart_accounts a ON a.account_code='1220'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status='LEASED' AND unit_cost>0 AND category IN ('BAT','BSS')
) v
WHERE h.source_event_key='LEASE_FLEET_CUTOVER_V12' AND v.amount>0;

INSERT OR IGNORE INTO erp_finance_source_events(
  event_key,event_type,source_module,source_type,source_no,event_date,entity_code,
  amount,currency,payload_json,financial_effect,status,journal_id,captured_by,processed_by,processed_at
)
SELECT 'LEASE_FLEET_CUTOVER_V12','CAPITALIZATION','FIXED_ASSETS','LEASE_FLEET_CUTOVER',
  'LEASE-FLEET-V12',h.journal_date,'E88',h.total_debit,'PHP','{"source":"historical_leased_serials"}',
  'ACCOUNTING','POSTED',h.id,'system-cutover','system-cutover',datetime('now')
FROM erp_journal_headers h WHERE h.source_event_key='LEASE_FLEET_CUTOVER_V12';

INSERT OR IGNORE INTO erp_fixed_asset_books(
  asset_id,entity_id,asset_class,capitalization_date,acquisition_cost,residual_value,useful_life_months,
  depreciation_method,accumulated_depreciation,net_book_value,asset_account_code,
  accumulated_depreciation_account_code,depreciation_expense_account_code,status,created_by,
  capitalization_event_id,capitalization_journal_id,ownership_status
)
SELECT a.id,e.id,
  CASE a.category WHEN 'BSS' THEN 'BSS_AND_RIDEBOX_EQUIPMENT'
    WHEN 'BAT' THEN 'LEASE_BATTERY_POOL' WHEN 'CHG' THEN 'CHARGING_EQUIPMENT'
    ELSE 'MOTORCYCLES_HELD_FOR_LEASE' END,
  COALESCE(substr(a.updated_at,1,10),date('now')),a.unit_cost,0,
  CASE WHEN a.category='BSS' THEN 60 ELSE 36 END,'STRAIGHT_LINE',0,a.unit_cost,
  CASE WHEN a.category='BSS' THEN '1320' ELSE '1310' END,'1390','6800','ACTIVE','system-cutover',
  fe.id,h.id,'COMPANY_OWNED'
FROM erp_assets a
JOIN erp_legal_entities e ON e.entity_code='E88'
JOIN erp_journal_headers h ON h.source_event_key='LEASE_FLEET_CUTOVER_V12'
JOIN erp_finance_source_events fe ON fe.event_key='LEASE_FLEET_CUTOVER_V12'
WHERE a.active=1 AND a.current_status='LEASED' AND a.unit_cost>0 AND a.category IN ('MC','BAT','BSS','CHG');

UPDATE erp_assets SET capitalization_status='CAPITALIZED',placed_in_service_date=COALESCE(placed_in_service_date,substr(updated_at,1,10))
WHERE id IN (SELECT asset_id FROM erp_fixed_asset_books);

-- Replace the legacy landed-cost payable rule and publish the connected operational posting map.
DELETE FROM erp_posting_rules WHERE event_type IN (
  'LANDED_COST','LEASE_BILLING','SALES_RETURN_INVENTORY','CAPITALIZATION',
  'INVENTORY_CONSUMPTION','WARRANTY_ISSUE','DONATION_ISSUE','CUSTOMER_CREDIT',
  'LEASE_DEPOSIT','ASSET_RETIREMENT','INVENTORY_VALUATION_ADJUSTMENT'
);
INSERT OR REPLACE INTO erp_posting_rules(event_type,line_role,account_code,debit_credit,amount_basis,priority) VALUES
('LANDED_COST','INVENTORY','1200','DEBIT','COST',10),
('LANDED_COST','LANDED_COST_ACCRUAL','2060','CREDIT','COST',20),
('LEASE_BILLING','RECEIVABLE','1100','DEBIT','GROSS',10),
('LEASE_BILLING','REVENUE','4010','CREDIT','NET',20),
('LEASE_BILLING','OUTPUT_VAT','2100','CREDIT','TAX',30),
('SALES_RETURN_INVENTORY','INVENTORY_RETURN','1200','DEBIT','COST',10),
('SALES_RETURN_INVENTORY','COGS_REVERSAL','5000','CREDIT','COST',20),
('CAPITALIZATION','FIXED_ASSET','1310','DEBIT','COST',10),
('CAPITALIZATION','INVENTORY','1200','CREDIT','COST',20),
('INVENTORY_CONSUMPTION','CONSUMPTION_EXPENSE','6990','DEBIT','COST',10),
('INVENTORY_CONSUMPTION','INVENTORY','1200','CREDIT','COST',20),
('WARRANTY_ISSUE','WARRANTY_EXPENSE','6500','DEBIT','COST',10),
('WARRANTY_ISSUE','INVENTORY','1200','CREDIT','COST',20),
('DONATION_ISSUE','DONATION_EXPENSE','6990','DEBIT','COST',10),
('DONATION_ISSUE','INVENTORY','1200','CREDIT','COST',20),
('CUSTOMER_CREDIT','REVENUE_REVERSAL','4000','DEBIT','NET',10),
('CUSTOMER_CREDIT','OUTPUT_VAT_REVERSAL','2100','DEBIT','TAX',20),
('CUSTOMER_CREDIT','RECEIVABLE','1100','CREDIT','GROSS',30),
('LEASE_DEPOSIT','BANK','1010','DEBIT','GROSS',10),
('LEASE_DEPOSIT','CUSTOMER_DEPOSIT','2250','CREDIT','GROSS',20),
('ASSET_RETIREMENT','ACCUMULATED_DEPRECIATION_CLEARING','1390','DEBIT','GROSS',10),
('ASSET_RETIREMENT','RETIREMENT_LOSS','6900','DEBIT','COST',20),
('ASSET_RETIREMENT','FIXED_ASSET','1310','CREDIT','GROSS',30),
('INVENTORY_VALUATION_ADJUSTMENT','INVENTORY','1200','DEBIT','COST',10),
('INVENTORY_VALUATION_ADJUSTMENT','VALUATION_VARIANCE','6900','CREDIT','COST',20);

CREATE VIEW IF NOT EXISTS vw_erp_inventory_valuation_status AS
SELECT a.id,a.active,a.asset_no,a.serial_no,a.item_code,a.item_name,a.category,a.current_status,
  a.current_location_code,a.current_holder_type,a.current_holder_name,a.unit_cost,a.acquisition_cost,
  a.freight_cost,a.duty_cost,a.other_landed_cost,a.landed_cost,a.cost_source,a.valuation_status,
  a.capitalization_status,f.id fixed_asset_book_id,f.asset_class,f.net_book_value,
  CASE WHEN a.unit_cost<=0 THEN 'BLOCKED_MISSING_COST'
       WHEN a.valuation_status='PROVISIONAL_STANDARD' THEN 'PROVISIONAL_REVIEW_REQUIRED'
       WHEN f.id IS NOT NULL THEN 'FIXED_ASSET'
       ELSE 'INVENTORY' END finance_readiness
FROM erp_assets a
LEFT JOIN erp_fixed_asset_books f ON f.asset_id=a.id;

CREATE VIEW IF NOT EXISTS vw_erp_operational_finance_reconciliation AS
SELECT
  (SELECT COUNT(*) FROM erp_assets WHERE active=1) serialized_assets,
  (SELECT COUNT(*) FROM erp_assets WHERE active=1 AND unit_cost>0) valued_assets,
  (SELECT COUNT(*) FROM erp_assets WHERE active=1 AND unit_cost<=0) unvalued_assets,
  (SELECT ROUND(COALESCE(SUM(unit_cost),0),2) FROM erp_assets a
    WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF')
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)) inventory_subledger,
  (SELECT ROUND(COALESCE(SUM(debit-credit),0),2) FROM vw_erp_general_ledger
    WHERE account_code IN ('1200','1210','1220')) inventory_general_ledger,
  (SELECT ROUND(COALESCE(SUM(net_book_value),0),2) FROM erp_fixed_asset_books WHERE status IN ('ACTIVE','PENDING_APPROVAL')) fixed_asset_subledger,
  (SELECT ROUND(COALESCE(SUM(debit-credit),0),2) FROM vw_erp_general_ledger
    WHERE account_code IN ('1300','1310','1320','1390')) fixed_asset_general_ledger,
  (SELECT COUNT(*) FROM erp_finance_source_events WHERE status='ERROR') posting_errors,
  (SELECT COUNT(*) FROM erp_inventory_valuation_exceptions WHERE status='OPEN') open_valuation_exceptions;

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('APP_VERSION','12.0.0-operational-finance',datetime('now')),
('SYSTEM_BUILD_MODE','FULL_INTERCONNECTED_ERP_WITH_PURPOSE_BASED_POSTING',datetime('now')),
('INVENTORY_VALUATION_POLICY','ACTUAL_COST_FIRST_CONTROLLED_STANDARD_COST_PROVISIONAL_BLOCK_ZERO_COST_POSTING',datetime('now')),
('LEASE_ASSET_POLICY','COMPANY_OWNED_SERIALS_CAPITALIZED_AND_DEPRECIATED',datetime('now')),
('SUBMODULE_POLICY','MODULES_DECOMPOSED_INTO_CONNECTED_TRANSACTIONAL_SUBMODULES',datetime('now'));
