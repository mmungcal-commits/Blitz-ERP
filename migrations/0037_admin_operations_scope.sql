-- Separates "System Administration" (setup, backups, user/role config) from
-- "Operations" (the actual approval chains: PO, receiving, cycle count, returns).
-- Previously role_code='ADMIN' was a blanket bypass on every module and every
-- approval step (see src/lib/auth.js, src/lib/specialist-engine.js pre-0037).
-- That is being removed. From this migration forward:
--   - admin_access=1 marks an account that MAY start an Admin-scope session.
--   - erp_sessions.session_scope is chosen at login ('ADMIN' or 'OPERATIONS')
--     and is fixed for the life of that session/token.
--   - An 'ADMIN' scoped session only ever gets permission on module='ADMIN'.
--   - An 'OPERATIONS' scoped session is governed purely by role_code, same
--     as every other user — no special-casing, no approval bypass.

ALTER TABLE erp_users ADD COLUMN admin_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE erp_sessions ADD COLUMN session_scope TEXT NOT NULL DEFAULT 'OPERATIONS';

-- Known admin account: keep the admin_access flag, but the account's
-- day-to-day operational role is FINANCE, not a permanent ADMIN bypass.
UPDATE erp_users
   SET admin_access = 1,
       role_code = 'FINANCE'
 WHERE email = 'mmungcal@nrdev.ph';

-- FINANCE was missing coverage for the modules where finance is the last
-- approval step or has override authority (PO chain final approver,
-- receiving reconciliation, cycle-count discrepancy override, requisition
-- override on draft stock movements/returns).
INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage)
VALUES
  ('FINANCE','PROCUREMENT',1,0,1,1,1,1,0),
  ('FINANCE','RECEIVING',1,0,1,1,1,1,0),
  ('FINANCE','REQUISITIONS',1,0,1,1,1,1,0),
  ('FINANCE','RETURNS',1,0,1,1,1,1,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=1, can_edit=1, can_approve=1, can_post=1, can_export=1;
