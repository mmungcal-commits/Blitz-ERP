-- 0055 · Paid is a sum of settlements, and it needs evidence
--
-- Three things were wrong with treating payment as a switch on the request.
--
-- A request can be part paid. Xiamen Ampace was raised for PHP 9,302,256.00
-- against a 30% down payment; a system that only knows PAID and not-paid has to
-- call that either a lie or a nine million peso liability that does not exist.
-- So a payment is now a row, a request can carry several, and what is settled
-- and what is still owed are added up rather than asserted.
--
-- Paid also has to be evidenced. The 2026 register was loaded from a
-- spreadsheet, and a reference typed into a spreadsheet column is a claim, not
-- a document. Every settlement carries who recorded it, where the money went,
-- and whether the proof of payment is actually on the record.
--
-- And the most recent requests have no proof at all yet, so they are held out
-- of paid until somebody uploads it. The cutoff is a setting rather than a
-- constant here, because it moves as the year does.
--
-- Re-runnable: the table is IF NOT EXISTS, every settlement carries a natural
-- key and is inserted only when that key is absent, and the status corrections
-- are idempotent UPDATEs.

CREATE TABLE IF NOT EXISTS erp_payment_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL,
  payment_request_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  paid_date TEXT,
  payment_reference TEXT,
  payment_method TEXT,
  bank_account_id INTEGER REFERENCES erp_bank_accounts(id),
  -- Proof of payment: the document, who put it there, and when. Null means
  -- the money is claimed to have moved but nobody has shown it yet.
  proof_attachment_id INTEGER REFERENCES erp_attachments(id),
  proof_reference TEXT,
  proof_uploaded_by TEXT,
  proof_uploaded_at TEXT,
  -- How this settlement came to exist. REGISTER_IMPORT means it was read off
  -- the 2026 procurement sheet and has never been through the workflow.
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'SETTLED',      -- SETTLED | VOID
  voided_by TEXT,
  voided_at TEXT,
  void_reason TEXT,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- What makes the loader safe to run twice.
  natural_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_pay_settle_request ON erp_payment_settlements(request_no, status);
CREATE INDEX IF NOT EXISTS idx_pay_settle_date ON erp_payment_settlements(paid_date);

-- The date from which a payment needs its proof on the record before it may be
-- called paid. Everything before it came out of the register with a cheque or
-- liquidation reference behind it; everything from here has not been evidenced
-- yet. Finance moves this in Accounts & Periods, not in a deployment.
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES
  ('rfp_paid_evidence_from','2026-07-31');

/*
 * Every request already standing as paid gets the settlement that says so, at
 * its full net payable, carrying whatever evidence the register had. This is
 * what turns 318 flat PAID flags into 318 payments that can be listed, totalled
 * and questioned one at a time.
 */
INSERT INTO erp_payment_settlements
  (request_no,payment_request_id,amount,paid_date,payment_reference,source,recorded_by,notes,natural_key)
SELECT r.request_no, r.id, r.net_payable,
       NULLIF(COALESCE(r.paid_at,''),''), NULLIF(COALESCE(r.payment_reference,''),''),
       CASE WHEN r.requestor_email='procurement-register@nrdev.ph' THEN 'REGISTER_IMPORT' ELSE 'SYSTEM' END,
       COALESCE(r.paid_by,r.requestor_email),
       CASE WHEN r.requestor_email='procurement-register@nrdev.ph'
            THEN 'Settled per the 2026 procurement register. Proof of payment not yet uploaded.'
            ELSE NULL END,
       'FULL:'||r.request_no
  FROM erp_payment_requests r
 WHERE r.status='PAID'
   AND NOT EXISTS (SELECT 1 FROM erp_payment_settlements s
                    WHERE s.request_no=r.request_no AND s.status<>'VOID');

/*
 * Xiamen Ampace Technology, RFP-OPS2026-00101, PHP 9,302,256.00 for cells: 30%
 * down, the balance on terms. The down payment is recorded as its own
 * settlement, the request stands as part paid, and PHP 6,511,579.20 stays
 * visibly owed instead of quietly disappearing into a paid flag.
 *
 * No paid date and no proof, because neither has been given yet. Finance
 * attaches the bank advice against this settlement and the record closes
 * itself.
 */
INSERT INTO erp_payment_settlements
  (request_no,payment_request_id,amount,payment_method,source,recorded_by,notes,natural_key)
SELECT r.request_no, r.id, ROUND(r.net_payable*0.30,2), 'BANK TRANSFER', 'SYSTEM',
       'mmungcal@nrdev.ph',
       '30% down payment. Balance due on terms. Proof of payment to be uploaded.',
       'DOWNPAYMENT:'||r.request_no
  FROM erp_payment_requests r
 WHERE r.request_no='RFP-OPS2026-00101'
   AND NOT EXISTS (SELECT 1 FROM erp_payment_settlements s
                    WHERE s.natural_key='DOWNPAYMENT:'||r.request_no);

UPDATE erp_payment_requests
   SET status='PARTIALLY_PAID', updated_at=datetime('now')
 WHERE request_no='RFP-OPS2026-00101'
   AND status IN ('DRAFT','RETURNED','SUBMITTED','APPROVED','PAID');

/*
 * Nothing requested on or after the evidence cutoff may stand as paid without
 * proof on the record. Today this corrects nothing: the four requests dated
 * 31 July came in as drafts. It is here so that reloading the register, or a
 * later sheet, cannot quietly post a payment nobody can show.
 */
UPDATE erp_payment_requests
   SET status='APPROVED', paid_at=NULL, paid_by=NULL, updated_at=datetime('now')
 WHERE status='PAID'
   AND request_date >= COALESCE((SELECT value FROM erp_rfp_settings WHERE key='rfp_paid_evidence_from'),'2026-07-31')
   -- Only the loader's own claims. A payment somebody recorded in the system,
   -- with their name against it, is not the loader's to reverse.
   AND NOT EXISTS (SELECT 1 FROM erp_payment_settlements s
                    WHERE s.request_no=erp_payment_requests.request_no
                      AND s.status<>'VOID' AND s.source<>'REGISTER_IMPORT')
   AND NOT EXISTS (SELECT 1 FROM erp_rfp_proof_of_payment p WHERE p.rfp_ref=erp_payment_requests.request_no)
   AND NOT EXISTS (SELECT 1 FROM erp_attachments a
                    WHERE a.record_type='PAYMENT_PROOF' AND a.record_no=erp_payment_requests.request_no
                      AND a.active=1);

/*
 * And drop the settlement that was written for any request the rule just pulled
 * back, so the two never disagree.
 *
 * Only ever the loader's own row, only while it is untouched: a settlement
 * somebody has voided carries the reason they voided it, and one that has had
 * its bank advice attached is evidence. Deleting either would erase a person's
 * work on the next deploy.
 */
DELETE FROM erp_payment_settlements
 WHERE source='REGISTER_IMPORT'
   AND status<>'VOID' AND voided_at IS NULL
   AND proof_attachment_id IS NULL AND COALESCE(proof_reference,'')=''
   AND natural_key IN (
     SELECT 'FULL:'||r.request_no FROM erp_payment_requests r
      WHERE r.status NOT IN ('PAID','PARTIALLY_PAID','PAID_UNPROVEN')
   );

-- Point settlements at their request where the id was not known at insert time.
UPDATE erp_payment_settlements
   SET payment_request_id=(SELECT p.id FROM erp_payment_requests p
                            WHERE p.request_no=erp_payment_settlements.request_no)
 WHERE payment_request_id IS NULL;

/*
 * Proof of payment is a document type of its own. It was previously written
 * into the request's general attachment pile at the confirm-paid step, which
 * meant an imported request had nowhere to put one and a reader could not tell
 * a bank advice from a quotation. PAYMENT_PROOF says which is which.
 */
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES
  ('rfp_proof_record_type','PAYMENT_PROOF');
