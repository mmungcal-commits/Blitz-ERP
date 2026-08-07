-- 0053 · One document, linked once
--
-- erp_attachments has no uniqueness on it, so the INSERT OR IGNORE that links
-- an RFP to its Drive document was not idempotent after all: the register was
-- loaded twice while the deploy was being fixed, and every imported request now
-- carries the same document twice. Nothing is wrong with the money, but a
-- record that shows its own attachment twice invites the question of which one
-- is real, and it would double again on the next deploy.
--
-- So the duplicates go, and an index stops them coming back.
--
-- Re-runnable: the delete is a no-op once there is nothing left to delete, and
-- the index is IF NOT EXISTS.

-- Keep the first row of each identical link and drop the rest. Identical means
-- the same record, the same Drive file: two genuinely different documents on
-- one request are left alone.
DELETE FROM erp_attachments
 WHERE id NOT IN (
   SELECT MIN(id) FROM erp_attachments
    GROUP BY record_type, COALESCE(record_no,''), COALESCE(record_id,0),
             COALESCE(drive_file_id,''), COALESCE(file_url,''), file_name
 );

-- A link is the pair of a record and a Drive file. Saying so here is what makes
-- the loader idempotent rather than merely careful.
CREATE UNIQUE INDEX IF NOT EXISTS ux_attach_record_drive
  ON erp_attachments(record_type, record_no, drive_file_id)
  WHERE drive_file_id IS NOT NULL AND drive_file_id <> '';
