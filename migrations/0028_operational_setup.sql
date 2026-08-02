-- 0028_operational_setup.sql
-- Safe operational corrections found from the live backup:
--  (1) No bank account existed -> vendor payments (P2P) could not complete.
-- Idempotent: safe to run repeatedly.

INSERT OR IGNORE INTO erp_bank_accounts
  (bank_account_code, entity_id, bank_name, account_name, account_number_masked, currency, gl_account_id, opening_balance, active)
SELECT 'BDO-MAIN',
       (SELECT id FROM erp_legal_entities WHERE entity_code='E88'),
       'BDO', 'E88 Operating Account', '****0000', 'PHP',
       (SELECT id FROM erp_chart_accounts WHERE account_code='1010'),
       0, 1
WHERE NOT EXISTS (SELECT 1 FROM erp_bank_accounts WHERE bank_account_code='BDO-MAIN');
