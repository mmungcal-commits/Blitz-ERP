-- 0052 · Recording a collection, then posting it
--
-- Two different acts that were one before this. Recording says the money came
-- in: who paid, how much, by what method, against which entry. Posting says the
-- money is in the bank: it writes the deposit to the bank register and moves
-- that account's balance.
--
-- Keeping them apart is what lets Finance check a receipt against the bank
-- before it touches a balance, and it is why a mistyped collection can be
-- corrected instead of unwound through the ledger.
--
-- A side table rather than columns on erp_ar_receipts, because that table is
-- already live and this migration has to be safe to re-run.

CREATE TABLE IF NOT EXISTS erp_ar_receipt_postings (
  receipt_id INTEGER PRIMARY KEY REFERENCES erp_ar_receipts(id),
  status TEXT NOT NULL DEFAULT 'POSTED',      -- POSTED | REVERSED
  bank_account_id INTEGER REFERENCES erp_bank_accounts(id),
  bank_transaction_id INTEGER REFERENCES erp_bank_transactions(id),
  posted_amount REAL NOT NULL DEFAULT 0,
  posted_by TEXT,
  posted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_by TEXT,
  reversed_at TEXT,
  reverse_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ar_posting_bank ON erp_ar_receipt_postings(bank_account_id, status);

/*
 * The banks and wallets money actually arrives in. The register already offers
 * these names on a collection; without an account behind each one there is
 * nowhere for a posted deposit to land.
 *
 * Every one points at the same cash control account for now. Finance can split
 * them onto their own GL accounts from Accounts & Periods without a deployment.
 */
INSERT OR IGNORE INTO erp_bank_accounts
  (bank_account_code, entity_id, bank_name, account_name, account_number_masked, currency, gl_account_id, opening_balance, active)
SELECT code, (SELECT id FROM erp_legal_entities WHERE entity_code='E88'),
       bank, name, '****', 'PHP',
       (SELECT id FROM erp_chart_accounts WHERE account_code='1010'), 0, 1
FROM (
  SELECT 'XENDIT'       code, 'XENDIT'       bank, 'Xendit Clearing'          name UNION ALL
  SELECT 'MBTC-PHP',          'MBTC PHP',           'Metrobank PHP'                UNION ALL
  SELECT 'MBTC-USD',          'MBTC USD',           'Metrobank USD'                UNION ALL
  SELECT 'GCASH',             'GCash',              'GCash Wallet'                 UNION ALL
  SELECT 'MAYA',              'Maya',               'Maya Wallet'                  UNION ALL
  SELECT 'CASH-ON-HAND',      'Cash on Hand',       'Cash on Hand'                 UNION ALL
  SELECT 'OTHER-BANK',        'Other Bank',         'Other Bank'
) x
WHERE EXISTS (SELECT 1 FROM erp_chart_accounts WHERE account_code='1010')
  AND NOT EXISTS (SELECT 1 FROM erp_bank_accounts b WHERE b.bank_account_code=x.code);

/*
 * Which name on a collection means which bank account. Held as data so a new
 * wallet is a row, not a release.
 */
CREATE TABLE IF NOT EXISTS erp_bank_aliases (
  alias TEXT PRIMARY KEY,
  bank_account_code TEXT NOT NULL
);
INSERT OR IGNORE INTO erp_bank_aliases(alias,bank_account_code) VALUES
  ('BDO','BDO-MAIN'),('BDO DEPOSIT','BDO-MAIN'),('BDO-MAIN','BDO-MAIN'),
  ('XENDIT','XENDIT'),
  ('MBTC PHP','MBTC-PHP'),('MBTC PHP DEPOSIT','MBTC-PHP'),
  ('MBTC USD','MBTC-USD'),('MBTC USD DEPOSIT','MBTC-USD'),
  ('GCASH','GCASH'),('MAYA','MAYA'),
  ('CASH','CASH-ON-HAND'),('CASH ON HAND','CASH-ON-HAND'),
  ('OTHER BANK','OTHER-BANK'),('CHECK','OTHER-BANK'),('BANK TRANSFER','BDO-MAIN');
