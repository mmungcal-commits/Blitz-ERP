# Deploy E88 ERP v13.1 through GitHub Actions with D1 and R2

This release is prepared for the process you normally use: upload the complete source to GitHub, then run the deployment workflow manually.

## What was corrected in this release

- The GitHub workflow no longer removes the R2 binding.
- The workflow uses the exact bucket configured in `wrangler.toml`: `e88-erp-documents`.
- The workflow now asks whether the configured D1 database is an existing database or a new empty database.
- Existing records are preserved when `upgrade_existing` is selected.
- Opening records are loaded only when `bootstrap_empty_database` is selected.
- The live check confirms the Worker build, D1 binding, D1 query access, R2 binding, and R2 bucket access.
- Inventory is separated by exact material code and serial into motorcycles, batteries, lockers/BSS, chargers, spare parts, and other inventory.

## A. Before uploading to GitHub

1. Download and extract the v13.1 ZIP.
2. Open `wrangler.toml` and confirm these entries:

```toml
[[d1_databases]]
binding = "DB"
database_name = "e88-v7"
database_id = "37da8de0-9574-43d0-8bde-69719342cbbd"

[[r2_buckets]]
binding = "DOCS"
bucket_name = "e88-erp-documents"
```

3. Do not change the binding names `DB` and `DOCS`. The application code uses those exact names.
4. Confirm that `.github/workflows/deploy-e88-erp.yml` is included. The `.github` folder is hidden on some computers, so make sure it is uploaded.
5. Keep a D1 recovery point before the rollout. Cloudflare D1 Time Travel can restore the database to a point in time, but a Worker rollback does not reverse D1 or R2 data changes.

## B. Upload the build to GitHub

### When replacing the repository through the GitHub website

1. Open the repository.
2. Choose **Add file** then **Upload files**.
3. Upload the contents of the extracted folder, not the ZIP itself.
4. Make sure these paths appear in the repository:

```text
.github/workflows/deploy-e88-erp.yml
migrations/0021_rollout_specialist_engines.sql
migrations/0022_inventory_class_r2_rollout.sql
public/foundation.js
public/foundation.css
src/index.js
wrangler.toml
package.json
```

5. Commit the files to the branch you normally deploy, usually `main`.

Do not retain the old workflow named `force-clean-e88-erp (3).yml`. It created the wrong R2 bucket and removed the R2 binding before deployment. The v13.1 package contains only the corrected workflow.

## C. Confirm GitHub repository secrets

Open:

**Repository → Settings → Secrets and variables → Actions**

Create or confirm these repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

The API token must be restricted to the correct Cloudflare account and must permit:

- Workers Scripts edit/write
- D1 Edit
- Workers R2 Storage Write
- Account Settings Read, when required by Wrangler account discovery

Do not put the token in `wrangler.toml`, source files, or screenshots.

## D. Choose the correct database mode

This choice determines whether records appear after deployment.

### Use `upgrade_existing` when

- The current ERP already has users, inventory, sales, requisitions, or other records.
- The configured D1 database is the same database currently used by the live Worker.
- You want to preserve the existing data.

This mode applies migrations `0021` and `0022` only. It does not reload opening data and does not delete existing records.

### Use `bootstrap_empty_database` only when

- You created a new D1 database.
- The database has no ERP tables or records.
- You intentionally want to load the approved Excel-derived opening data.

This mode creates the complete schema and loads the opening records, including the 8,650 serialized assets and their movement history. The bootstrap is designed to stop if the selected database already contains serialized assets.

For the system shown in your screenshots, select **upgrade_existing** unless you intentionally created a new empty D1 database.

## E. Run the GitHub workflow

1. Confirm the corrected workflow has been committed to the repository's **default branch**. Until that commit is present, GitHub may continue showing the old Run workflow screen with only a branch selector.
2. Open the repository's **Actions** tab.
3. Select **Deploy E88 ERP with D1 and R2**. Do not select the old force-clean workflow.
4. Click **Run workflow**. The confirmation, database mode, R2, smoke-test, and deployment-URL fields should now appear.
5. Complete the fields as follows:

| Field | Value for the current live system |
|---|---|
| Branch | `main`, or your normal deployment branch |
| confirmation | `E88_ROLLOUT_DEPLOY` |
| database_mode | `upgrade_existing` |
| ensure_r2_bucket | `true` |
| run_smoke_test | `true` |
| deployment_url | `https://e88-finsys.nrd-e88.workers.dev` |

6. Click **Run workflow**.

The workflow performs these steps in order:

1. Installs the exact package-lock dependencies.
2. Runs structural, unit, data, and integration checks.
3. Authenticates with Cloudflare.
4. Creates or verifies `e88-erp-documents`.
5. Applies the appropriate D1 changes.
6. Displays record counts before deployment.
7. Deploys the Worker with both D1 and R2 bindings.
8. Confirms the live build and checks actual D1 and R2 access.

## F. What success looks like

The workflow must finish with a green check. In **Verify live Worker, D1, and R2**, the health response must include:

```json
{
  "build": "E88-ROLLOUT-ERP-20260731-R13.1",
  "d1Bound": true,
  "d1Ready": true,
  "r2Bound": true,
  "r2Ready": true
}
```

The GitHub step summary must show:

```text
D1 binding: DB
R2 binding: DOCS
R2 bucket: e88-erp-documents
```

## G. Verify records inside the ERP

After deployment:

1. Sign in.
2. Open **Inventory & Procurement**.
3. Click the gray **Inventory & Procurement** header to expand its blue submodules.
4. Open **Warehouse Management**.
5. The overview must show individual rows by:
   - Inventory class
   - Material code
   - Tagged item description
   - Total serials
   - Available
   - Deployed
   - Quarantine
   - Missing cost
   - Inventory value
6. Click a material-code row to open the exact serial register.
7. Click a serial row to see its movement, custody, delivery, return, and reconciliation details.
8. Scroll down. The table header must remain frozen.
9. Drag the right edge of a column header to resize it. Widths are saved in the browser.

## H. Verify Finance separation

Open:

**Finance & Accounting → Management Accounting → Reconciliation**

The following classes must have separate lines and separate inventory/COGS accounts:

| Class | Inventory GL | COGS GL |
|---|---:|---:|
| Motorcycles | 1200 | 5000 |
| Batteries | 1220 | 5020 |
| Lockers / BSS | 1225 | 5030 |
| Spare Parts | 1235 | 5040 |
| Chargers | 1245 | 5050 |
| Other Inventory | 1248 | 5090 |

The migration also reclassifies the historical combined opening balance without changing total assets:

- Lockers/BSS inventory moves from 1220 to 1225.
- Deployed lease batteries move from 1310 to 1330.
- The reclassification is recorded in posted journal `JE-INVENTORY-CLASS-RECLASS-V13-1`.

## I. Verify R2 document uploads

1. Open a module record that supports attachments, such as a lease contract.
2. Upload a PDF, image, Word, Excel, or CSV file.
3. Confirm that the document appears in the record.
4. Open Cloudflare **R2 Object Storage → e88-erp-documents**.
5. Confirm the file appears under a key beginning with:

```text
workspace/<module-code>/<record-number>/
```

The file itself is stored in R2. Its document number, record relationship, file name, content type, size, and uploader are stored in D1.

## J. Troubleshooting

### The workflow does not appear in Actions

Confirm the repository contains:

```text
.github/workflows/deploy-e88-erp.yml
```

The workflow must be committed to the selected branch.

### The ERP opens but shows no records

The configured D1 database is likely empty or is not the database used by the previous deployment.

- Check the `database_id` in `wrangler.toml`.
- Review the workflow step **Show D1 record counts before deployment**.
- If the database is intentionally new and empty, rerun using `bootstrap_empty_database`.
- Never bootstrap an existing database with live records.

### Health shows `r2Bound: false`

The deployed Worker did not receive the `DOCS` binding. Confirm the R2 section remains in `wrangler.toml` and deploy using the v13.1 workflow. Do not use the old workflow that stripped R2.

### Health shows `r2Bound: true` but `r2Ready: false`

The bucket may not exist, may have a different name, or the deployment token may lack R2 write permission. The required bucket name is exactly:

```text
e88-erp-documents
```

### The D1 upgrade prerequisite fails

The existing database does not have the v12 connected schema. Do not force the migration. Either use a correctly upgraded existing database or create a new empty D1 database and select `bootstrap_empty_database`.

### The smoke test cannot reach the URL

Confirm the `deployment_url`. If Cloudflare Access protects the entire site, the workflow may need service-token headers. The deployment itself may still be successful, but the public smoke test cannot pass through Access without credentials.

## K. Rollback rule

A Worker code rollback can restore an earlier Worker version, but it does not undo records already written to D1 or files stored in R2. Use D1 Time Travel for database recovery and keep the R2 objects unless an approved data-recovery procedure requires otherwise.
