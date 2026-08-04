-- Departments master (managed in Master Reference) + a sample requisition to make
-- the outbound flow testable. Idempotent.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS erp_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO erp_departments(code,name) VALUES
('FIN','Finance and Accounting'),
('SCM','Supply Chain'),
('LOG','Logistics'),
('OPS','Operations & Product'),
('HR','Human Resources'),
('CMP','Compliance'),
('PMO','Program Management'),
('TECH','Technology'),
('CS','Customer Success'),
('RBX','RideBox / Stations'),
('SALES','Sales'),
('AFS','After Sales'),
('WH','Warehouse'),
('ADM','Admin');

-- Sample requisition: requisition -> pre-release -> goods issuance -> delivery is now walkable.
INSERT OR IGNORE INTO erp_requisitions(requisition_no,request_date,requestor_email,requestor_name,department,purpose,fulfillment_method,partner_id,destination,required_date,status,source_system)
SELECT 'REQ000001','2026-08-01','raymond.ops@nrdev.ph','Raymond Ops','Supply Chain','Lease deployment to RideBox fleet','DELIVERY',
  (SELECT id FROM erp_partners WHERE partner_code='C-RIDEBOX'),'BGC, Taguig City','2026-08-10','SUBMITTED','DEMO'
WHERE NOT EXISTS(SELECT 1 FROM erp_requisitions WHERE requisition_no='REQ000001');

INSERT OR IGNORE INTO erp_requisition_lines(requisition_id,item_id,item_code,description,qty,serial_required,fulfilled_qty)
SELECT r.id,i.id,'MC000001','E88 Explorer E-Motorcycle',1,1,0
FROM erp_requisitions r JOIN erp_items i ON i.item_code='MC000001'
WHERE r.requisition_no='REQ000001'
  AND NOT EXISTS(SELECT 1 FROM erp_requisition_lines l WHERE l.requisition_id=r.id);

INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES('DEPARTMENTS_LOADED','2026-08-04',datetime('now'));
