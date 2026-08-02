-- 0026_by_class_reconciliation_views.sql
-- Keep inventory reconciliation strictly BY CLASS. Motorcycles, batteries and
-- swap stations are different by nature and reconcile to their OWN control
-- accounts; they are never netted into one figure. A per-class truth flag is
-- exposed so nothing downstream can hide an offsetting break.

-- Per-class reconciliation status (authoritative)
DROP VIEW IF EXISTS vw_erp_inventory_class_reconciliation_status;
CREATE VIEW vw_erp_inventory_class_reconciliation_status AS
SELECT class_code, class_name, account_code,
       subledger_value, gl_value, difference,
       CASE WHEN ABS(difference) <= 0.01 THEN 'RECONCILED' ELSE 'REVIEW_REQUIRED' END status
FROM vw_erp_inventory_class_reconciliation;

-- Combined view keeps additive PESO totals for the balance sheet, but adds a
-- per-class truth flag. all_classes_reconciled is 1 only when EVERY class ties
-- out on its own — it cannot be faked by classes offsetting each other.
DROP VIEW IF EXISTS vw_erp_inventory_gl_reconciliation;
CREATE VIEW vw_erp_inventory_gl_reconciliation AS
SELECT
  ROUND(COALESCE(SUM(subledger_value),0),2)      inventory_subledger,
  ROUND(COALESCE(SUM(gl_value),0),2)             inventory_general_ledger,
  SUM(CASE WHEN ABS(difference) > 0.01 THEN 1 ELSE 0 END) classes_needing_review,
  CASE WHEN SUM(CASE WHEN ABS(difference) > 0.01 THEN 1 ELSE 0 END) = 0
       THEN 1 ELSE 0 END                          all_classes_reconciled
FROM vw_erp_inventory_class_reconciliation;
