-- 0040_rfp_spec_conformance.sql
-- Blitz - ERP · brings the Payables RFP workflow in line with
-- "E88 RFP & Payments - System Workflow Specification" (the live SWIFT behaviour).
--
-- ADDITIVE ONLY. Safe on the live database with database_mode=upgrade_existing.
--
-- What this migration adds:
--   1. the MANCOM role and its permissions (the conditional approval tier)
--   2. the RFP rule switches the server reads at every approval
--   3. the MANCOM threshold in erp_rfp_settings if it is not already there
--
-- The chain itself is enforced in code (src/lib/rfp-rules.js), which both
-- src/routes/finance.js and src/routes/rfp-alignment.js now share, so the screen
-- and the SWIFT-compatible endpoints cannot drift apart.

----------------------------------------------------------------------
-- 1. MANCOM role
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_roles(code,name,active) VALUES
  ('MANCOM','Management Committee',1);

INSERT INTO erp_role_permissions(role_code,module,can_view,can_create,can_edit,can_approve,can_post,can_export,can_manage) VALUES
  ('MANCOM','FINANCE',    1,0,1,1,0,1,0),
  ('MANCOM','PROCUREMENT',1,0,0,1,0,1,0),
  ('MANCOM','REPORTS',    1,0,0,0,0,1,0),
  -- A requestor who may raise an RFP must also be able to submit it and to
  -- correct it after a return. Without can_edit the whole action endpoint is
  -- closed to them and their own draft can never leave DRAFT. They still cannot
  -- approve (can_approve stays 0) and they still only ever see their own rows.
  ('SCM_MANAGER','FINANCE',1,1,1,0,0,1,0),
  ('WAREHOUSE','FINANCE',  1,1,1,0,0,1,0),
  ('COMMERCIAL','FINANCE', 1,1,1,0,0,1,0),
  ('STAFF','FINANCE',      1,1,1,0,0,0,0)
ON CONFLICT(role_code,module) DO UPDATE SET
  can_view=MAX(can_view,excluded.can_view),
  can_create=MAX(can_create,excluded.can_create),
  can_edit=MAX(can_edit,excluded.can_edit),
  can_approve=MAX(can_approve,excluded.can_approve),
  can_post=MAX(can_post,excluded.can_post),
  can_export=MAX(can_export,excluded.can_export),
  can_manage=MAX(can_manage,excluded.can_manage);

----------------------------------------------------------------------
-- 2. RFP rule switches
--
-- mancom_min               spec section 4. PHP 100,000 unless you change it here.
-- rfp_require_signature    spec section 5. An approval without a drawn or typed
--                          signature is refused. ON.
-- rfp_separation_of_duties spec section 5. The submitter cannot approve their own
--                          request, one person cannot sign two stages, and a stage
--                          cannot be signed twice. ON.
-- rfp_role_gate            spec section 5. The signer's role must match the stage
--                          role (Admin exempt). Shipped OFF, deliberately: today
--                          the only live account is FINANCE, so switching this on
--                          before the DEPT_HEAD / MANCOM / CEO accounts exist
--                          would leave nobody able to approve anything.
--
--                          Turn it on with:
--                            UPDATE erp_rfp_settings SET value='1' WHERE key='rfp_role_gate';
----------------------------------------------------------------------
INSERT OR IGNORE INTO erp_rfp_settings(key,value) VALUES
  ('mancom_min','100000'),
  ('rfp_require_signature','1'),
  ('rfp_separation_of_duties','1'),
  ('rfp_role_gate','0');
