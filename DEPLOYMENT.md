# E88 FinSys v7.1 Deployment Guide

This package is data-loaded and self-tested locally. Production deployment still requires your authenticated GitHub and Cloudflare accounts.

## 1. Protect the current live system

From a computer with Node.js installed and authenticated Wrangler:

```bash
mkdir -p backups
npx wrangler d1 export e88 --remote --output backups/e88-before-v7.sql
```

Also download the current GitHub repository ZIP and retain the existing Worker deployment/version.

## 2. Upload this repository to GitHub

Use a new branch rather than replacing production immediately:

```bash
git checkout -b rebuild/connected-supply-chain-sales-v7
# Copy this package into the repository folder
git add .
git commit -m "Rebuild connected supply chain and sales ERP with opening data"
git push -u origin rebuild/connected-supply-chain-sales-v7
```

Open a pull request to review the changes. If using only the GitHub browser, see `GITHUB_BROWSER_DEPLOYMENT.md`.

## 3. Install and run local checks

```bash
npm install
python -m pip install openpyxl
npm run build
```

Expected result: unit/structure checks pass and the data self-test reports **29/29**.

## 4. Create a new D1 database for the rebuild

Recommended name: `e88-v7`.

```bash
npx wrangler d1 create e88-v7
```

Copy the returned `database_id` into `wrangler.toml`. Keep `binding = "DB"`. You may set `database_name = "e88-v7"`; the scripts use the binding configuration.

For additional safety, keep the current production D1 untouched during UAT.

## 5. Bootstrap the new database

The command is intentionally guarded and must only be used for a new/empty database:

```bash
npm run db:bootstrap:remote
```

This applies the legacy schema, connected ERP migrations, and all 13 opening-data chunks. It includes the records from every shared workbook.

## 6. Configure document storage

Create an R2 bucket, then enable the `DOCS` binding in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "DOCS"
bucket_name = "e88-finsys-documents"
```

Without R2, operational records work but uploaded ATLAS and supporting documents are not permanently stored by the Worker.

## 7. Protect the URL with Cloudflare Access

Create an Access application for the E88 FinSys Worker/custom domain. Allow only the `nrdev.ph` email domain. The application reads the authenticated user from the Cloudflare Access header.

Do not expose the production Worker without Access protection.

## 8. Deploy

```bash
npm run deploy
```

For a browser-based deployment, use the included **Bootstrap New D1 and Deploy E88 FinSys** GitHub Action after changing `wrangler.toml` to the new D1 ID and adding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The workflow is manual and confirmation-gated.

## 9. Live smoke test

```bash
E88_URL=https://your-deployed-url npm run smoke
```

If Cloudflare Access service tokens are used:

```bash
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
E88_URL=https://your-deployed-url \
npm run smoke
```

## 10. UAT and cutover

Follow `GO_LIVE_CHECKLIST.md`. Keep the previous deployment and database until all opening balances, serials, movements, assignments, and permissions are approved.

## Rollback

- Switch the Worker binding/deployment back to the previous production version.
- Do not delete the previous D1 database.
- If required, restore from `backups/e88-before-v7.sql` into a separate database and validate before rebinding.
