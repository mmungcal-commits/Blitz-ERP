# E88 Enterprise ERP v13.1

**Build:** `E88-ROLLOUT-ERP-20260731-R13.1`  
**Deployment:** GitHub Actions to Cloudflare Workers, D1, and R2  
**Detailed guide:** `DEPLOY_GITHUB_R2_V13_1.md`

## Operational model

`ATLAS → STELLAR → Procurement → Receiving → STAR Serialized Inventory → Requisition → PDI → Warehouse Release → SATURN Delivery / Return → STAKU Sale / Lease → Finance`

The uploaded operational Excel workbooks are retained under `source_data/` as source evidence. The application converts them into canonical ERP documents, exact item/material records, serialized assets, movements, custody, exceptions, commercial records, and accounting controls.

## Exact inventory policy

Inventory is never presented or posted as one combined motorcycle/battery/locker/spare-parts amount. It remains separate by:

- inventory class;
- material code;
- item description;
- serial number;
- warehouse or deployment location;
- custody and transaction purpose;
- unit cost and valuation status;
- inventory GL and COGS GL.

| Class | Inventory GL | COGS GL |
|---|---:|---:|
| Motorcycles | 1200 | 5000 |
| Batteries | 1220 | 5020 |
| Lockers / BSS | 1225 | 5030 |
| Spare parts | 1235 | 5040 |
| Chargers | 1245 | 5050 |
| Other inventory | 1248 | 5090 |

Durable lease assets also remain separate: motorcycles in 1310, BSS/RideBox equipment in 1320, lease batteries in 1330, and charging equipment in 1340.

## Connected controls

- Purchase order, shipment, serialized receipt, GRNI, supplier billing, input VAT, EWT, AP, payment, and landed cost.
- Sale, AR, output VAT, COGS, inventory issue, delivery, customer return, credit memo, and COGS reversal.
- Lease deployment, custody, billing, deposits, return obligations, fixed-asset capitalization, and depreciation.
- Demo, pilot, employee use, project deployment, dealer custody, transfer, warranty replacement, donation, consumption, and write-off.
- Approval-controlled void, cancellation, reversal, valuation change, period close, and deletion request. Posted history is not physically deleted.
- Role permissions, segregation of duties, audit history, source-document links, R2 attachments, and Finance reconciliation.

## Interface corrections in v13.1

- Gray enterprise group headers expand and collapse the blue submodule buttons.
- Exact material-code inventory replaces the broad combined inventory view.
- Serial rows and item rows open connected transaction details.
- Table headers remain visible while scrolling.
- Table columns are drag-resizable and saved in the browser.
- The serial register is paginated.
- Summary screens no longer load thousands of serial rows at once.
- Repeated GET calls are cached briefly and duplicate in-flight calls are combined.

## Records after deployment

For an existing live ERP, run the workflow using `upgrade_existing`. This preserves the configured D1 records and applies migrations `0021` and `0022`.

For a newly created and truly empty D1 database, use `bootstrap_empty_database`. This loads the Excel-derived opening records, including 8,650 serialized assets and 5,807 stock movements. A safety script stops bootstrap when serialized records already exist.

Specialist modules such as Manufacturing, HCM, Projects, EAM, and SRP have functional engines and forms, but they do not contain invented opening transactions. Their registers remain empty until actual records are entered or approved migration data is supplied.

## Validation

- Structural, route, workflow, source, and interface checks: **374 passed**
- Executable Node transaction and lifecycle tests: **24 passed**
- Workbook, migrated-data, accounting, and reconciliation checks: **73 passed**
- Operational workbooks uploaded in this chat: **9 of 9 exact SHA-256 matches**
- Inventory classes MC, BAT, BSS, SP, CHG, and OTH: **zero class-to-GL difference**
- Fixed-asset motorcycle and lease-battery control accounts: **reconciled**
- Cutover Finance posting errors: **zero**

The live Cloudflare Worker, intended D1 database, R2 bucket, access policy, and production users must still pass the GitHub smoke test and user acceptance checks after deployment.

## Main files

- `.github/workflows/deploy-e88-erp.yml`
- `DEPLOY_GITHUB_R2_V13_1.md`
- `BUILD_COMPLETION_REPORT_V13_1.md`
- `reports/BUILD_VALIDATION_V13_1.md`
- `migrations/0022_inventory_class_r2_rollout.sql`
- `wrangler.toml`

**Copyright © 2026 AL23. All rights reserved.**
