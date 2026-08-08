-- 0063 · An entry that has been paid in full says so
--
-- The sales register shows PENDING against entries that were collected in full
-- and posted. The register is right that they are posted and wrong that the
-- money is still in the air: the receipts are there, the balance is nought.
--
-- Why it happened: cleared_status is only ever written when a collection is
-- recorded through /collections/:id/collect, and the entries loaded from the
-- 2026 sales monitoring sheet were posted with their receipts in one go by
-- migration 0060. Nothing came back afterwards to say the money had landed.
--
-- Why this is a migration rather than an edit: the API refuses to PATCH a
-- posted entry, correctly - a posted receivable is not a form. So the
-- correction belongs in the deploy, where it is recorded, reviewable and
-- re-runnable, rather than typed into a database by hand.
--
-- SCOPE, and this is the whole point of the file:
--
-- Only entries whose receipts actually cover the gross are cleared. "Cleared"
-- means the money reached the bank, and an entry sitting at nought collected is
-- pending in the truest sense - somebody still has to chase it. On the live
-- register that is 20 entries worth 1.45 million pesos, and sweeping those into
-- CLEARED would empty the ageing report, flatter the collection rate, and hide
-- the very balances Finance exists to pursue.
--
-- Re-runnable: the WHERE clause only ever matches rows that are both posted and
-- fully receipted, so a second run changes nothing.

UPDATE erp_ar_collections
   SET cleared_status = 'CLEARED',
       settlement_date = COALESCE(NULLIF(settlement_date,''),
         (SELECT MAX(r.settlement_date) FROM erp_ar_receipts r
           WHERE r.collection_id = erp_ar_collections.id AND r.status = 'ACTIVE'),
         txn_date),
       updated_at = datetime('now')
 WHERE status = 'POSTED'
   AND COALESCE(cleared_status,'') <> 'CLEARED'
   AND gross_amount > 0
   /*
    * Fully receipted. Rounded to the centavo before comparing, because a
    * receipt split across two payments can land a hundredth of a peso short
    * and leave a paid invoice looking eternally outstanding.
    */
   AND ROUND(COALESCE((SELECT SUM(r.amount) FROM erp_ar_receipts r
         WHERE r.collection_id = erp_ar_collections.id AND r.status = 'ACTIVE'),0), 2)
       >= ROUND(gross_amount, 2) - 0.01;
