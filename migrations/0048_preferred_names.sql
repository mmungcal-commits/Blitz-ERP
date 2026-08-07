-- 0048 · The name a person is called by
--
-- display_name is the name on the document: it is printed on approvals and
-- signed forms, so it has to stay the full legal name. The name a person is
-- actually called by is a different thing, and the screen should use it.
-- Alexis Mungcal is on record as Mark Alexis Mungcal and goes by Alexis.
--
-- A side table rather than a column, so this migration is safe to re-run.

CREATE TABLE IF NOT EXISTS erp_user_preferred_names (
  email TEXT PRIMARY KEY,
  preferred_name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO erp_user_preferred_names(email,preferred_name)
  VALUES('mmungcal@nrdev.ph','Alexis');
