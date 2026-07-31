# E88 Enterprise System v13.0 Deployment Guide

## 1. Protect the current production state

Retain the current Worker version and export the live D1 database before migration:

```bash
mkdir -p backups
npx wrangler d1 export DB --remote --output backups/e88-before-v13.sql
```

Confirm that the backup is non-empty and store it outside the deployment workspace.

## 2. Prepare Cloudflare resources

Confirm the D1 binding in `wrangler.toml`. Create the document bucket if it does not exist:

```bash
npx wrangler r2 bucket create e88-erp-documents
```

The Worker expects:

- D1 binding: `DB`
- R2 binding: `DOCS`
- assets binding: `ASSETS`
- Access/domain controls for authorized E88 users

## 3. Validate the source package

```bash
npm install
python -m pip install openpyxl
npm run build
```

Expected v13 result: 357 structural checks, 24 unit/lifecycle tests, and 70 data/reconciliation tests.

## 4. Upgrade an existing v12 database

Apply migration `0021` exactly once:

```bash
npx wrangler d1 execute DB --remote --file=migrations/0021_rollout_specialist_engines.sql
```

Do not rerun opening-data bootstrap on an existing production database.

## 5. Upgrade from a version earlier than v12

Apply every missing migration in numeric order. Do not skip `0020` or `0021`. Back up and test the migration against a copied D1 database before modifying production.

## 6. Bootstrap a new database

For a new empty D1 database, update `wrangler.toml`, then run:

```bash
npm run db:bootstrap:remote -- --confirm=E88_NEW_DATABASE
```

This applies schemas, opening-data chunks, and migrations through `0021`.

## 7. Configure security and master data

Before deployment approval:

- restrict Cloudflare Access to authorized company accounts;
- activate named application users and role assignments;
- review approval matrices and monetary limits;
- confirm legal entities, departments, locations, warehouses, banks, tax codes, chart of accounts, numbering sequences, and accounting periods;
- put tokens and credentials only in Cloudflare or repository secrets;
- never commit `.dev.vars`, passwords, API keys, or production exports.

## 8. Deploy

```bash
E88_DEPLOY_CONFIRM=CONNECTED_SCHEMA_INSTALLED npm run deploy
```

## 9. Smoke test

```bash
E88_URL=https://your-worker-url npm run smoke
```

Then complete `UAT_SCENARIOS_V13.md` and `GO_LIVE_CHECKLIST.md`.

## Rollback

1. Stop new transaction entry.
2. Restore the previous Worker deployment.
3. Rebind the prior D1 database when a separate migration copy was used.
4. Never attempt to undo `0021` by deleting its tables from a live transactional database.
5. Restore the pre-v13 export into a separate D1 database, validate it, then rebind if database rollback is required.
6. Reconcile transaction counts and posted journals before reopening access.
