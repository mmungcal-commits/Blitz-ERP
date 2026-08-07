-- 0050 · What a request for payment is actually made of
--
-- A single RFP routinely spans several account titles: a site deployment that
-- is part equipment, part freight, part meals. Holding only the header total
-- means the general ledger cannot post it - somebody has to sit with the paper
-- and split it by hand, which is where the coding errors come from.
--
-- So the lines live here, each with its own account title, VAT treatment and
-- withholding, and the header total is the sum of them rather than a number
-- typed alongside them.
--
-- Re-runnable: CREATE ... IF NOT EXISTS only, no ALTER.

CREATE TABLE IF NOT EXISTS erp_payment_request_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_request_id INTEGER REFERENCES erp_payment_requests(id),
  -- The RFP number is carried too, because the register is loaded by number
  -- before the header ids are known, and because it is what people quote.
  rfp_ref TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  proc_id TEXT,                       -- PROC-00001, the monitoring sheet's own key
  line_date TEXT,

  requesting_party TEXT,
  -- The budget category is the corrected accounting title and is what the
  -- ledger posts to. The sheet's own "Account Title" column is kept beside it
  -- because the two disagree in places, and the original is what somebody will
  -- be looking at when they query a line.
  account_title TEXT,                 -- the GL account this line posts to
  source_account_title TEXT,          -- what the monitoring sheet had against it
  budget_category TEXT,
  procurement_category TEXT,          -- Inventory Purchase | OPEX | CAPEX | Service | ...
  description TEXT,
  project_site TEXT,
  cost_center TEXT,
  department TEXT,

  supplier_invoice_no TEXT,
  invoice_date TEXT,
  po_no TEXT,

  gross_amount REAL NOT NULL DEFAULT 0,
  vat_type TEXT,                      -- VATable | Non-VAT | Zero Rated
  vat_rate REAL NOT NULL DEFAULT 0,
  net_of_vat REAL NOT NULL DEFAULT 0,
  input_vat REAL NOT NULL DEFAULT 0,
  ewt_rate TEXT,
  ewt_amount REAL NOT NULL DEFAULT 0,
  net_payable REAL NOT NULL DEFAULT 0,

  payment_reference TEXT,
  paid_date TEXT,
  remarks TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One line number per request. Re-running the load cannot double the money.
  UNIQUE(rfp_ref, line_no)
);
CREATE INDEX IF NOT EXISTS idx_rfp_lines_req     ON erp_payment_request_lines(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_rfp_lines_ref     ON erp_payment_request_lines(rfp_ref);
CREATE INDEX IF NOT EXISTS idx_rfp_lines_account ON erp_payment_request_lines(account_title);
CREATE INDEX IF NOT EXISTS idx_rfp_lines_paid    ON erp_payment_request_lines(paid_date);

/*
 * Finance works to a service level: a vendor is paid within ten banking days of
 * the request. Holding the target as data rather than in code means Finance can
 * change it when the policy changes, without a deployment.
 */
CREATE TABLE IF NOT EXISTS erp_service_levels (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  target_days INTEGER NOT NULL,
  basis TEXT NOT NULL DEFAULT 'BANKING',   -- BANKING | CALENDAR
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO erp_service_levels(code,label,target_days,basis) VALUES
  ('RFP_PAYMENT','Vendor paid from request',10,'BANKING'),
  ('RFP_APPROVAL','Request approved from submission',3,'BANKING'),
  ('AR_COLLECTION','Collection posted from receipt',2,'BANKING');
