-- 0059 · Who typed it in is not who asked for it
--
-- Rucel encodes every request for payment and checks every one of them. Both
-- are her job, and the two together looked to the system like one person
-- approving their own request: the separation-of-duties rule reads the
-- requestor, the requestor was whoever created the record, and the person
-- creating the record was always Rucel. She would have been refused at the
-- Finance check on every request in the company.
--
-- The rule is right. What was wrong was the record. Somebody in Operations
-- asks for the payment; Rucel types it in. Those are two people and the
-- request should say so, and then the rule works as intended: she may check a
-- request she encoded for somebody else, and may not check one raised for
-- herself.
--
-- A side table rather than a column, because erp_payment_requests is live.
--
-- Re-runnable: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS erp_rfp_encoders (
  request_no  TEXT PRIMARY KEY,
  encoded_by  TEXT NOT NULL,
  encoded_for TEXT,                       -- who it was typed in on behalf of
  encoded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfp_encoder_by ON erp_rfp_encoders(encoded_by);

/*
 * The whole register was loaded under one address, so every imported request
 * already carries an encoder in spirit. Saying so on the record means the
 * approval trail on an imported request reads honestly rather than implying
 * a person raised it.
 */
INSERT OR IGNORE INTO erp_rfp_encoders(request_no,encoded_by,encoded_for,note)
SELECT r.request_no, r.requestor_email, r.payee_name,
       'Loaded from the 2026 procurement register.'
  FROM erp_payment_requests r
 WHERE r.requestor_email='procurement-register@nrdev.ph';

-- Rucel encodes and reviews. She does not approve: that line is drawn in
-- 0043 (can_approve = 0) and nothing here moves it.
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('rfp_encoder_role','FINANCE_REVIEWER');
