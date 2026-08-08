-- 0065 · A deletion stays deleted
--
-- Alexis deleted entries from the receivables register and they came back on
-- the next deploy. This is not a mystery and it is not a one-off: it is the
-- shape of every seed migration in this repo.
--
-- 0060 loads the 2026 sales monitoring sheet with a guard that reads
--
--     INSERT ... SELECT ... WHERE NOT EXISTS
--       (SELECT 1 FROM erp_ar_collections c WHERE c.source_key='SM:Leases:14');
--
-- The guard asks "is this row already here?" and the answer, after somebody
-- deletes it, is no. So the migration puts it back. Every deploy. The guard
-- was written to make the import safe to re-run, and it does that; what it
-- cannot tell apart is a row that was never loaded from a row that was loaded
-- and then deliberately thrown away.
--
-- The same hole eats a voided receipt. 0060 part 2 creates a receipt for any
-- posted collection with NOT EXISTS (... r.status<>'VOID'), so voiding the
-- only receipt on an entry satisfies the guard and the next deploy writes a
-- fresh ACTIVE one beside the void, with the same receipt number.
--
-- The fix is a tombstone. When an imported row is deleted through the app we
-- write down that it was deleted, and this migration - which runs after every
-- seed - carries the deletion out again. The re-import still happens; it just
-- does not survive the same deploy that caused it.
--
-- To bring a row back, delete its tombstone and redeploy. That is deliberate:
-- undoing a deletion should take an explicit act, not a silent one.

CREATE TABLE IF NOT EXISTS erp_import_tombstones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name    TEXT NOT NULL,
  source_system TEXT,
  source_key    TEXT NOT NULL,
  record_no     TEXT,
  reason        TEXT,
  deleted_by    TEXT,
  deleted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_import_tombstones
  ON erp_import_tombstones(table_name, source_key);

CREATE INDEX IF NOT EXISTS ix_erp_ar_collections_source_key
  ON erp_ar_collections(source_key);

/*
 * Receipts first, then the collection, so nothing is left pointing at a row
 * that no longer exists.
 */
DELETE FROM erp_ar_receipts
 WHERE collection_id IN (
   SELECT c.id FROM erp_ar_collections c
     JOIN erp_import_tombstones t
       ON t.table_name='erp_ar_collections' AND t.source_key=c.source_key
 );

DELETE FROM erp_ar_collections
 WHERE source_key IS NOT NULL
   AND source_key IN (
     SELECT source_key FROM erp_import_tombstones WHERE table_name='erp_ar_collections'
   );

/*
 * The voided receipt is handled at the source instead, in 0060 part 2: its
 * guard no longer ignores VOID rows, so the import cannot write a second
 * receipt over one somebody voided. That one would not have produced a
 * duplicate anyway - receipt_no is unique, so the insert failed outright and
 * took the rest of the migration down with it. Worth naming here because the
 * two bugs share a cause: a guard that asks "is this row live?" when the
 * question is "has this row ever been written?"
 *
 * Any receipt orphaned by an earlier hand-deletion of its collection, from
 * before the delete route cleared them, goes now.
 */
DELETE FROM erp_ar_receipts
 WHERE NOT EXISTS (SELECT 1 FROM erp_ar_collections c WHERE c.id = erp_ar_receipts.collection_id);
