-- 0062 · An item's class is one of six codes, not whatever word was typed
--
-- The live count found this. Three hundred and forty Ampace battery packs were
-- scanned against ESP00263, and the item master says its class is "BATTERY".
-- The register groups by MC, BAT, BSS, SP, CHG and OTH, so "BATTERY" is not a
-- class at all: every one of those packs would have been invisible under
-- Batteries and absent from the by-class reconciliation.
--
-- 0035 meant to set it. It seeds ESP00263 as BAT - but with INSERT OR IGNORE,
-- and the row already existed, auto-created from a receipt with whatever word
-- the source document used. INSERT OR IGNORE creates or skips; it never
-- corrects, so the seed did nothing and the loose word stayed for good.
--
-- This repairs every such row by the same rules the application uses in
-- categoryCode(), in the same order. Rows already carrying a canonical code are
-- not touched, so a deliberate classification cannot be overwritten by a guess.
--
-- Re-runnable: the WHERE clause excludes anything already canonical, so the
-- second run changes nothing.

/*
 * Station before battery.
 *
 * "Battery swapping station" contains the word battery and is not one. Ordering
 * the CASE the other way round would file every swapping station in the
 * kingdom under batteries, which is precisely the confusion this is here to
 * clear up.
 */
UPDATE erp_items
   SET category = CASE
         WHEN UPPER(TRIM(category)) LIKE '%MOTOR%' THEN 'MC'
         WHEN UPPER(TRIM(category)) LIKE '%LOCKER%'
           OR UPPER(TRIM(category)) LIKE '%STATION%'
           OR UPPER(TRIM(category)) LIKE '%BSS%'
           OR UPPER(TRIM(category)) LIKE '%SPACEPORT%' THEN 'BSS'
         WHEN UPPER(TRIM(category)) LIKE '%BAT%' THEN 'BAT'
         WHEN UPPER(TRIM(category)) LIKE '%SPARE%'
           OR UPPER(TRIM(category)) LIKE '%PART%' THEN 'SP'
         WHEN UPPER(TRIM(category)) LIKE '%CHARG%' THEN 'CHG'
         ELSE 'OTH' END
 WHERE COALESCE(category,'') NOT IN ('MC','BAT','BSS','SP','CHG','OTH');

/*
 * The same for units already registered.
 *
 * An asset carries its own class rather than reading it off the item each time,
 * so repairing the master alone would leave the stock on the shelf still filed
 * under a word. Only assets whose class is not canonical are touched, and only
 * where the item master now has a real answer to give.
 */
UPDATE erp_assets
   SET category = COALESCE(
         (SELECT i.category FROM erp_items i WHERE i.id = erp_assets.item_id
           AND i.category IN ('MC','BAT','BSS','SP','CHG','OTH')),
         CASE
           WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%MOTOR%' THEN 'MC'
           WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%LOCKER%'
             OR UPPER(TRIM(COALESCE(category,''))) LIKE '%STATION%'
             OR UPPER(TRIM(COALESCE(category,''))) LIKE '%BSS%'
             OR UPPER(TRIM(COALESCE(category,''))) LIKE '%SPACEPORT%' THEN 'BSS'
           WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%BAT%' THEN 'BAT'
           WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%SPARE%'
             OR UPPER(TRIM(COALESCE(category,''))) LIKE '%PART%' THEN 'SP'
           WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%CHARG%' THEN 'CHG'
           ELSE 'OTH' END)
 WHERE COALESCE(category,'') NOT IN ('MC','BAT','BSS','SP','CHG','OTH');

/*
 * And the class typed onto a count line that has not been posted yet.
 *
 * These are staged words, not records - but the sheet is read by somebody
 * deciding whether the count is right, and a sheet that says BATTERY while
 * posting will write BAT cannot be checked against anything.
 */
UPDATE erp_cycle_count_new_units
   SET category = CASE
         WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%MOTOR%' THEN 'MC'
         WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%LOCKER%'
           OR UPPER(TRIM(COALESCE(category,''))) LIKE '%STATION%'
           OR UPPER(TRIM(COALESCE(category,''))) LIKE '%BSS%'
           OR UPPER(TRIM(COALESCE(category,''))) LIKE '%SPACEPORT%' THEN 'BSS'
         WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%BAT%' THEN 'BAT'
         WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%SPARE%'
           OR UPPER(TRIM(COALESCE(category,''))) LIKE '%PART%' THEN 'SP'
         WHEN UPPER(TRIM(COALESCE(category,''))) LIKE '%CHARG%' THEN 'CHG'
         ELSE 'OTH' END
 WHERE COALESCE(category,'') NOT IN ('MC','BAT','BSS','SP','CHG','OTH');
