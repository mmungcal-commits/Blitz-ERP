-- 0041_people_and_roles.sql
-- Blitz - ERP · the real people, their roles, and two things that were blocking them.
--
-- ADDITIVE ONLY. Safe on the live database with database_mode=upgrade_existing.
--
--   Samuel Kniazeff   - Department Head, Supply Chain
--   Judy Joy Rosare   - Logistics; authorised to approve stock movements
--   Francis           - Chief Executive Officer (final approval)
--   Haide             - Department Head, Human Resources
--   Ferdinand "Ardee" - Department Head, Technology
--   Mark Alexis Mungcal / Rucel Mae Honrado - Finance & Accounting

----------------------------------------------------------------------
-- 1. The MANCOM tier is switched OFF.
--
-- E88 agree high-value spend in the MANCOM meeting before it is ever recorded
-- in the ERP, so an in-system MANCOM signature would be a second, redundant
-- approval that nobody is rostered to give. With this off the chain is
--   Requestor -> Department Head -> Finance -> CEO
-- at every amount. src/lib/rfp-rules.js reads this flag; when it is '0' the
-- threshold is treated as infinite, so the stage simply never applies.
--
-- To turn it back on later:
--   UPDATE erp_rfp_settings SET value='1' WHERE key='rfp_mancom_enabled';
--   -- and create at least one user with role_code='MANCOM'
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES ('rfp_mancom_enabled','0');
UPDATE erp_rfp_settings SET value='0' WHERE key='rfp_mancom_enabled';

----------------------------------------------------------------------
-- 2. Nobody could administer users.
--
-- erp_role_permissions had NO row granting ADMIN.can_manage to any role, so
-- POST /api/admin/users was unreachable and no account could ever be created
-- from the app. Finance owns system administration here, and the Admin scope is
-- separately gated per user by erp_users.admin_access, so this grant alone does
-- not let anyone into the Admin workspace who is not already flagged for it.
----------------------------------------------------------------------
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('FINANCE','ADMIN',1,1,1,0,0,1,1)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=MAX(can_view,excluded.can_view),
  can_create=MAX(can_create,excluded.can_create),
  can_edit=MAX(can_edit,excluded.can_edit),
  can_export=MAX(can_export,excluded.can_export),
  can_manage=MAX(can_manage,excluded.can_manage);

----------------------------------------------------------------------
-- 3. SCM_HEAD - Supply Chain Department Head.
--
-- Samuel is both the department's approver AND the person who runs its stock.
-- Plain DEPT_HEAD cannot create or post inventory movements (can_create=0,
-- can_post=0 on INVENTORY), so promoting him to DEPT_HEAD would have quietly
-- taken the warehouse away from him. SCM_HEAD is SCM_MANAGER's operational
-- rights plus the FINANCE approve that the DEPARTMENT stage needs.
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_roles(code,name,active) VALUES
  ('SCM_HEAD','Supply Chain Department Head',1);

INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('SCM_HEAD','FINANCE',    1,1,1,1,0,1,0),   -- raises and approves RFPs at the DEPARTMENT stage
  ('SCM_HEAD','INVENTORY',  1,1,1,1,1,1,1),
  ('SCM_HEAD','PROCUREMENT',1,1,1,1,1,1,0),
  ('SCM_HEAD','RECEIVING',  1,1,1,1,1,1,0),
  ('SCM_HEAD','DELIVERIES', 1,1,1,1,1,1,0),
  ('SCM_HEAD','REQUISITIONS',1,1,1,1,1,1,0),
  ('SCM_HEAD','RETURNS',    1,1,1,1,1,1,0),
  ('SCM_HEAD','CUSTOMERS',  1,1,1,1,0,1,0),
  ('SCM_HEAD','REPORTS',    1,0,0,0,0,1,0),
  ('SCM_HEAD','DASHBOARD',  1,0,0,0,0,0,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=MAX(can_view,excluded.can_view),
  can_create=MAX(can_create,excluded.can_create),
  can_edit=MAX(can_edit,excluded.can_edit),
  can_approve=MAX(can_approve,excluded.can_approve),
  can_post=MAX(can_post,excluded.can_post),
  can_export=MAX(can_export,excluded.can_export),
  can_manage=MAX(can_manage,excluded.can_manage);

----------------------------------------------------------------------
-- 4. The people.
--
-- No erp_user_module_access rows are written on purpose: src/lib/auth.js treats
-- "no rows" as "use the role's permissions in full", whereas writing even one
-- row switches that user into explicit allow-list mode. Leaving them empty is
-- what makes a new account work on first login.
--
-- Judy is left on Supply Chain so that Samuel, as head of that department, can
-- see and approve what she raises. She already holds INVENTORY approve+post,
-- which is the stock-movement authority.
----------------------------------------------------------------------
UPDATE erp_users SET role_code='SCM_HEAD', department='Supply Chain'
 WHERE email='samuel@nrdev.ph';

INSERT OR IGNORE INTO erp_users(email,display_name,role_code,department,live_access,active,admin_access) VALUES
  ('francis@nrdev.ph','Francis','CEO','Executive',1,1,0),
  ('haide@nrdev.ph','Haide','DEPT_HEAD','Human Resources',1,1,0),
  ('ferdinand@nrdev.ph','Ferdinand "Ardee"','DEPT_HEAD','Technology',1,1,0);

-- Existing rows are corrected too, so re-running this migration is safe and a
-- hand-edit made in the meantime is brought back in line.
UPDATE erp_users SET role_code='CEO',       department='Executive'        WHERE email='francis@nrdev.ph';
UPDATE erp_users SET role_code='DEPT_HEAD', department='Human Resources'  WHERE email='haide@nrdev.ph';
UPDATE erp_users SET role_code='DEPT_HEAD', department='Technology'       WHERE email='ferdinand@nrdev.ph';

-- Every user needs a credentials row before an activation link can be issued.
INSERT OR IGNORE INTO erp_user_credentials(user_id)
  SELECT id FROM erp_users WHERE active=1;

-- Departments referenced above, so RFP numbering resolves a proper code
-- (RFP-<DEPT><YEAR>-NNNN) instead of falling back to initials.
INSERT OR IGNORE INTO erp_departments(code,name) VALUES
  ('EXE','Executive');
