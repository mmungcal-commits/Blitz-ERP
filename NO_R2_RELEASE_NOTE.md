# E88 ERP v13.1 No-R2 Release Note

This package is the v13.1 exact-inventory rollout configured for Cloudflare Workers and D1 only.

## Verified

- Structural checks: 374 passed, 0 failed
- Unit and finance lifecycle tests: 24 passed, 0 failed
- Workbook, migrated-data, accounting, and reconciliation tests: 73 passed, 0 failed
- D1 binding retained as `DB`
- R2 `DOCS` binding removed from `wrangler.toml`
- GitHub workflow verifies `r2Bound:false`

## Local validation limitation

The integration test requiring the npm `esbuild` package could not be rerun in the artifact container because its internal npm mirror did not contain one transitive Wrangler package. The GitHub workflow runs `npm ci` against its configured registry and then runs the integration test before deployment. No application source used by the integration test was changed for the no-R2 variant.

## Temporarily unavailable

Supporting-document upload and download require R2 and will return “Document storage is not configured.” Core ERP, D1 transactions, Finance, inventory, approvals, and reports do not require R2.
