-- 0043_finance_review.sql
-- Blitz - ERP · the Finance check that sits before the head of Finance approves.
--
-- ADDITIVE ONLY. Safe on the live database with database_mode=upgrade_existing.
--
-- E88's actual process has a step the SWIFT specification does not:
--
--   Requestor -> Department Head -> Finance check -> Head of Finance -> CEO
--
-- Rucel checks the requestor's paperwork and the department head's approval,
-- and only when she confirms it does the request reach Mark as head of Finance.
-- She is NOT an approver: she raises requests and she checks them, but she holds
-- no approval rights, and the role below reflects that (can_approve = 0).
--
-- The check is still signed and recorded, so the printed form shows who checked
-- it, and separation of duties applies to it like any other stage: she cannot
-- check a request she raised herself, and having checked one she cannot then
-- sign another stage on it.

----------------------------------------------------------------------
-- 1. The role
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_roles(code,name,active) VALUES
  ('FINANCE_REVIEWER','Finance Reviewer',1);

INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  -- Sees every request in order to check it, raises her own, records the check.
  -- can_approve stays 0 on purpose: the check is not an approval.
  ('FINANCE_REVIEWER','FINANCE',    1,1,1,0,0,1,0),
  ('FINANCE_REVIEWER','PROCUREMENT',1,1,1,0,0,1,0),
  ('FINANCE_REVIEWER','REPORTS',    1,0,0,0,0,1,0),
  ('FINANCE_REVIEWER','DASHBOARD',  1,0,0,0,0,0,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=MAX(can_view,excluded.can_view),
  can_create=MAX(can_create,excluded.can_create),
  can_edit=MAX(can_edit,excluded.can_edit),
  can_export=MAX(can_export,excluded.can_export);

----------------------------------------------------------------------
-- 2. Rucel checks; she does not approve.
--
-- She was FINANCE, which carries can_approve=1, so until now the system would
-- have let her sign the Finance approval that belongs to the head of Finance.
----------------------------------------------------------------------
/*
 * She has to exist for the UPDATE below to mean anything.
 *
 * This migration set out to make Rucel the checker and then only ever ran an
 * UPDATE, which quietly matched nothing if her account had not been created.
 * The result was a chain with a Finance Check stage and nobody able to perform
 * it: every request stopped at step 3 and the head of Finance could not reach
 * her own approval, because a stage nobody can sign is a stage nothing passes.
 */
INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,active)
VALUES('rhonrado@nrdev.ph','Rucel Mae Honrado','FINANCE_REVIEWER','Finance and Accounting',1);

UPDATE erp_users SET role_code='FINANCE_REVIEWER'
 WHERE email='rhonrado@nrdev.ph';

----------------------------------------------------------------------
-- 3. The switch.
--
-- On. To collapse the chain back to Department -> Finance -> CEO:
--   UPDATE erp_rfp_settings SET value='0' WHERE key='rfp_finance_review';
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('rfp_finance_review','1');
UPDATE erp_rfp_settings SET value='1' WHERE key='rfp_finance_review';
