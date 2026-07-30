# E88 FinSys v8.1 — Ramco-Style Connected ERP

**Copyright © 2026 AM. All rights reserved.**

E88 FinSys is a Cloudflare Workers and D1 enterprise application for E88 supply chain, inventory, logistics, sales, lease, project planning, budgeting, and finance controls.

## Core transaction flow

`ATLAS supplier upload → expected shipment → receiving workbench → actual serial validation → inventory / quarantine → stock movement → requisition / sale / lease → delivery → return → reconciliation`

ATLAS is the basis of what E88 expects to receive. Inventory is created only from the actual receipt posted by Receiving.

## v8.1 controls

- Receiving must select an expected shipment reference.
- Expected and actual serials are stored separately.
- Same item with a different actual serial is classified as `SERIAL_SUBSTITUTED`.
- Substituted, unplanned, excess, or unexpected receipts are accepted into quarantine and remain unreconciled.
- Exact matches become available inventory.
- QR or barcode images can populate actual serials before validation.
- Expected quantities, prior receipts, current receipts, total receipts, and remaining quantities are visible in one workbench.
- Dashboard counts use classified physical assets, not all raw imported rows.
- Obvious suffixed duplicates are excluded from operational KPI counts while source evidence remains retained.
- Budget and Forecast uses an Excel-style monthly grid with editable cells and consistent corporate number formatting.

See `DELIVERY_NOTES_V8_1.md` for the complete release scope.

## Verification

```bash
npm install
python -m pip install openpyxl
npm run build
```

Current automated result: **207 structure checks passed, 5 unit tests passed, and 32 data-integrity tests passed.**

## Upgrade the existing live database

The live database is configured as:

- Binding: `DB`
- Database: `e88-v7`
- Database ID: `37da8de0-9574-43d0-8bde-69719342cbbd`

Use GitHub Actions:

1. Open **Actions**.
2. Select **Upgrade E88 FinSys v8.1 and Deploy**.
3. Click **Run workflow** on branch `main`.
4. Enter `E88_UPGRADE_V81`.
5. Run the workflow.

This applies only the non-destructive v8.1 migrations and deploys the Worker. Do not run the opening-data bootstrap again.
