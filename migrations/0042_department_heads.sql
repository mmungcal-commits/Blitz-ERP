-- 0042_department_heads.sql
-- Blitz - ERP · who is the head of which department.
--
-- ADDITIVE ONLY, and deliberately a table rather than a column on erp_users:
-- the deploy workflow re-runs every migration file on every deploy, so a bare
-- ALTER TABLE would fail with "duplicate column name" the second time (this is
-- exactly why 0037 had to be excluded from the workflow by hand).
--
-- It also models the fact properly. Being head of Finance is not the same thing
-- as holding the FINANCE role: Mark validates payments as Finance AND approves
-- his own department's requests as its head, and those are two different
-- signatures on the same form. A lookup table lets one person hold both without
-- inventing a role per department, and lets you appoint a head for Sales later
-- from the Master Reference screen without a code change.

CREATE TABLE IF NOT EXISTS erp_department_heads (
  department  TEXT PRIMARY KEY,
  head_email  TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Matched to erp_users.department exactly; the lookup is case-insensitive but
-- an exact match keeps the data readable.
-- Samuel heads several departments; one person can hold as many as they need,
-- because this is keyed by department rather than by person.
--
-- Both 'Sales' and 'Sales and Marketing' are listed on purpose: erp_departments
-- calls it 'Sales' while erp_users.department says 'Sales and Marketing', and
-- the RFP carries whichever string the form supplied. Listing both means the
-- head is found either way instead of the request silently stalling.
INSERT INTO erp_department_heads(department,head_email) VALUES
  ('Supply Chain',           'samuel@nrdev.ph'),
  ('Logistics',              'samuel@nrdev.ph'),
  ('Warehouse',              'samuel@nrdev.ph'),
  ('After Sales',            'samuel@nrdev.ph'),
  ('Operations & Product',   'samuel@nrdev.ph'),
  ('Sales',                  'samuel@nrdev.ph'),
  ('Sales and Marketing',    'samuel@nrdev.ph'),
  ('Human Resources',        'haide@nrdev.ph'),
  ('Technology',             'ferdinand@nrdev.ph'),
  ('Finance and Accounting', 'mmungcal@nrdev.ph')
ON CONFLICT(department) DO UPDATE SET
  head_email=excluded.head_email,
  updated_at=datetime('now');

-- To appoint a head for any other department:
--   INSERT INTO erp_department_heads(department,head_email)
--     VALUES('<department>','<email>')
--     ON CONFLICT(department) DO UPDATE SET head_email=excluded.head_email;
-- A department with no row here has no approver, and requests raised against it
-- will sit at the DEPARTMENT stage.

----------------------------------------------------------------------
-- Details captured for a unit that is counted but is not yet in the system.
--
-- Today's physical count IS the opening record: most units on the floor have
-- never been registered. The scan endpoint used to flag those as
-- variance_type='UNKNOWN_SERIAL' with no asset behind them, and
-- post-adjustments then dropped them into its "unresolved" bucket - counted,
-- reported, and then silently discarded. Nothing was created.
--
-- This table holds what the counter tells us about such a unit so that posting
-- the count can register it properly instead of losing it. Separate table
-- rather than new columns on erp_cycle_count_lines, so the migration stays
-- re-runnable on every deploy.
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_cycle_count_new_units (
  line_id        INTEGER PRIMARY KEY REFERENCES erp_cycle_count_lines(id),
  item_code      TEXT,
  item_name      TEXT,
  category       TEXT,
  serial_type    TEXT,
  secondary_serial TEXT,
  motor_no       TEXT,
  unit_cost      REAL NOT NULL DEFAULT 0,
  condition_code TEXT DEFAULT 'GOOD',
  status         TEXT DEFAULT 'AVAILABLE',
  captured_by    TEXT,
  captured_at    TEXT DEFAULT (datetime('now'))
);
