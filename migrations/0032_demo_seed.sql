-- Demo data seed DISABLED for go-live.
-- This migration previously re-inserted demo partners, assets, sales orders and journals
-- on every deploy (INSERT OR IGNORE), which undid the production data cleanup.
-- Left as a no-op so the deploy workflow still finds the file but seeds nothing.
SELECT 1;
