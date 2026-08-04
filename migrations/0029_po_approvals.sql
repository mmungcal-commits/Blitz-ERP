-- PO approval chain with e-signatures and no-login token links
CREATE TABLE IF NOT EXISTS erp_po_approvals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  purchase_order_no TEXT,
  step_no INTEGER NOT NULL,
  role TEXT NOT NULL,
  approver_name TEXT,
  approver_email TEXT,
  token TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  signature TEXT,
  signature_type TEXT,
  comment TEXT,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_po_appr_po ON erp_po_approvals(purchase_order_id);
CREATE INDEX IF NOT EXISTS ix_po_appr_token ON erp_po_approvals(token);
