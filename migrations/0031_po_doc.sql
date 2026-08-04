-- Extra purchase-order document fields to match the shared PO PDF layout
CREATE TABLE IF NOT EXISTS erp_po_doc(
  purchase_order_id INTEGER PRIMARY KEY,
  meta TEXT
);
