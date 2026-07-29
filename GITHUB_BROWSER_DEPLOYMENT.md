# GitHub Browser Deployment — No Technical Team

I cannot control your signed-in GitHub or Cloudflare browser session. These steps minimize manual mistakes.

## Safest method

1. Download the complete E88 FinSys v7.1 ZIP supplied with this package.
2. In GitHub, open `mmungcal-commits/e88-erp`.
3. Create a branch named `rebuild-connected-erp-v7`.
4. Upload the extracted files into that branch. Preserve the same folders.
5. Confirm these critical folders exist in GitHub:
   - `src/`
   - `public/`
   - `migrations/`
   - `migrations/opening/`
   - `source_data/`
   - `scripts/`
   - `reports/`
6. Open a pull request from `rebuild-connected-erp-v7` to the current production branch.
7. Do not merge until the GitHub Actions check is green.

## Cloudflare database warning

A GitHub push can deploy Worker code, but it does not safely create and populate the new D1 database unless a database bootstrap is deliberately executed. The 44 MB opening SQL is split into guarded chunks for this reason.

Use Cloudflare's browser terminal or Wrangler on your computer to:

1. Export the existing D1 database.
2. Create a new D1 database.
3. Put its database ID in `wrangler.toml`.
4. Run `npm run db:bootstrap:remote`.
5. Deploy the Worker.

Do not point the rebuilt application at the old live D1 and run the opening-data bootstrap there.

## What to verify before merge

- GitHub Actions: Structure and self-test are green.
- `reports/SELF_TEST_REPORT.md` says 29/29 passed.
- `migrations/opening/manifest.json` lists 13 chunks.
- `source_data/` contains 14 Excel workbooks.
- `wrangler.toml` points to the intended new D1 database.

## One-click GitHub Action after the new D1 ID is committed

After changing `wrangler.toml` to the **new** D1 database ID and adding the Cloudflare repository secrets:

1. Open **Actions**.
2. Select **Bootstrap New D1 and Deploy E88 FinSys**.
3. Choose **Run workflow**.
4. Type `E88_NEW_DATABASE`.
5. Run the workflow.

The workflow runs the full tests, applies every schema and opening-data chunk, and then deploys the Worker. It refuses to bootstrap the known previous live D1 database ID.
