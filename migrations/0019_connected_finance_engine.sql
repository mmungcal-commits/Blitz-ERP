-- E88 Enterprise System v10.0
-- Connected finance, accounting, tax, treasury, fixed-asset and reporting engine.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_legal_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_code TEXT NOT NULL UNIQUE,
  entity_name TEXT NOT NULL,
  tax_id TEXT,
  registration_no TEXT,
  base_currency TEXT NOT NULL DEFAULT 'PHP',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_chart_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_code TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  financial_statement TEXT NOT NULL,
  normal_balance TEXT NOT NULL,
  parent_account_code TEXT,
  control_type TEXT NOT NULL DEFAULT 'NONE',
  cash_flow_group TEXT,
  system_account INTEGER NOT NULL DEFAULT 0,
  allow_manual_posting INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_chart_accounts_type
  ON erp_chart_accounts(account_type,active);

CREATE TABLE IF NOT EXISTS erp_accounting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  fiscal_year INTEGER NOT NULL,
  period_no INTEGER NOT NULL,
  period_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  soft_closed_by TEXT,
  soft_closed_at TEXT,
  closed_by TEXT,
  closed_at TEXT,
  reopened_by TEXT,
  reopened_at TEXT,
  UNIQUE(entity_id,fiscal_year,period_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_accounting_period_dates
  ON erp_accounting_periods(entity_id,start_date,end_date,status);

CREATE TABLE IF NOT EXISTS erp_tax_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_code TEXT NOT NULL UNIQUE,
  tax_name TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  account_code TEXT NOT NULL REFERENCES erp_chart_accounts(account_code),
  recoverable INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT,
  effective_to TEXT
);

CREATE TABLE IF NOT EXISTS erp_journal_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_no TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  journal_date TEXT NOT NULL,
  period_id INTEGER REFERENCES erp_accounting_periods(id),
  journal_type TEXT NOT NULL DEFAULT 'GENERAL',
  source_module TEXT NOT NULL DEFAULT 'FINANCE',
  source_type TEXT,
  source_id INTEGER,
  source_no TEXT,
  source_event_key TEXT UNIQUE,
  description TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  exchange_rate REAL NOT NULL DEFAULT 1,
  total_debit REAL NOT NULL DEFAULT 0,
  total_credit REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  reversal_of_id INTEGER REFERENCES erp_journal_headers(id),
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  submitted_by TEXT,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  posted_by TEXT,
  posted_at TEXT,
  reversed_by TEXT,
  reversed_at TEXT,
  voided_by TEXT,
  voided_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_journal_period
  ON erp_journal_headers(entity_id,journal_date,status);
CREATE INDEX IF NOT EXISTS idx_erp_journal_source
  ON erp_journal_headers(source_type,source_no,status);

CREATE TABLE IF NOT EXISTS erp_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES erp_journal_headers(id),
  line_no INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES erp_chart_accounts(id),
  partner_id INTEGER REFERENCES erp_partners(id),
  department TEXT,
  cost_center TEXT,
  business_line TEXT,
  project_code TEXT,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  base_debit REAL NOT NULL DEFAULT 0,
  base_credit REAL NOT NULL DEFAULT 0,
  tax_code_id INTEGER REFERENCES erp_tax_codes(id),
  tax_base REAL NOT NULL DEFAULT 0,
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  item_id INTEGER REFERENCES erp_items(id),
  due_date TEXT,
  UNIQUE(journal_id,line_no)
);
CREATE INDEX IF NOT EXISTS idx_erp_journal_lines_account
  ON erp_journal_lines(account_id,journal_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_lines_partner
  ON erp_journal_lines(partner_id,due_date);
CREATE INDEX IF NOT EXISTS idx_erp_journal_lines_serial
  ON erp_journal_lines(serial_no);

CREATE TABLE IF NOT EXISTS erp_finance_source_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  source_no TEXT,
  event_date TEXT NOT NULL,
  entity_code TEXT NOT NULL DEFAULT 'E88',
  partner_id INTEGER REFERENCES erp_partners(id),
  department TEXT,
  cost_center TEXT,
  business_line TEXT,
  amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  payload_json TEXT NOT NULL DEFAULT '{}',
  financial_effect TEXT NOT NULL DEFAULT 'ACCOUNTING',
  status TEXT NOT NULL DEFAULT 'CAPTURED',
  journal_id INTEGER REFERENCES erp_journal_headers(id),
  error_message TEXT,
  captured_by TEXT,
  captured_at TEXT DEFAULT (datetime('now')),
  processed_by TEXT,
  processed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_finance_events_worklist
  ON erp_finance_source_events(status,event_type,event_date);
CREATE INDEX IF NOT EXISTS idx_erp_finance_events_source
  ON erp_finance_source_events(source_type,source_no);

CREATE TABLE IF NOT EXISTS erp_posting_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  line_role TEXT NOT NULL,
  account_code TEXT NOT NULL REFERENCES erp_chart_accounts(account_code),
  debit_credit TEXT NOT NULL,
  amount_basis TEXT NOT NULL DEFAULT 'NET',
  priority INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event_type,line_role)
);

CREATE TABLE IF NOT EXISTS erp_subledger_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_no TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  document_type TEXT NOT NULL,
  partner_id INTEGER NOT NULL REFERENCES erp_partners(id),
  document_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'PHP',
  exchange_rate REAL NOT NULL DEFAULT 1,
  gross_amount REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  withholding_amount REAL NOT NULL DEFAULT 0,
  open_balance REAL NOT NULL DEFAULT 0,
  department TEXT,
  cost_center TEXT,
  business_line TEXT,
  source_type TEXT,
  source_id INTEGER,
  source_no TEXT,
  journal_id INTEGER REFERENCES erp_journal_headers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  posted_by TEXT,
  posted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_subledger_partner
  ON erp_subledger_documents(partner_id,document_type,status,due_date);

CREATE TABLE IF NOT EXISTS erp_subledger_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_document_id INTEGER NOT NULL REFERENCES erp_subledger_documents(id),
  applied_document_id INTEGER NOT NULL REFERENCES erp_subledger_documents(id),
  application_date TEXT NOT NULL,
  amount REAL NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(payment_document_id,applied_document_id)
);

CREATE TABLE IF NOT EXISTS erp_payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  request_date TEXT NOT NULL,
  requestor_email TEXT NOT NULL,
  payee_partner_id INTEGER REFERENCES erp_partners(id),
  payee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  cost_center TEXT,
  project_code TEXT,
  purpose TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'SUPPLIER_PAYMENT',
  purchase_order_id INTEGER REFERENCES erp_purchase_orders(id),
  purchase_order_no TEXT,
  supplier_invoice_no TEXT,
  invoice_date TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  withholding_amount REAL NOT NULL DEFAULT 0,
  net_payable REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  payment_method TEXT,
  bank_account_id INTEGER REFERENCES erp_bank_accounts(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  department_approved_by TEXT,
  department_approved_at TEXT,
  finance_validated_by TEXT,
  finance_validated_at TEXT,
  final_approved_by TEXT,
  final_approved_at TEXT,
  paid_by TEXT,
  paid_at TEXT,
  payment_reference TEXT,
  supplier_bill_id INTEGER REFERENCES erp_subledger_documents(id),
  payment_document_id INTEGER REFERENCES erp_subledger_documents(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_erp_payment_requests_worklist
  ON erp_payment_requests(status,due_date,department);

CREATE TABLE IF NOT EXISTS erp_bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_code TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number_masked TEXT,
  currency TEXT NOT NULL DEFAULT 'PHP',
  gl_account_id INTEGER NOT NULL REFERENCES erp_chart_accounts(id),
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES erp_bank_accounts(id),
  transaction_date TEXT NOT NULL,
  value_date TEXT,
  bank_reference TEXT,
  description TEXT,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  running_balance REAL,
  import_batch TEXT,
  status TEXT NOT NULL DEFAULT 'UNMATCHED',
  matched_journal_line_id INTEGER REFERENCES erp_journal_lines(id),
  matched_by TEXT,
  matched_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(bank_account_id,transaction_date,bank_reference,amount,direction)
);
CREATE INDEX IF NOT EXISTS idx_erp_bank_transactions_status
  ON erp_bank_transactions(bank_account_id,status,transaction_date);

CREATE TABLE IF NOT EXISTS erp_bank_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reconciliation_no TEXT NOT NULL UNIQUE,
  bank_account_id INTEGER NOT NULL REFERENCES erp_bank_accounts(id),
  statement_date TEXT NOT NULL,
  statement_ending_balance REAL NOT NULL DEFAULT 0,
  book_ending_balance REAL NOT NULL DEFAULT 0,
  outstanding_deposits REAL NOT NULL DEFAULT 0,
  outstanding_payments REAL NOT NULL DEFAULT 0,
  adjustments REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  review_notes TEXT,
  prepared_by TEXT NOT NULL,
  prepared_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS erp_fixed_asset_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL UNIQUE REFERENCES erp_assets(id),
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  asset_class TEXT NOT NULL,
  capitalization_date TEXT NOT NULL,
  acquisition_cost REAL NOT NULL DEFAULT 0,
  residual_value REAL NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL DEFAULT 36,
  depreciation_method TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  accumulated_depreciation REAL NOT NULL DEFAULT 0,
  net_book_value REAL NOT NULL DEFAULT 0,
  asset_account_code TEXT NOT NULL REFERENCES erp_chart_accounts(account_code),
  accumulated_depreciation_account_code TEXT NOT NULL REFERENCES erp_chart_accounts(account_code),
  depreciation_expense_account_code TEXT NOT NULL REFERENCES erp_chart_accounts(account_code),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_depreciation_date TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS erp_depreciation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_no TEXT NOT NULL UNIQUE,
  entity_id INTEGER NOT NULL REFERENCES erp_legal_entities(id),
  period_id INTEGER NOT NULL REFERENCES erp_accounting_periods(id),
  run_date TEXT NOT NULL,
  total_depreciation REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  journal_id INTEGER REFERENCES erp_journal_headers(id),
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  posted_by TEXT,
  posted_at TEXT,
  UNIQUE(entity_id,period_id)
);

CREATE TABLE IF NOT EXISTS erp_depreciation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  depreciation_run_id INTEGER NOT NULL REFERENCES erp_depreciation_runs(id),
  fixed_asset_book_id INTEGER NOT NULL REFERENCES erp_fixed_asset_books(id),
  asset_id INTEGER NOT NULL REFERENCES erp_assets(id),
  depreciation_amount REAL NOT NULL,
  accumulated_after REAL NOT NULL,
  net_book_value_after REAL NOT NULL,
  UNIQUE(depreciation_run_id,fixed_asset_book_id)
);

CREATE TABLE IF NOT EXISTS erp_finance_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_no TEXT NOT NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  requested_by TEXT NOT NULL,
  requested_at TEXT DEFAULT (datetime('now')),
  decided_by TEXT,
  decided_at TEXT,
  decision_notes TEXT,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_finance_changes_worklist
  ON erp_finance_change_requests(status,target_type,requested_at);

CREATE TABLE IF NOT EXISTS erp_financial_report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL UNIQUE,
  report_type TEXT NOT NULL,
  entity_code TEXT NOT NULL,
  date_from TEXT,
  date_to TEXT,
  department TEXT,
  cost_center TEXT,
  business_line TEXT,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  generated_by TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS vw_erp_general_ledger AS
SELECT
  h.id journal_id,h.journal_no,h.journal_date,h.journal_type,h.source_module,h.source_type,
  h.source_no,h.description journal_description,h.currency,h.exchange_rate,h.status,
  e.entity_code,e.entity_name,l.line_no,a.account_code,a.account_name,a.account_type,
  l.partner_id,p.name partner_name,l.department,l.cost_center,l.business_line,l.project_code,
  l.description line_description,l.base_debit debit,l.base_credit credit,
  l.asset_id,l.serial_no,l.item_id
FROM erp_journal_headers h
JOIN erp_legal_entities e ON e.id=h.entity_id
JOIN erp_journal_lines l ON l.journal_id=h.id
JOIN erp_chart_accounts a ON a.id=l.account_id
LEFT JOIN erp_partners p ON p.id=l.partner_id
WHERE h.status='POSTED';

CREATE VIEW IF NOT EXISTS vw_erp_trial_balance AS
SELECT
  entity_code,account_code,account_name,account_type,
  SUM(debit) total_debit,SUM(credit) total_credit,
  SUM(debit-credit) debit_less_credit
FROM vw_erp_general_ledger
GROUP BY entity_code,account_code,account_name,account_type;

CREATE VIEW IF NOT EXISTS vw_erp_inventory_gl_reconciliation AS
SELECT
  COALESCE((SELECT SUM(CASE WHEN a.active=1 AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
    AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id)
    THEN a.unit_cost ELSE 0 END) FROM erp_assets a),0) inventory_subledger,
  COALESCE((SELECT SUM(debit-credit) FROM vw_erp_general_ledger
    WHERE account_code IN ('1200','1210','1220')),0) inventory_general_ledger;

INSERT OR IGNORE INTO erp_legal_entities(entity_code,entity_name,base_currency) VALUES
('E88','E88 Ventures, Inc.','PHP'),
('NRD','NRD Motorcycle Business','PHP'),
('RIDEBOX','RideBox Battery Swapping Business','PHP'),
('SHARED','E88 Shared Services','PHP');

INSERT OR IGNORE INTO erp_chart_accounts(
  account_code,account_name,account_type,financial_statement,normal_balance,
  parent_account_code,control_type,cash_flow_group,system_account,allow_manual_posting
) VALUES
('1000','Cash and Cash Equivalents','ASSET','BALANCE_SHEET','DEBIT',NULL,'BANK','OPERATING',1,0),
('1010','Operating Bank Account','ASSET','BALANCE_SHEET','DEBIT','1000','BANK','OPERATING',1,0),
('1100','Accounts Receivable','ASSET','BALANCE_SHEET','DEBIT',NULL,'AR','OPERATING',1,0),
('1150','Input VAT','ASSET','BALANCE_SHEET','DEBIT',NULL,'TAX','OPERATING',1,0),
('1160','Creditable Withholding Tax','ASSET','BALANCE_SHEET','DEBIT',NULL,'TAX','OPERATING',1,0),
('1200','Inventory - Motorcycles and Parts','ASSET','BALANCE_SHEET','DEBIT',NULL,'INVENTORY','OPERATING',1,0),
('1210','Inventory in Transit','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1220','Inventory - Batteries and BSS','ASSET','BALANCE_SHEET','DEBIT','1200','INVENTORY','OPERATING',1,0),
('1250','Advances and Prepayments','ASSET','BALANCE_SHEET','DEBIT',NULL,'ADVANCE','OPERATING',1,0),
('1300','Property and Equipment','ASSET','BALANCE_SHEET','DEBIT',NULL,'FIXED_ASSET','INVESTING',1,0),
('1310','Motorcycles Held for Lease','ASSET','BALANCE_SHEET','DEBIT','1300','FIXED_ASSET','INVESTING',1,0),
('1320','BSS and RideBox Equipment','ASSET','BALANCE_SHEET','DEBIT','1300','FIXED_ASSET','INVESTING',1,0),
('1390','Accumulated Depreciation','CONTRA_ASSET','BALANCE_SHEET','CREDIT','1300','FIXED_ASSET','INVESTING',1,0),
('2000','Accounts Payable','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'AP','OPERATING',1,0),
('2050','Goods Received Not Invoiced','LIABILITY','BALANCE_SHEET','CREDIT','2000','GRNI','OPERATING',1,0),
('2100','Output VAT','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'TAX','OPERATING',1,0),
('2110','Expanded Withholding Tax Payable','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'TAX','OPERATING',1,0),
('2120','Withholding Tax on Compensation','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'TAX','OPERATING',1,0),
('2200','Accrued Expenses and Other Payables','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'ACCRUAL','OPERATING',1,0),
('2300','Loans and Credit Facilities','LIABILITY','BALANCE_SHEET','CREDIT',NULL,'LOAN','FINANCING',1,0),
('3000','Share Capital','EQUITY','BALANCE_SHEET','CREDIT',NULL,'NONE','FINANCING',1,1),
('3100','Retained Earnings','EQUITY','BALANCE_SHEET','CREDIT',NULL,'NONE','OPERATING',1,0),
('4000','Motorcycle Sales Revenue','REVENUE','INCOME_STATEMENT','CREDIT',NULL,'REVENUE','OPERATING',1,0),
('4010','Lease Revenue','REVENUE','INCOME_STATEMENT','CREDIT',NULL,'REVENUE','OPERATING',1,0),
('4020','Energy and Battery Swap Revenue','REVENUE','INCOME_STATEMENT','CREDIT',NULL,'REVENUE','OPERATING',1,0),
('4030','Aftersales and Service Revenue','REVENUE','INCOME_STATEMENT','CREDIT',NULL,'REVENUE','OPERATING',1,0),
('4040','Other Operating Revenue','REVENUE','INCOME_STATEMENT','CREDIT',NULL,'REVENUE','OPERATING',1,0),
('5000','Cost of Motorcycles Sold','COGS','INCOME_STATEMENT','DEBIT',NULL,'COGS','OPERATING',1,0),
('5010','Cost of Parts and Aftersales','COGS','INCOME_STATEMENT','DEBIT',NULL,'COGS','OPERATING',1,0),
('5020','Energy and Battery Swap Cost','COGS','INCOME_STATEMENT','DEBIT',NULL,'COGS','OPERATING',1,0),
('6000','Payroll and Employee Benefits','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6100','Rent and Occupancy','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6200','Utilities and Communications','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6300','Professional and Outside Services','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6400','Transportation and Logistics','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6500','Repairs and Maintenance','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6600','Taxes and Licenses','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1),
('6700','Interest and Bank Charges','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','FINANCING',1,1),
('6800','Depreciation Expense','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'DEPRECIATION','OPERATING',1,0),
('6900','Inventory Variance and Write-off','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'INVENTORY_VARIANCE','OPERATING',1,0),
('6990','Other Operating Expense','EXPENSE','INCOME_STATEMENT','DEBIT',NULL,'EXPENSE','OPERATING',1,1);

INSERT OR IGNORE INTO erp_tax_codes(
  tax_code,tax_name,tax_type,rate,account_code,recoverable
) VALUES
('VAT_IN_12','Input VAT 12%','VAT_INPUT',0.12,'1150',1),
('VAT_OUT_12','Output VAT 12%','VAT_OUTPUT',0.12,'2100',0),
('VAT_ZERO','Zero-rated VAT','VAT_OUTPUT',0,'2100',0),
('VAT_EXEMPT','VAT Exempt','VAT_OUTPUT',0,'2100',0),
('EWT_1','Expanded Withholding Tax 1%','EWT',0.01,'2110',0),
('EWT_2','Expanded Withholding Tax 2%','EWT',0.02,'2110',0),
('EWT_5','Expanded Withholding Tax 5%','EWT',0.05,'2110',0),
('EWT_10','Expanded Withholding Tax 10%','EWT',0.10,'2110',0),
('CWT_1','Creditable Withholding Tax 1%','CWT',0.01,'1160',1),
('CWT_2','Creditable Withholding Tax 2%','CWT',0.02,'1160',1);

INSERT OR IGNORE INTO erp_posting_rules(event_type,line_role,account_code,debit_credit,amount_basis,priority) VALUES
('GOODS_RECEIPT','INVENTORY','1200','DEBIT','NET',10),
('GOODS_RECEIPT','GRNI','2050','CREDIT','NET',20),
('LANDED_COST','INVENTORY','1200','DEBIT','GROSS',10),
('LANDED_COST','PAYABLE','2000','CREDIT','GROSS',20),
('SUPPLIER_BILL','EXPENSE_OR_INVENTORY','6990','DEBIT','NET',10),
('SUPPLIER_BILL','INPUT_VAT','1150','DEBIT','TAX',20),
('SUPPLIER_BILL','PAYABLE','2000','CREDIT','GROSS_LESS_WITHHOLDING',30),
('SUPPLIER_BILL','WITHHOLDING','2110','CREDIT','WITHHOLDING',40),
('CUSTOMER_INVOICE','RECEIVABLE','1100','DEBIT','GROSS',10),
('CUSTOMER_INVOICE','REVENUE','4000','CREDIT','NET',20),
('CUSTOMER_INVOICE','OUTPUT_VAT','2100','CREDIT','TAX',30),
('CUSTOMER_RECEIPT','BANK','1010','DEBIT','GROSS',10),
('CUSTOMER_RECEIPT','RECEIVABLE','1100','CREDIT','GROSS',20),
('SUPPLIER_PAYMENT','PAYABLE','2000','DEBIT','GROSS',10),
('SUPPLIER_PAYMENT','BANK','1010','CREDIT','GROSS',20),
('SALE_COGS','COGS','5000','DEBIT','COST',10),
('SALE_COGS','INVENTORY','1200','CREDIT','COST',20),
('INVENTORY_WRITE_OFF','VARIANCE','6900','DEBIT','COST',10),
('INVENTORY_WRITE_OFF','INVENTORY','1200','CREDIT','COST',20),
('DEPRECIATION','DEPRECIATION_EXPENSE','6800','DEBIT','GROSS',10),
('DEPRECIATION','ACCUMULATED_DEPRECIATION','1390','CREDIT','GROSS',20),
('PAYROLL','PAYROLL_EXPENSE','6000','DEBIT','GROSS',10),
('PAYROLL','WITHHOLDING','2120','CREDIT','TAX',20),
('PAYROLL','PAYROLL_PAYABLE','2200','CREDIT','NET',30);

INSERT OR IGNORE INTO erp_sequences(code,next_value,prefix,width) VALUES
('JOURNAL',1,'JE',8),
('AR_DOCUMENT',1,'AR',8),
('AP_DOCUMENT',1,'AP',8),
('BANK_RECON',1,'BR',8),
('DEPRECIATION_RUN',1,'DEP',8),
('FINANCE_CHANGE_REQUEST',1,'FCR',8),
('FINANCIAL_REPORT',1,'FR',8);
INSERT OR IGNORE INTO erp_sequences(code,next_value,prefix,width) VALUES
('PAYMENT_REQUEST',1,'RFP',8);

INSERT OR IGNORE INTO erp_role_permissions(
  role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage
) VALUES
('FINANCE','FINANCE',1,1,1,1,1,1,1),
('ACCOUNTING','FINANCE',1,1,1,0,1,1,0),
('CFO','FINANCE',1,1,1,1,1,1,1),
('VIEWER','FINANCE',1,0,0,0,0,0,0);

-- Establish the current serial-level inventory as the Finance cutover opening balance.
-- Historical operational documents remain audit evidence; only post-cutover activity creates new journals.
INSERT OR IGNORE INTO erp_accounting_periods(
  entity_id,fiscal_year,period_no,period_name,start_date,end_date,status
)
SELECT id,CAST(strftime('%Y','now') AS INTEGER),CAST(strftime('%m','now') AS INTEGER),
  strftime('%Y-%m','now'),date('now','start of month'),
  date('now','start of month','+1 month','-1 day'),'OPEN'
FROM erp_legal_entities WHERE entity_code='E88';

INSERT OR IGNORE INTO erp_journal_headers(
  journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,
  source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,
  status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at
)
SELECT 'JE-OPENING-INVENTORY-CUTOVER',e.id,date('now'),p.id,'OPENING','FINANCE','CUTOVER',
  'INVENTORY-CUTOVER','FINANCE_CUTOVER_OPENING_INVENTORY',
  'Opening inventory balance from serial-level operational subledger','PHP',1,v.total,v.total,
  'POSTED','system-cutover','system-cutover',datetime('now'),'system-cutover',datetime('now'),
  'system-cutover',datetime('now')
FROM erp_legal_entities e
JOIN erp_accounting_periods p ON p.entity_id=e.id
  AND p.fiscal_year=CAST(strftime('%Y','now') AS INTEGER)
  AND p.period_no=CAST(strftime('%m','now') AS INTEGER)
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) total
  FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF')
) v
WHERE e.entity_code='E88' AND v.total>0;

INSERT OR IGNORE INTO erp_journal_lines(
  journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit
)
SELECT h.id,1,a.id,'Opening motorcycles, spare parts and other inventory',
  v.amount,0,v.amount,0
FROM erp_journal_headers h
JOIN erp_chart_accounts a ON a.account_code='1200'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF')
    AND UPPER(COALESCE(category,'')) NOT IN ('BAT','BSS')
) v
WHERE h.source_event_key='FINANCE_CUTOVER_OPENING_INVENTORY' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(
  journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit
)
SELECT h.id,2,a.id,'Opening batteries and battery-swap equipment inventory',
  v.amount,0,v.amount,0
FROM erp_journal_headers h
JOIN erp_chart_accounts a ON a.account_code='1220'
CROSS JOIN (
  SELECT ROUND(COALESCE(SUM(unit_cost),0),2) amount FROM erp_assets
  WHERE active=1 AND current_status NOT IN ('SOLD','WRITTEN_OFF')
    AND UPPER(COALESCE(category,'')) IN ('BAT','BSS')
) v
WHERE h.source_event_key='FINANCE_CUTOVER_OPENING_INVENTORY' AND v.amount>0;

INSERT OR IGNORE INTO erp_journal_lines(
  journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit
)
SELECT h.id,3,a.id,'Opening inventory conversion equity',
  0,h.total_credit,0,h.total_credit
FROM erp_journal_headers h
JOIN erp_chart_accounts a ON a.account_code='3100'
WHERE h.source_event_key='FINANCE_CUTOVER_OPENING_INVENTORY';

INSERT OR IGNORE INTO erp_finance_source_events(
  event_key,event_type,source_module,source_type,source_no,event_date,entity_code,
  amount,currency,payload_json,financial_effect,status,journal_id,captured_by,processed_by,processed_at
)
SELECT 'FINANCE_CUTOVER_OPENING_INVENTORY','OPENING_INVENTORY','FINANCE','CUTOVER',
  'INVENTORY-CUTOVER',h.journal_date,'E88',h.total_debit,'PHP','{"source":"serial_inventory"}',
  'ACCOUNTING','POSTED',h.id,'system-cutover','system-cutover',datetime('now')
FROM erp_journal_headers h WHERE h.source_event_key='FINANCE_CUTOVER_OPENING_INVENTORY';

INSERT OR IGNORE INTO erp_settings(key,value,updated_at)
VALUES('FINANCE_CUTOVER_TIMESTAMP',datetime('now'),datetime('now'));

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('FINANCE_ENGINE_MODE','CONNECTED_SOURCE_TO_VALIDATED_BALANCED_LEDGER',datetime('now')),
('FINANCE_BASE_CURRENCY','PHP',datetime('now')),
('FINANCE_DEFAULT_ENTITY','E88',datetime('now')),
('PERIOD_LOCK_POLICY','POSTING_BLOCKED_WHEN_CLOSED',datetime('now')),
('JOURNAL_APPROVAL_POLICY','PREPARER_CANNOT_APPROVE_OR_REVERSE',datetime('now')),
('INVENTORY_FINANCE_POLICY','EVERY_MOVEMENT_CAPTURED_FINANCIAL_EFFECT_BY_TYPE',datetime('now')),
('APP_VERSION','10.0.0-connected-finance',datetime('now'));
