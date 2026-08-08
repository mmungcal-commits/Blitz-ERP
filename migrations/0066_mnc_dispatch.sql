-- 0066 · CEO approval is not the end of the RFP
--
-- On the Apps Script that E88 actually run, the CEO's signature does not release
-- the money. It sends the request back to Finance at a stage called MNC Dispatch,
-- where Finance composes the email to Monde Nissin carrying the signed RFP and
-- its attachments:
--
--     // Final approval (CEO): route back to Finance to compose & dispatch the
--     // signed RFP to MNC.
--     r.stage = 'MNC Dispatch'; r.status = 'Pending';
--
-- Only after that comes Proof of Payment, then Done. Blitz had no equivalent, so
-- an approved request and a dispatched one looked identical and nobody could ask
-- which fully signed requests were still sitting on somebody's desk.
--
-- A table rather than a column on erp_payment_requests, for two reasons. ALTER
-- TABLE is not re-runnable and these migrations run on every deploy (see the
-- note about 0037 in the workflow). And a dispatch can happen more than once:
-- the first email bounces, the contact changes, MNC ask for it again. Each
-- attempt is a row, the latest SENT one is the state.

CREATE TABLE IF NOT EXISTS erp_rfp_dispatches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  rfp_ref            TEXT NOT NULL,
  payment_request_id INTEGER,
  dispatched_to      TEXT NOT NULL,
  dispatched_cc      TEXT,
  subject            TEXT,
  message            TEXT,
  attachment_count   INTEGER NOT NULL DEFAULT 0,
  amount             REAL,
  dispatched_by      TEXT,
  dispatched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status             TEXT NOT NULL DEFAULT 'SENT',   -- SENT | FAILED | VOID
  mail_result        TEXT,
  void_reason        TEXT,
  voided_by          TEXT,
  voided_at          TEXT
);

CREATE INDEX IF NOT EXISTS ix_erp_rfp_dispatches_ref ON erp_rfp_dispatches(rfp_ref);
CREATE INDEX IF NOT EXISTS ix_erp_rfp_dispatches_status ON erp_rfp_dispatches(status);

/*
 * Settings, all three left for Finance to fill in rather than guessed here.
 *
 * mnc_dispatch_to is blank on purpose: the Apps Script keeps the MNC address in
 * a Script Property, and inventing an address in a migration is how mail ends up
 * somewhere it should not. The first dispatch asks for it and remembers it, the
 * same way setMncEmail() does on the old system.
 *
 * rfp_require_dispatch is the gate. With it on, a request cannot be paid until
 * it has been dispatched, which is the sequence the old system enforces by
 * having no payment stage before MNC Dispatch. If it gets in the way:
 *   UPDATE erp_rfp_settings SET value='0' WHERE key='rfp_require_dispatch';
 */
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('mnc_dispatch_to','');
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('mnc_dispatch_cc','');
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('rfp_require_dispatch','1');

/*
 * History is not rewritten.
 *
 * The 252 requests loaded from the procurement register were paid long before
 * the ERP tracked a dispatch, and writing a dispatch row for them would assert
 * something nobody recorded. They need none: the queue this feature exists to
 * produce is "approved, not yet dispatched, not yet paid", and a request that
 * is already paid is not in it.
 */
