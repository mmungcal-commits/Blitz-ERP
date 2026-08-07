-- 0049 · Statement of account
--
-- A statement is what the customer is shown: a month of charges, what they
-- paid against it, and what is left. It is generated from the register rather
-- than typed, so it cannot disagree with the books - but it stays editable
-- until it is issued, because a real statement often carries a line the ledger
-- does not (an agreed adjustment, a note about a disputed charge).
--
-- Once issued it freezes. A statement the customer has seen is a document, and
-- a document that changes after it is sent is worth nothing.
--
-- Re-runnable: CREATE ... IF NOT EXISTS and INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS erp_ar_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_no TEXT NOT NULL UNIQUE,        -- SOA-2026-00001
  customer_id INTEGER REFERENCES erp_partners(id),
  customer_name TEXT NOT NULL,
  period_month TEXT NOT NULL,               -- 2026-03
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,

  opening_balance REAL NOT NULL DEFAULT 0,
  billed_amount REAL NOT NULL DEFAULT 0,
  collected_amount REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL DEFAULT 0,

  notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',     -- DRAFT | ISSUED | VOID
  issued_by TEXT,
  issued_at TEXT,
  void_reason TEXT,

  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One statement per customer per month. A second one for the same period is
  -- how two different closing balances end up in circulation.
  UNIQUE(customer_name, period_month)
);
CREATE INDEX IF NOT EXISTS idx_ar_soa_cust  ON erp_ar_statements(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_soa_month ON erp_ar_statements(period_month, status);

CREATE TABLE IF NOT EXISTS erp_ar_statement_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_id INTEGER NOT NULL REFERENCES erp_ar_statements(id),
  line_no INTEGER NOT NULL,
  line_date TEXT,
  reference TEXT,                           -- AR entry no. or OR no.
  description TEXT,
  charge REAL NOT NULL DEFAULT 0,           -- what was billed
  credit REAL NOT NULL DEFAULT 0,           -- what was received
  source_type TEXT,                         -- COLLECTION | RECEIPT | MANUAL
  source_id INTEGER,
  UNIQUE(statement_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ar_soa_lines ON erp_ar_statement_lines(statement_id);

INSERT OR IGNORE INTO erp_sequences(code,next_value,prefix,width)
  VALUES('AR_STATEMENT',1,'SOA-2026',5);
