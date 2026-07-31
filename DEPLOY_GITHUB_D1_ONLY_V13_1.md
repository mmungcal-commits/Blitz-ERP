# E88 ERP v13.1: GitHub Deployment With D1 Only (No R2)

This rollout intentionally omits the `DOCS` R2 binding. Core ERP transactions, D1 records, inventory, Finance, approvals, and reports remain available. Supporting-file upload/download will show that document storage is not configured until R2 is enabled in a later release.

## Required GitHub secrets

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Workflow

Use `.github/workflows/deploy-e88-erp.yml`.

For an existing production D1 database, run with:

- confirmation: `E88_ROLLOUT_DEPLOY`
- database_mode: `upgrade_existing`
- run_smoke_test: `true`
- deployment_url: your live Worker URL

The workflow applies migrations 0021 and 0022, displays record counts, deploys the Worker, and verifies that D1 is ready while R2 remains unbound.

## Expected health result

```json
{
  "d1Bound": true,
  "d1Ready": true,
  "r2Bound": false,
  "r2Ready": false
}
```

## Features unavailable without R2

- Lease-contract and workspace supporting-file uploads
- Stored document downloads
- Persistent copy of an uploaded ATLAS source file

ATLAS preview and posting still process the workbook and retain its file name and SHA-256 hash in D1, but the binary file itself is not stored.
