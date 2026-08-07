-- 0044 · Close the control gaps the client spec describes.
--
-- Every statement here is re-runnable. The deploy applies migrations on every
-- run, so a bare ALTER TABLE would fail the second time with "duplicate column
-- name" - which is exactly how 0037 broke. Anything that would have been a new
-- column is a side table keyed on the parent id instead.

-- ---------------------------------------------------------------------------
-- 1. A receiving discrepancy is cleared by Finance, then acknowledged by the
--    department head. Two people, in that order, recorded separately.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_receiving_variance_acks (
  variance_id INTEGER PRIMARY KEY REFERENCES erp_receiving_variances(id),
  acknowledged_by TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

-- ---------------------------------------------------------------------------
-- 2. A submitted cycle count runs a chain before it posts:
--    Department Manager -> Department Head -> Finance.
--    One row per step per count, so a returned count keeps its history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_cycle_count_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_count_id INTEGER NOT NULL REFERENCES erp_cycle_counts(id),
  step_no INTEGER NOT NULL,
  stage TEXT NOT NULL,                    -- DEPT_MANAGER | DEPT_HEAD | FINANCE
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | RETURNED
  decided_by TEXT,
  decided_at TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_approvals_count
  ON erp_cycle_count_approvals(cycle_count_id, step_no);

-- The chain is configurable in the same place every other rule lives, so it can
-- be turned off for a site that does not want three signatures on a count.
INSERT OR IGNORE INTO erp_settings(key, value)
  VALUES ('cycle_count_chain', '1');

-- ---------------------------------------------------------------------------
-- 3. Pre-release now applies to every category, not just motorcycles. Nothing
--    to migrate - the rule lives in the route - but record the intent so the
--    change is discoverable from the schema history.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_settings(key, value)
  VALUES ('pre_release_all_categories', '1');

-- ---------------------------------------------------------------------------
-- 4. A posted goods return notifies Finance and the department head.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_settings(key, value)
  VALUES ('notify_on_return_posted', '1');
