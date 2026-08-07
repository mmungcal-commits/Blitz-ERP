-- 0057 · The battery swapping network is its own business
--
-- RideBox builds and runs the swapping stations. Its spend has been sitting in
-- the same pile as everything else, which makes two questions unanswerable:
-- what the station network costs, and what the rest of the company costs.
--
-- So spend now carries a business line. The rule is held as data rather than
-- written into a query, because where a cost belongs is a judgement Finance
-- makes and changes, not a deployment.
--
-- Four things go into the swapping line:
--   the stations themselves, wherever they were bought from (the account title
--   "Station shell/equipment" turns up under Supply Chain and HR as well as
--   under RideBox);
--   everything the RideBox department raises, which is site rent, station
--   electricity and field operations;
--   the two cost centres that exist only to build and watch the network;
--   and the site leases themselves, which are the giveaway: small recurring
--   payments to the shops the stations stand in - Alfamart, Powerfill,
--   Energizer and the like - for rent and for the electricity the station
--   draws. Those are booked under whichever department raised them, so they
--   are found by who is being paid for what rather than by department.
--
-- Everything else is Core.
--
-- Re-runnable: the rules are replaced rather than merely inserted, the views
-- are dropped and rebuilt so an edit here reaches a live database, and the name
-- tidying is an idempotent UPDATE.

/*
 * First the names. The same department is spelled four ways in the register,
 * so RideBox reads as two departments and its total is wrong before any rule
 * is applied. This is the kind of thing that has to be fixed at the data, not
 * papered over with UPPER() in every query.
 */
UPDATE erp_payment_requests SET department='RideBox'
 WHERE department<>'RideBox' AND UPPER(TRIM(department))='RIDEBOX';
UPDATE erp_payment_requests SET department='AfterSales'
 WHERE department<>'AfterSales' AND UPPER(TRIM(department))='AFTERSALES';
UPDATE erp_payment_requests SET department='Sales and Marketing'
 WHERE department<>'Sales and Marketing'
   AND UPPER(REPLACE(TRIM(department),'&','AND'))='SALES AND MARKETING';
UPDATE erp_payment_requests SET cost_center='Network Rollout'
 WHERE cost_center<>'Network Rollout' AND UPPER(TRIM(COALESCE(cost_center,'')))='NETWORK ROLLOUT';

CREATE TABLE IF NOT EXISTS erp_business_lines (
  line_code   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO erp_business_lines(line_code,name,description,sort_order) VALUES
  ('BSS','Battery Swapping Stations',
   'RideBox: building, leasing and running the swapping network. Station shells and equipment, site rent, station power and field operations.',10),
  ('CORE','Core Operations',
   'Everything that is not the swapping network: fleet, sales, support functions.',20);

/*
 * How a cost finds its line. First match by priority wins, so the account title
 * beats the department: a station bought on a Supply Chain request is still a
 * station.
 */
CREATE TABLE IF NOT EXISTS erp_business_line_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  line_code  TEXT NOT NULL REFERENCES erp_business_lines(line_code),
  match_type TEXT NOT NULL,          -- ACCOUNT_TITLE | DEPARTMENT | COST_CENTER
  match_value TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 100,
  note       TEXT,
  UNIQUE(match_type, match_value)
);
/*
 * REPLACE, not IGNORE. A rule is a judgement that gets corrected, and a seed
 * that only ever creates would mean editing this file changed nothing on a
 * database that already had the old rule. Nothing references a rule by id.
 */
INSERT OR REPLACE INTO erp_business_line_rules(line_code,match_type,match_value,priority,note) VALUES
  ('BSS','ACCOUNT_TITLE','Station shell/equipment',10,
   'The stations themselves, whichever department bought them.'),
  ('BSS','DEPARTMENT','RideBox',20,
   'Site rent, station power, field operations.'),
  ('BSS','COST_CENTER','Network Rollout',30,
   'Building out the network.'),
  ('BSS','COST_CENTER','Monitoring & Field Ops',40,
   'Watching and maintaining the stations.'),
  /*
   * The host shops. A station stands inside somebody else's premises, and what
   * the company pays them is rent and the power the station draws. These are
   * small and recurring, they are raised by whichever department happens to
   * handle them, and they are the true running cost of the network.
   *
   * Matched on the host's name together with a lease or utility title and an
   * amount under the ceiling, so that a large one-off contract with the same
   * chain is not swept in with the site rents.
   */
  ('BSS','SITE_HOST','ALFAMART',15,'Host convenience stores.'),
  ('BSS','SITE_HOST','POWERFILL',15,'Host fuel stations.'),
  ('BSS','SITE_HOST','ENERGIZER',15,'Host sites.');

-- What counts as a small site cost. Finance moves this without a deployment.
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES
  ('bss_site_cost_ceiling','6000');

/*
 * The line a request belongs to, derived rather than stored, so correcting a
 * rule corrects the history with it. Unmatched spend falls to CORE, which is
 * the honest default: it says "not the station network" rather than pretending
 * to know more.
 */
-- Dropped and recreated rather than left alone, so that correcting the rule
-- above actually corrects the view that applies it.
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
             OR (b.match_type='SITE_HOST' AND EXISTS (
                   SELECT 1 FROM erp_payment_request_lines l
                    WHERE l.rfp_ref=r.request_no
                      AND UPPER(COALESCE(l.description,'')||' '||COALESCE(l.project_site,'')||' '
                            ||COALESCE(l.requesting_party,'')||' '||COALESCE(r.payee_name,''))
                          LIKE '%'||UPPER(TRIM(b.match_value))||'%'
                      AND (UPPER(COALESCE(l.account_title,'')) LIKE '%RENT%'
                        OR UPPER(COALESCE(l.account_title,'')) LIKE '%LEASE%'
                        OR UPPER(COALESCE(l.account_title,'')) LIKE '%UTILIT%')
                      AND l.gross_amount <= CAST(COALESCE(
                            (SELECT value FROM erp_rfp_settings WHERE key='bss_site_cost_ceiling'),
                            '6000') AS REAL)))
          ORDER BY b.priority LIMIT 1
       ),'CORE') AS line_code
  FROM erp_payment_requests r;

/*
 * Inside the swapping line, two very different costs: putting a station in
 * (shells, equipment, the rollout) and keeping it there (site rent, power).
 * The first is what the network cost to build, the second is what it costs to
 * run, and reading them as one number answers neither question.
 */
DROP VIEW IF EXISTS v_bss_cost_kind;
CREATE VIEW v_bss_cost_kind AS
SELECT l.rfp_ref AS request_no,
       l.line_no,
       l.gross_amount,
       CASE WHEN UPPER(COALESCE(l.account_title,'')) LIKE '%RENT%'
                 OR UPPER(COALESCE(l.account_title,'')) LIKE '%LEASE%'
                 OR UPPER(COALESCE(l.account_title,'')) LIKE '%UTILIT%'
            THEN 'SITES' ELSE 'BUILD' END AS cost_kind
  FROM erp_payment_request_lines l
  JOIN v_payment_request_line v ON v.request_no=l.rfp_ref
 WHERE v.line_code='BSS';
