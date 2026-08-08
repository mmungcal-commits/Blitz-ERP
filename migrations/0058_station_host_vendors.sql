-- 0058 · Who the station hosts are is a decision, not a guess
--
-- 0057 found the site costs by looking for a host's name in the line
-- description. That was a guess, and it read wrong: Packetworx, Meralco,
-- Spacepro and a member of staff turned up in a chart headed "station site
-- costs by host", because they happen to sit in the swapping line for other
-- reasons and happen to have a rent or utility line.
--
-- A vendor either hosts a station or does not. Nobody can infer that from a
-- spreadsheet description, and Finance knows the answer. So the host list is
-- an explicit set of vendors, seeded with the two that certainly are hosts,
-- and edited from Payables -> Controls rather than in a deployment.
--
-- The same names arrive spelled several ways - "Packetworx, Inc" and
-- "Packetworx, Inc.", "ALFAMART ... INC." and "ALFAMART ... INC" - so matching
-- and grouping both ignore full stops, commas and doubled spaces. Without that
-- one vendor appears twice in its own chart.
--
-- Re-runnable: the delete is keyed on the rule type it replaces, the seeds are
-- INSERT OR REPLACE, and the views are rebuilt.

-- The description guess goes. It is superseded by the vendor list below.
DELETE FROM erp_business_line_rules WHERE match_type='SITE_HOST';

/*
 * The vendors whose premises the stations stand in. Two to start with, because
 * these two are certain; the rest is for Finance to tick rather than for this
 * file to assume.
 */
INSERT OR REPLACE INTO erp_business_line_rules(line_code,match_type,match_value,priority,note) VALUES
  ('BSS','PAYEE','ALFAMART TRADING PHILIPPINES INC',15,'Host convenience stores.'),
  ('BSS','PAYEE','POWER FILL PETROLEUM PHILIPPINES INC',15,'Host fuel stations.');

/*
 * One spelling of a name.
 *
 * Kept as a table of one expression so the same normalisation is used by the
 * rule, the grouping and the screen. A vendor that reads two ways splits its
 * own total in half and neither figure is right.
 */
DROP VIEW IF EXISTS v_payee_normalised;
CREATE VIEW v_payee_normalised AS
SELECT r.id AS payment_request_id,
       r.request_no,
       r.payee_name,
       TRIM(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(r.payee_name,''))),'.',''),',',''),'  ',' ')) AS payee_key
  FROM erp_payment_requests r;

DROP VIEW IF EXISTS v_payment_request_line;
CREATE VIEW v_payment_request_line AS
SELECT r.request_no,
       r.id AS payment_request_id,
       COALESCE((
         SELECT b.line_code FROM erp_business_line_rules b
          WHERE (b.match_type='DEPARTMENT'
                 AND UPPER(TRIM(COALESCE(r.department,'')))=UPPER(TRIM(b.match_value)))
             OR (b.match_type='COST_CENTER'
                 AND UPPER(TRIM(COALESCE(r.cost_center,'')))=UPPER(TRIM(b.match_value)))
             OR (b.match_type='ACCOUNT_TITLE' AND EXISTS (
                   SELECT 1 FROM erp_payment_request_lines l
                    WHERE l.rfp_ref=r.request_no
                      AND UPPER(TRIM(COALESCE(l.account_title,'')))=UPPER(TRIM(b.match_value))))
             -- A named host vendor puts the whole request in the line, however
             -- the department filed it.
             OR (b.match_type='PAYEE' AND EXISTS (
                   SELECT 1 FROM v_payee_normalised p
                    WHERE p.request_no=r.request_no
                      AND p.payee_key = TRIM(REPLACE(REPLACE(REPLACE(
                            UPPER(TRIM(b.match_value)),'.',''),',',''),'  ',' '))))
          ORDER BY b.priority LIMIT 1
       ),'CORE') AS line_code
  FROM erp_payment_requests r;

/*
 * Building a station against keeping it standing.
 *
 * A running cost is now a rent or utility line billed by a vendor on the host
 * list, and nothing else. Rent paid to a landlord who does not host a station
 * is a cost of the network only in the loosest sense, and putting it in a chart
 * headed "by host" was simply wrong.
 */
DROP VIEW IF EXISTS v_bss_cost_kind;
CREATE VIEW v_bss_cost_kind AS
SELECT l.rfp_ref AS request_no,
       l.line_no,
       l.gross_amount,
       p.payee_key,
       CASE WHEN (UPPER(COALESCE(l.account_title,'')) LIKE '%RENT%'
                  OR UPPER(COALESCE(l.account_title,'')) LIKE '%LEASE%'
                  OR UPPER(COALESCE(l.account_title,'')) LIKE '%UTILIT%')
                 AND EXISTS (SELECT 1 FROM erp_business_line_rules b
                              WHERE b.line_code='BSS' AND b.match_type='PAYEE'
                                AND p.payee_key = TRIM(REPLACE(REPLACE(REPLACE(
                                      UPPER(TRIM(b.match_value)),'.',''),',',''),'  ',' ')))
            THEN 'SITES' ELSE 'BUILD' END AS cost_kind
  FROM erp_payment_request_lines l
  JOIN v_payment_request_line v ON v.request_no=l.rfp_ref
  JOIN v_payee_normalised p ON p.request_no=l.rfp_ref
 WHERE v.line_code='BSS';
