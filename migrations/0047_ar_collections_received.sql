-- 0047 · Money received against a posted receivable
--
-- The register holds what the customer was billed. Posting is what makes that
-- billing real. What the customer then actually pays is a separate fact, on a
-- separate date, often in several parts, and sometimes it bounces. Keeping it
-- in its own table is what lets collection % and receivables % be measured
-- instead of assumed: billed is the posted register, collected is the sum of
-- live receipts against it, and outstanding is the difference.
--
-- Re-runnable: CREATE ... IF NOT EXISTS and INSERT OR IGNORE only, no ALTER.

CREATE TABLE IF NOT EXISTS erp_ar_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,            -- OR-2026-00001
  collection_id INTEGER NOT NULL REFERENCES erp_ar_collections(id),
  entry_no TEXT,                              -- denormalised for the register view
  receipt_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,

  payment_method TEXT,
  bank_wallet TEXT,
  bank_ref TEXT,
  or_no TEXT,                                 -- official receipt number issued
  settlement_date TEXT,
  cleared_status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | CLEARED | BOUNCED

  remarks TEXT,
  -- A receipt is never deleted. A wrong one is voided with a reason and stays
  -- visible, because a collection that was recorded and reversed is itself a
  -- fact Finance needs to be able to see.
  status TEXT NOT NULL DEFAULT 'ACTIVE',      -- ACTIVE | VOID
  void_reason TEXT,

  received_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ar_rcpt_coll ON erp_ar_receipts(collection_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_rcpt_date ON erp_ar_receipts(receipt_date);

INSERT OR IGNORE INTO erp_sequences(code,next_value,prefix,width)
  VALUES('AR_RECEIPT',1,'OR-2026',5);
