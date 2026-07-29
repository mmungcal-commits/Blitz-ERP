# E88 FinSys v7.1 — Connected Supply Chain and Sales ERP

**Copyright © 2026 AM. All rights reserved.**

E88 FinSys is a Cloudflare Workers + D1 application rebuilt around one connected operational transaction engine. It replaces repeated encoding across ATLAS, STELLAR, STAR, STAKU, SATURN, warehouse documents, requisitions, checklists, sales monitoring, procurement monitoring, budgets, and planning files.

## Connected operating flow

`ATLAS supplier upload → shipment → expected serials → PO/landed cost → receiving → canonical inventory → location/custody movement → requisition/pre-release → delivery → sale/lease → return → reconciliation`

The same serial record is reused throughout the process. A transaction creates the relevant downstream records instead of requiring staff to encode the same information in separate trackers.

## Critical controls

- One canonical asset for every normalized motorcycle, battery, swapping-station, charger, or serialized part.
- Duplicate serial occurrences are retained as exception evidence; they are not silently deleted.
- Battery swaps during return are accepted into quarantine and opened as `UNRECONCILED` cases.
- ATLAS Excel upload creates shipments, shipment lines, and expected serials.
- Receiving is performed against the expected shipment and creates inventory only when posted.
- QR/barcode image reading supports serial review before posting.
- New item descriptions automatically receive category-based codes: `MC-`, `BAT-`, `BSS-`, `SP-`, `CHG-`, or `OTH-`.
- Sales, lease, delivery, employee custody, pilot test, repair, return, and location transfer use the same stock ledger.
- Role/action permissions remain enforced in the backend.
- Access is restricted to authorized `@nrdev.ph` users through Cloudflare Access.
- KPI cards drill into the underlying transactions and serials.

## Data-loaded opening database

The deployment package includes all 14 shared workbooks in `source_data/` and generated opening-data SQL in `migrations/opening/`.
The deployable pre-release workbook copy preserves all operational data but redacts 208 readable credential cells; credentials are not ERP opening data and are not committed to GitHub.

Key loaded counts:

- 24,118 source rows archived with traceability
- 761 item masters
- 8,650 canonical assets
- 6,697 duplicate/serial exception records
- 28 shipments
- 2,015 ATLAS expected assets and receiving lines
- 5,807 stock movements
- 264 sales/lease assignments
- 1,115 delivery-asset records
- 46 returns and 323 unreconciled battery-swap cases
- 1,261 procurement and payment register entries
- 133 approved-budget rows
- 4,096 planning-driver rows

See `reports/DATA_LOAD_REPORT.md` and `reports/SELF_TEST_REPORT.md`.

## Local verification

Requirements: Node.js 20+, Python 3.11+, and `openpyxl`.

```bash
npm install
python -m pip install openpyxl
npm run build
npm run db:bootstrap:local
npm run dev
```

## Production deployment

Do not bootstrap the opening data into the current live D1 database without a backup. The safest cutover is:

1. Export the current live D1 database.
2. Create a new D1 database for v7.1.
3. update the D1 `database_id` in `wrangler.toml`.
4. Run the guarded remote bootstrap.
5. Deploy the Worker.
6. Perform live UAT.
7. Retain the previous Worker/D1 for rollback.

Read `DEPLOYMENT.md` and `GO_LIVE_CHECKLIST.md` before deployment.
