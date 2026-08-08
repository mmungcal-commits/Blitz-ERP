-- 0067 · Monde Nissin have to be able to open the signed form
--
-- The dispatch built in R64 sends the supporting documents and not the request
-- for payment itself. That form exists only as a print view inside Blitz, so
-- what actually reached MNC was a covering email with the invoices attached and
-- no signed RFP, which is the one page they need: four signatures, the payee
-- bank details and the amount released.
--
-- MNC have no Blitz login and should not need one to read a document E88 chose
-- to send them. So the dispatch carries a link, and the link carries a token:
-- unguessable, tied to one request, revocable, and recorded against whoever
-- created it.
--
-- One row per request, reused on a re-dispatch, so re-sending does not
-- invalidate the link already sitting in somebody's inbox.

CREATE TABLE IF NOT EXISTS erp_rfp_doc_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfp_ref     TEXT NOT NULL,
  token       TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  view_count  INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0,
  revoked_by  TEXT,
  revoked_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_rfp_doc_tokens_token ON erp_rfp_doc_tokens(token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_rfp_doc_tokens_ref   ON erp_rfp_doc_tokens(rfp_ref);

/*
 * The view count is not decoration. "Did MNC ever open it?" is the first
 * question Finance ask when a payment goes quiet, and until now the honest
 * answer was that nobody could tell.
 */
