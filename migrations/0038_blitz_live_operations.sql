-- 0038_blitz_live_operations.sql
-- Blitz - ERP go-live migration. ADDITIVE ONLY: creates new tables, inserts
-- reference rows, and adds nullable columns. Safe to run on the live e88-v7
-- database with database_mode=upgrade_existing.
--
-- Covers:
--   1. The missing approval roles (Department Manager, Department Head, CEO)
--      and their module permissions.
--   2. A data-driven PO / requisition / cycle-count approval matrix that uses
--      those roles, so the chain in "IMPROVE ERP.docx" is enforced server-side.
--   3. erp_attachments: one table for every uploaded supporting document,
--      with its Google Drive file id and link.
--   4. erp_stock_move_requests: users can no longer post a stock movement
--      directly; they raise a slip that must be approved first.
--   5. Movement status registry with a restricted flag (Available for Lease /
--      Available for Sale / Sold ... ), and the SOLD lock.
--   6. Cash-advance liquidation columns the RFP module needs.
--   7. Drive + branding settings.

----------------------------------------------------------------------
-- 1. Approval roles
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_roles(code,name,active) VALUES
  ('DEPT_MANAGER','Department Manager',1),
  ('DEPT_HEAD','Department Head',1),
  ('CEO','Chief Executive Officer',1);

-- Department Manager: first operational approver. Sees and approves what the
-- department raises; cannot post to the ledger.
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('DEPT_MANAGER','DASHBOARD',1,0,0,0,0,1,0),
  ('DEPT_MANAGER','PROCUREMENT',1,1,1,1,0,1,0),
  ('DEPT_MANAGER','REQUISITIONS',1,1,1,1,0,1,0),
  ('DEPT_MANAGER','INVENTORY',1,0,0,1,0,1,0),
  ('DEPT_MANAGER','RECEIVING',1,0,0,0,0,1,0),
  ('DEPT_MANAGER','RETURNS',1,0,0,1,0,1,0),
  ('DEPT_MANAGER','SALES',1,0,0,0,0,1,0),
  ('DEPT_MANAGER','FINANCE',1,1,0,0,0,0,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=excluded.can_view,can_create=excluded.can_create,can_edit=excluded.can_edit,
  can_approve=excluded.can_approve,can_post=excluded.can_post,can_export=excluded.can_export;

-- Department Head: second approver, wider visibility, still no posting.
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('DEPT_HEAD','DASHBOARD',1,0,0,0,0,1,0),
  ('DEPT_HEAD','PROCUREMENT',1,1,1,1,0,1,0),
  ('DEPT_HEAD','REQUISITIONS',1,1,1,1,0,1,0),
  ('DEPT_HEAD','INVENTORY',1,0,1,1,0,1,0),
  ('DEPT_HEAD','RECEIVING',1,0,1,1,0,1,0),
  ('DEPT_HEAD','RETURNS',1,0,1,1,0,1,0),
  ('DEPT_HEAD','SALES',1,0,1,1,0,1,0),
  ('DEPT_HEAD','DELIVERIES',1,0,1,1,0,1,0),
  ('DEPT_HEAD','FINANCE',1,1,0,1,0,1,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=excluded.can_view,can_create=excluded.can_create,can_edit=excluded.can_edit,
  can_approve=excluded.can_approve,can_post=excluded.can_post,can_export=excluded.can_export;

-- CEO: final approver on everything, read-only elsewhere.
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('CEO','DASHBOARD',1,0,0,0,0,1,0),
  ('CEO','PROCUREMENT',1,0,0,1,0,1,0),
  ('CEO','FINANCE',1,0,0,1,0,1,0),
  ('CEO','SALES',1,0,0,1,0,1,0),
  ('CEO','INVENTORY',1,0,0,0,0,1,0),
  ('CEO','REQUISITIONS',1,0,0,1,0,1,0),
  ('CEO','RECEIVING',1,0,0,0,0,1,0),
  ('CEO','RETURNS',1,0,0,1,0,1,0),
  ('CEO','DELIVERIES',1,0,0,0,0,1,0),
  ('CEO','PLANNING',1,0,0,0,0,1,0),
  ('CEO','STATIONS',1,0,0,0,0,1,0),
  ('CEO','CUSTOMERS',1,0,0,0,0,1,0),
  ('CEO','SHIPMENTS',1,0,0,0,0,1,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=excluded.can_view,can_approve=excluded.can_approve,can_export=excluded.can_export;

----------------------------------------------------------------------
-- 2. Approval matrices (data-driven, read by src/lib/specialist-engine.js)
--    Purchase Order : Dept Manager -> Dept Head -> Finance -> CEO
--    Requisition    : Dept Manager -> Dept Head
--    Stock movement : Dept Manager -> Dept Head
--    Cycle count    : Dept Manager -> Dept Head -> Finance
--
-- IMPORTANT: these rows are inserted with active=0 ON PURPOSE.
-- The engine refuses an approval step unless a signed-in user actually holds
-- the required role, so switching them on before you have DEPT_MANAGER /
-- DEPT_HEAD / CEO accounts would freeze the in-app Approve button. The emailed
-- token chain on the PO form (Dept Manager -> Dept Head -> Finance -> CEO)
-- works today with no role accounts at all.
-- Turn a tier on once the accounts exist:
--   UPDATE erp_approval_matrices SET active=1 WHERE matrix_code LIKE 'PO_STEP%';
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_approval_matrices
  (matrix_code,module_code,document_type,department,amount_from,amount_to,step_no,approver_role_code,action_code,active,created_by) VALUES
  ('PO_STEP1_DEPT_MANAGER','ip-sourcing-purchasing','*','*',0,NULL,1,'DEPT_MANAGER','APPROVE',0,'0038'),
  ('PO_STEP2_DEPT_HEAD',   'ip-sourcing-purchasing','*','*',0,NULL,2,'DEPT_HEAD',   'APPROVE',0,'0038'),
  ('PO_STEP3_FINANCE',     'ip-sourcing-purchasing','*','*',0,NULL,3,'FINANCE',     'APPROVE',0,'0038'),
  ('PO_STEP4_CEO',         'ip-sourcing-purchasing','*','*',0,NULL,4,'CEO',         'APPROVE',0,'0038'),
  ('REQ_STEP1_DEPT_MANAGER','ip-inbound-logistics','REQUISITION','*',0,NULL,1,'DEPT_MANAGER','APPROVE',0,'0038'),
  ('REQ_STEP2_DEPT_HEAD',  'ip-inbound-logistics','REQUISITION','*',0,NULL,2,'DEPT_HEAD','APPROVE',0,'0038'),
  ('MOVE_STEP1_DEPT_MANAGER','ip-warehouse-management','STOCK_MOVEMENT','*',0,NULL,1,'DEPT_MANAGER','APPROVE',0,'0038'),
  ('MOVE_STEP2_DEPT_HEAD', 'ip-warehouse-management','STOCK_MOVEMENT','*',0,NULL,2,'DEPT_HEAD','APPROVE',0,'0038'),
  ('COUNT_STEP1_DEPT_MANAGER','ip-inventory-cycle-counting','CYCLE_COUNT','*',0,NULL,1,'DEPT_MANAGER','APPROVE',0,'0038'),
  ('COUNT_STEP2_DEPT_HEAD','ip-inventory-cycle-counting','CYCLE_COUNT','*',0,NULL,2,'DEPT_HEAD','APPROVE',0,'0038'),
  ('COUNT_STEP3_FINANCE',  'ip-inventory-cycle-counting','CYCLE_COUNT','*',0,NULL,3,'FINANCE','APPROVE',0,'0038');

----------------------------------------------------------------------
-- 3. Attachments — every uploaded supporting document, mirrored to Drive
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  module_code   TEXT NOT NULL,              -- PROCUREMENT / FINANCE / SALES / SERVICE ...
  record_type   TEXT NOT NULL,              -- PURCHASE_ORDER / PAYMENT_REQUEST / SALES_ORDER ...
  record_id     INTEGER,
  record_no     TEXT,
  file_name     TEXT NOT NULL,
  content_type  TEXT,
  file_size     INTEGER DEFAULT 0,
  storage       TEXT NOT NULL DEFAULT 'DRIVE',   -- DRIVE | R2 | LINK
  drive_file_id TEXT,
  drive_folder  TEXT,
  file_url      TEXT,
  uploaded_by   TEXT,
  uploaded_at   TEXT DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_attach_record ON erp_attachments(record_type,record_id);
CREATE INDEX IF NOT EXISTS ix_attach_no ON erp_attachments(record_no);

----------------------------------------------------------------------
-- 4. Stock-movement requests (requisition slip for stock movement)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_stock_move_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no         TEXT NOT NULL UNIQUE,
  serial_no          TEXT NOT NULL,
  item_code          TEXT,
  item_name          TEXT,
  movement_type      TEXT NOT NULL DEFAULT 'TRANSFER',
  from_location_code TEXT,
  to_location_id     INTEGER,
  to_location_code   TEXT,
  to_location_name   TEXT,
  to_location_type   TEXT,
  to_status          TEXT,
  notes              TEXT,
  department         TEXT,
  status             TEXT NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED | DEPT_MANAGER_APPROVED | APPROVED | REJECTED | POSTED | CANCELLED
  requested_by       TEXT,
  requested_at       TEXT DEFAULT (datetime('now')),
  manager_approved_by TEXT, manager_approved_at TEXT,
  head_approved_by    TEXT, head_approved_at    TEXT,
  rejected_by         TEXT, rejected_at         TEXT, reject_reason TEXT,
  posted_by           TEXT, posted_at           TEXT,
  movement_id         INTEGER,
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_move_req_status ON erp_stock_move_requests(status);
CREATE INDEX IF NOT EXISTS ix_move_req_serial ON erp_stock_move_requests(serial_no);

----------------------------------------------------------------------
-- 5. Movement status registry (with the restricted rule)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_movement_statuses (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  restricted  INTEGER NOT NULL DEFAULT 0,   -- 1 = unit can no longer be moved
  terminal    INTEGER NOT NULL DEFAULT 0,   -- 1 = unit disappears from operational stock
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT DEFAULT 'system',
  created_at  TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO erp_movement_statuses(code,label,restricted,terminal,sort_order) VALUES
  ('AVAILABLE','Available',0,0,10),
  ('AVAILABLE_FOR_LEASE','Available for Lease',0,0,20),
  ('AVAILABLE_FOR_SALE','Available for Sale',0,0,30),
  ('RESERVED','Reserved',1,0,40),
  ('ASSIGNED','Assigned',1,0,50),
  ('UNDER_REPAIR','Under Repair',1,0,60),
  ('QUARANTINE','Quarantine',1,0,70),
  ('SOLD','Sold',1,1,80);

----------------------------------------------------------------------
-- 6. Cash advance liquidation
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_rfp_liquidations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  liquidation_no TEXT NOT NULL UNIQUE,
  payment_request_id INTEGER NOT NULL,
  request_no     TEXT,
  requestor_email TEXT,
  advance_amount REAL NOT NULL DEFAULT 0,
  spent_amount   REAL NOT NULL DEFAULT 0,
  variance       REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | SUBMITTED | APPROVED | REJECTED
  submitted_at   TEXT,
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  remarks        TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_liq_rfp ON erp_rfp_liquidations(payment_request_id);

CREATE TABLE IF NOT EXISTS erp_rfp_liquidation_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  liquidation_id  INTEGER NOT NULL,
  line_no         INTEGER NOT NULL DEFAULT 1,
  expense_date    TEXT,
  particulars     TEXT,
  amount          REAL NOT NULL DEFAULT 0,
  receipt_no      TEXT,
  attachment_id   INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_liq_items ON erp_rfp_liquidation_items(liquidation_id);

----------------------------------------------------------------------
-- 7. Settings: Google Drive root, branding, idle timeout
----------------------------------------------------------------------
INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
  ('DRIVE_ROOT_FOLDER_ID','1if_MxvG0z2LmlaPVX5uf5KMFp8jQGghZ',datetime('now')),
  ('APP_BRAND_NAME','Blitz - ERP',datetime('now')),
  ('APP_COMPANY_NAME','E88 Ventures Inc.',datetime('now')),
  ('SESSION_IDLE_MINUTES','15',datetime('now')),
  ('RFP_PRIVACY_ENFORCED','1',datetime('now'));
