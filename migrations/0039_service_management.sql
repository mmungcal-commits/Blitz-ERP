-- 0039_service_management.sql
-- Blitz - ERP · Service Management (after-sales).
-- ADDITIVE ONLY. Safe on the live database with database_mode=upgrade_existing.
--
-- Implements "IMPROVE ERP.docx" Service Management a-f:
--   a. file uploads on the job (handled by erp_attachments from 0038)
--   b. an assembly card that consumes real inventory, so a serial picked for a
--      job is no longer available anywhere else
--   c. automatic estimate: material + labour + overhead, plus a markup % that
--      becomes revenue
--   d. a printable Job Order
--   e. final cost posted from the parts actually used
--   f. excess parts returned to inventory and made available again

CREATE TABLE IF NOT EXISTS erp_service_jobs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  job_no             TEXT NOT NULL UNIQUE,
  job_type           TEXT NOT NULL DEFAULT 'REPAIR',   -- REPAIR | PREVENTIVE | ROADSIDE | WARRANTY | INSTALLATION
  customer_id        INTEGER REFERENCES erp_partners(id),
  customer_name      TEXT,
  contact_person     TEXT,
  contact_number     TEXT,
  unit_serial_no     TEXT,                              -- motorcycle / battery / locker under service
  unit_item_code     TEXT,
  unit_item_name     TEXT,
  odometer           TEXT,
  location_id        INTEGER REFERENCES erp_locations(id),
  location_code      TEXT,
  complaint          TEXT,
  diagnosis          TEXT,
  work_performed     TEXT,
  status             TEXT NOT NULL DEFAULT 'DRAFT',     -- DRAFT | ESTIMATED | APPROVED | IN_PROGRESS | COMPLETED | CLOSED | CANCELLED
  priority           TEXT DEFAULT 'NORMAL',
  promised_date      TEXT,
  material_cost      REAL NOT NULL DEFAULT 0,
  labor_cost         REAL NOT NULL DEFAULT 0,
  overhead_cost      REAL NOT NULL DEFAULT 0,
  markup_pct         REAL NOT NULL DEFAULT 20,
  estimated_cost     REAL NOT NULL DEFAULT 0,
  estimated_price    REAL NOT NULL DEFAULT 0,           -- cost + markup = revenue
  final_material_cost REAL NOT NULL DEFAULT 0,
  final_cost         REAL NOT NULL DEFAULT 0,
  final_price        REAL NOT NULL DEFAULT 0,
  gross_margin       REAL NOT NULL DEFAULT 0,
  sales_order_no     TEXT,
  created_by         TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  estimated_at       TEXT,
  approved_by        TEXT, approved_at TEXT,
  completed_by       TEXT, completed_at TEXT,
  closed_by          TEXT, closed_at TEXT,
  cancelled_by       TEXT, cancelled_at TEXT, cancel_reason TEXT,
  remarks            TEXT,
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_svc_status ON erp_service_jobs(status);
CREATE INDEX IF NOT EXISTS ix_svc_unit ON erp_service_jobs(unit_serial_no);

-- The assembly card: parts drawn from inventory for this job.
CREATE TABLE IF NOT EXISTS erp_service_job_parts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES erp_service_jobs(id),
  line_no       INTEGER NOT NULL DEFAULT 1,
  item_id       INTEGER REFERENCES erp_items(id),
  item_code     TEXT,
  item_name     TEXT,
  serial_no     TEXT,                       -- set for serialised parts
  asset_id      INTEGER REFERENCES erp_assets(id),
  prior_status  TEXT,                       -- so a return can restore it
  qty           REAL NOT NULL DEFAULT 1,
  unit_cost     REAL NOT NULL DEFAULT 0,
  line_cost     REAL NOT NULL DEFAULT 0,
  qty_used      REAL NOT NULL DEFAULT 0,    -- filled in at completion
  qty_returned  REAL NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'RESERVED', -- RESERVED | CONSUMED | RETURNED
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_svc_parts_job ON erp_service_job_parts(job_id);

CREATE TABLE IF NOT EXISTS erp_service_job_labor (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES erp_service_jobs(id),
  line_no     INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  technician  TEXT,
  hours       REAL NOT NULL DEFAULT 0,
  rate        REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_svc_labor_job ON erp_service_job_labor(job_id);

-- Excess parts pushed back into stock.
CREATE TABLE IF NOT EXISTS erp_service_part_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no    TEXT NOT NULL,
  job_id       INTEGER NOT NULL REFERENCES erp_service_jobs(id),
  part_id      INTEGER REFERENCES erp_service_job_parts(id),
  serial_no    TEXT,
  item_code    TEXT,
  qty          REAL NOT NULL DEFAULT 0,
  unit_cost    REAL NOT NULL DEFAULT 0,
  location_id  INTEGER,
  location_code TEXT,
  condition_code TEXT DEFAULT 'GOOD',
  returned_by  TEXT,
  returned_at  TEXT DEFAULT (datetime('now')),
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS ix_svc_ret_job ON erp_service_part_returns(job_id);

-- Default service rates, editable from Service Management > Setup.
INSERT OR IGNORE INTO erp_settings(key,value,updated_at) VALUES
  ('SERVICE_LABOR_RATE','450',datetime('now')),
  ('SERVICE_DEFAULT_MARKUP','20',datetime('now')),
  ('SERVICE_OVERHEAD_PCT','5',datetime('now'));

-- A part reserved for a service job is out of stock: this status makes that
-- visible everywhere and blocks it from being sold or moved.
INSERT OR IGNORE INTO erp_movement_statuses(code,label,restricted,terminal,sort_order) VALUES
  ('IN_SERVICE','In Service',1,0,55),
  ('CONSUMED_IN_SERVICE','Consumed in Service',1,1,90);

----------------------------------------------------------------------
-- Permissions
-- Service Management is governed by the CUSTOMERS module and the movement
-- status registry by INVENTORY. Without these grants the only live account
-- (mmungcal, role FINANCE) could open the new screens but not use them:
-- no service job, no quick-add customer, no sales order, no status registry,
-- and no Finance override on a cycle-count variance.
----------------------------------------------------------------------
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  -- Finance runs the books and is the override authority everywhere.
  ('FINANCE','CUSTOMERS',1,1,1,1,1,1,1),
  ('FINANCE','SALES',    1,1,1,1,1,1,0),
  ('FINANCE','INVENTORY',1,1,1,1,1,1,1),
  ('FINANCE','DELIVERIES',1,0,1,1,1,1,0),
  -- Supply chain owns the workshop and the warehouse.
  ('SCM_MANAGER','CUSTOMERS',1,1,1,1,0,1,0),
  ('WAREHOUSE','CUSTOMERS',  1,1,1,0,0,1,0),
  -- Commercial raises service jobs for their customers.
  ('COMMERCIAL','CUSTOMERS', 1,1,1,0,0,1,0),
  -- The new approval roles need to see and act on service work.
  ('DEPT_MANAGER','CUSTOMERS',1,1,1,1,0,1,0),
  ('DEPT_HEAD','CUSTOMERS',   1,1,1,1,0,1,0),
  ('CEO','CUSTOMERS',         1,0,0,1,0,1,0),
  -- Anyone who can raise a request for payment needs FINANCE view+create.
  -- They only ever SEE their own: row-level privacy is enforced in the query
  -- (src/routes/finance.js rfpVisibility), not by withholding the module.
  ('SCM_MANAGER','FINANCE', 1,1,0,0,0,1,0),
  ('WAREHOUSE','FINANCE',   1,1,0,0,0,1,0),
  ('COMMERCIAL','FINANCE',  1,1,0,0,0,1,0),
  ('STAFF','FINANCE',       1,1,0,0,0,0,0),
  ('DEPT_MANAGER','FINANCE',1,1,1,1,0,1,0),
  ('DEPT_HEAD','FINANCE',   1,1,1,1,0,1,0),
  ('CEO','FINANCE',         1,0,1,1,0,1,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=MAX(can_view,excluded.can_view),
  can_create=MAX(can_create,excluded.can_create),
  can_edit=MAX(can_edit,excluded.can_edit),
  can_approve=MAX(can_approve,excluded.can_approve),
  can_post=MAX(can_post,excluded.can_post),
  can_export=MAX(can_export,excluded.can_export),
  can_manage=MAX(can_manage,excluded.can_manage);
