# E88 Enterprise ERP v13.1 Completion Report

## Release purpose

This release corrects the rollout issues identified during user review of v13.0:

- empty record views after deployment;
- R2 binding removed by the old GitHub workflow;
- wrong R2 bucket name;
- inventory grouped into broad combined totals;
- batteries and lockers/BSS sharing the same Finance balance;
- non-clickable inventory rows;
- table headers disappearing while scrolling;
- columns that could not be resized;
- long loading time caused by loading the entire serial register on the overview screen;
- non-collapsible enterprise module groups.

## Inventory source-of-truth implementation

The uploaded STAR, ATLAS, STELLAR, Warehouse Documents, Requisition, PDI, SATURN, and STAKU workbooks are preserved in `source_data`. All nine operational workbooks uploaded in the current chat match their bundled copies by SHA-256.

Inventory is now presented and posted by exact:

- class;
- material code;
- item description;
- serial number;
- location;
- custody/status;
- valuation status;
- unit cost;
- source document.

The classes are:

- MC: Motorcycles
- BAT: Batteries
- BSS: Lockers / Battery Swapping Stations
- CHG: Chargers
- SP: Spare Parts
- OTH: Other Inventory

## Separate Finance control accounts

The inventory and COGS accounts are not combined:

- 1200 / 5000: Motorcycles
- 1220 / 5020: Batteries
- 1225 / 5030: Lockers and BSS
- 1235 / 5040: Spare parts
- 1245 / 5050: Chargers
- 1248 / 5090: Other inventory

Historical v12 combined balances are separated using posted journal `JE-INVENTORY-CLASS-RECLASS-V13-1`. Total assets do not change.

Lease fixed assets are also separated:

- 1310: Motorcycles held for lease
- 1330: Lease battery pool
- 1320: BSS and RideBox equipment
- 1340: Charging equipment

## Connected transaction changes

- Goods receipt Finance events are created separately by inventory class.
- Landed-cost capitalization events are created separately by inventory class.
- Sales, returns, write-offs, consumption, warranty issues, and valuation changes use the correct inventory and COGS account for the asset's class.
- Inventory and fixed-asset reclassifications retain posted journal history.
- Serial-level movement and custody remain connected to requisitions, delivery, returns, sales/lease, and Finance.

## Interface changes

- Gray enterprise group headers expand and collapse their blue module buttons.
- Expand-all and collapse-all controls are available.
- Warehouse overview loads summaries instead of downloading thousands of serial rows.
- Inventory is listed by exact material code rather than one combined amount.
- Serial register is paginated at 100 rows per page.
- Inventory rows open a connected detail modal.
- Table headers remain frozen during vertical scrolling.
- Columns are drag-resizable and their widths are saved in browser storage.
- GET requests use a short cache and duplicate in-flight calls are combined.
- Slow requests time out with a clear message instead of appearing to load forever.

## GitHub and R2 deployment changes

The old workflow was removed. The new workflow:

- preserves the `DOCS` R2 binding;
- uses `e88-erp-documents` consistently;
- supports existing-D1 upgrade and empty-D1 bootstrap as separate controlled choices;
- prevents opening data from being loaded by default;
- verifies record counts;
- deploys with `cloudflare/wrangler-action@v3`;
- verifies build, D1 binding/access, and R2 binding/access after deployment.

## Validation

- Structural and source checks: 374 passed
- Executable Node unit/lifecycle checks: 24 passed
- Workbook, migrated-data, accounting, and reconciliation checks: 73 passed
- Inventory class reconciliation differences: 0.00 for MC, BAT, BSS, SP, CHG, and OTH
- Motorcycle fixed-asset account vs subledger: reconciled
- Lease battery-pool account vs subledger: reconciled
- Uploaded operational workbooks: 9 of 9 exact SHA-256 matches

## Record-visibility rule

The source-derived operational records appear only when the deployed Worker is bound to the intended D1 database. For the current live database, the GitHub workflow must use `upgrade_existing`. A newly created empty D1 must use `bootstrap_empty_database` to load the approved opening records.

The specialist module engines do not create fictitious opening transactions. A zero-record register in Manufacturing, HCM, Projects, EAM, SRP, or another specialist domain means no approved source transactions were provided for that domain, not that the engine is missing.

## Production boundary

This package is deployable through GitHub Actions. It is not considered live until the workflow succeeds against the intended Cloudflare account, the correct D1 database is selected, R2 reports ready, and the user verifies the inventory and Finance screens after deployment.
