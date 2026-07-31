-- E88 FinSys connected Sales & Distribution and asset-custody controls.
-- Extends the preserved operational data without deleting or rewriting source records.

CREATE TABLE IF NOT EXISTS erp_requisition_context (
  requisition_id INTEGER PRIMARY KEY REFERENCES erp_requisitions(id),
  request_type TEXT NOT NULL DEFAULT 'INTERNAL_USE',
  holder_type TEXT NOT NULL DEFAULT 'DEPARTMENT',
  holder_partner_id INTEGER REFERENCES erp_partners(id),
  holder_name TEXT NOT NULL,
  holder_email TEXT,
  source_order_id INTEGER REFERENCES erp_sales_orders(id),
  source_order_no TEXT,
  expected_return_date TEXT,
  custody_purpose TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_requisition_context_holder
  ON erp_requisition_context(holder_type,holder_partner_id,holder_name);

-- Preserve existing requisitions while bringing them into the connected
-- custody flow. This creates context only where one does not yet exist.
INSERT OR IGNORE INTO erp_requisition_context(
  requisition_id,request_type,holder_type,holder_partner_id,holder_name,
  holder_email,source_order_no,custody_purpose
)
SELECT
  r.id,
  CASE
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%lease%' THEN 'LEASE_DEPLOYMENT'
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%demo%' THEN 'DEMO'
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%employee%' THEN 'EMPLOYEE_USE'
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%sale%' THEN 'SALE'
    ELSE 'INTERNAL_USE'
  END,
  CASE
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%lease%' THEN 'LEASE_DEPLOYMENT'
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%demo%' THEN 'DEMO'
    WHEN lower(COALESCE(r.purpose,'')) LIKE '%employee%' THEN 'EMPLOYEE'
    WHEN r.partner_id IS NOT NULL THEN 'CUSTOMER'
    ELSE 'DEPARTMENT'
  END,
  r.partner_id,
  COALESCE(p.name,NULLIF(r.destination,''),NULLIF(r.department,''),'Unspecified holder'),
  p.email,
  NULL,
  r.purpose
FROM erp_requisitions r
LEFT JOIN erp_partners p ON p.id=r.partner_id;

CREATE TABLE IF NOT EXISTS erp_requisition_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL REFERENCES erp_requisitions(id),
  requisition_line_id INTEGER NOT NULL REFERENCES erp_requisition_lines(id),
  asset_id INTEGER REFERENCES erp_assets(id),
  serial_no TEXT,
  item_id INTEGER REFERENCES erp_items(id),
  item_code TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  allocation_status TEXT NOT NULL DEFAULT 'SELECTED',
  selected_by TEXT,
  selected_at TEXT DEFAULT (datetime('now')),
  released_at TEXT,
  UNIQUE(requisition_id,asset_id),
  UNIQUE(requisition_id,serial_no)
);

CREATE INDEX IF NOT EXISTS idx_erp_requisition_allocations_serial
  ON erp_requisition_allocations(serial_no,allocation_status);

CREATE TABLE IF NOT EXISTS erp_document_flow_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  source_no TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  target_no TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_type,source_no,target_type,target_no,relation_type)
);

CREATE INDEX IF NOT EXISTS idx_erp_document_flow_source
  ON erp_document_flow_links(source_type,source_no);
CREATE INDEX IF NOT EXISTS idx_erp_document_flow_target
  ON erp_document_flow_links(target_type,target_no);

CREATE TABLE IF NOT EXISTS erp_lease_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_no TEXT NOT NULL UNIQUE,
  workspace_record_id INTEGER UNIQUE REFERENCES erp_module_records(id),
  sales_order_id INTEGER REFERENCES erp_sales_orders(id),
  customer_id INTEGER REFERENCES erp_partners(id),
  business_channel TEXT NOT NULL DEFAULT 'B2B',
  service_provider TEXT NOT NULL DEFAULT 'E88 Ventures, Inc.',
  service_provider_address TEXT,
  client_name TEXT NOT NULL,
  client_address TEXT,
  client_email TEXT,
  leased_units_description TEXT,
  replacement_value REAL NOT NULL DEFAULT 0,
  contract_term_months INTEGER NOT NULL DEFAULT 0,
  lock_in_months INTEGER NOT NULL DEFAULT 0,
  effective_date TEXT,
  end_of_term TEXT,
  daily_rate_vat_ex REAL NOT NULL DEFAULT 0,
  late_penalty TEXT,
  billing_basis TEXT,
  payment_channel TEXT,
  provider_authorized_rep TEXT,
  client_authorized_rep TEXT,
  billing_frequency TEXT,
  unit_count INTEGER NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  signed_document_id INTEGER REFERENCES erp_documents(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_lease_contract_customer
  ON erp_lease_contracts(customer_id,status,end_of_term);

CREATE TABLE IF NOT EXISTS erp_lease_contract_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_contract_id INTEGER NOT NULL REFERENCES erp_lease_contracts(id),
  asset_id INTEGER NOT NULL REFERENCES erp_assets(id),
  serial_no TEXT NOT NULL,
  item_code TEXT,
  unit_role TEXT,
  replacement_value REAL NOT NULL DEFAULT 0,
  daily_rate_vat_ex REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  UNIQUE(lease_contract_id,asset_id),
  UNIQUE(lease_contract_id,serial_no)
);

CREATE INDEX IF NOT EXISTS idx_erp_lease_contract_units_serial
  ON erp_lease_contract_units(serial_no,status);

CREATE TABLE IF NOT EXISTS erp_crm_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES erp_partners(id),
  workspace_record_id INTEGER REFERENCES erp_module_records(id),
  activity_type TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  contact_person TEXT,
  subject TEXT NOT NULL,
  notes TEXT,
  next_action TEXT,
  next_action_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  owner_email TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_erp_crm_activities_customer
  ON erp_crm_activities(customer_id,activity_date,status);

CREATE TABLE IF NOT EXISTS erp_record_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  module_code TEXT NOT NULL,
  record_id INTEGER NOT NULL REFERENCES erp_module_records(id),
  record_no TEXT NOT NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  requested_by TEXT NOT NULL,
  requested_at TEXT DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  decision_notes TEXT,
  executed_by TEXT,
  executed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_erp_record_change_requests_worklist
  ON erp_record_change_requests(module_code,status,requested_at);

CREATE VIEW IF NOT EXISTS vw_erp_outbound_document_chain AS
SELECT
  r.id requisition_id,
  r.requisition_no,
  r.status requisition_status,
  rc.request_type,
  rc.holder_type,
  rc.holder_name,
  a.id assignment_id,
  a.assignment_no,
  a.status assignment_status,
  d.id delivery_id,
  d.delivery_no,
  d.status delivery_status,
  ro.id return_id,
  ro.return_no,
  ro.status return_status
FROM erp_requisitions r
LEFT JOIN erp_requisition_context rc ON rc.requisition_id=r.id
LEFT JOIN erp_assignments a ON a.source_request_no=r.requisition_no
LEFT JOIN erp_deliveries d ON d.requisition_id=r.id
LEFT JOIN erp_return_orders ro ON ro.assignment_id=a.id;

CREATE VIEW IF NOT EXISTS vw_erp_serial_custody_history AS
SELECT
  a.serial_no,
  'REQUISITION' event_type,
  r.request_date event_date,
  r.requisition_no reference_no,
  rc.holder_type,
  rc.holder_name,
  ra.allocation_status status,
  r.purpose notes
FROM erp_requisition_allocations ra
JOIN erp_requisitions r ON r.id=ra.requisition_id
JOIN erp_requisition_context rc ON rc.requisition_id=r.id
JOIN erp_assets a ON a.id=ra.asset_id
UNION ALL
SELECT
  l.serial_no,
  l.movement_type,
  l.movement_date,
  l.source_doc_no,
  l.holder_type,
  l.holder_name,
  l.to_status,
  l.notes
FROM erp_stock_ledger l
WHERE l.serial_no IS NOT NULL AND l.serial_no!='';

INSERT OR IGNORE INTO erp_sequences(code,next_value,prefix,width) VALUES
('LEASE_CONTRACT',1,'LCT',8),
('CRM_ACTIVITY',1,'CRM-ACT',8),
('CHANGE_REQUEST',1,'CHG',8);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('OUTBOUND_CONTROL_MODE','REQUISITION_TO_ASSIGNMENT_TO_CHECKLIST_TO_ISSUANCE_TO_DELIVERY_TO_RETURN',datetime('now')),
('REQUISITION_HOLDER_TYPES','CUSTOMER,EMPLOYEE,DEMO,PILOT,DEPARTMENT,DEALER_RETAIL,PROJECT_SITE,LEASE_DEPLOYMENT',datetime('now')),
('LEASE_DOCUMENT_POLICY','SIGNED_CONTRACT_AND_ANNEX_STORED_AGAINST_AUTO_NUMBERED_LEASE',datetime('now')),
('DELETION_REVERSAL_POLICY','APPROVAL_REQUIRED_SOFT_VOID_ONLY',datetime('now')),
('APP_VERSION','9.1.0-connected-erp',datetime('now'));
