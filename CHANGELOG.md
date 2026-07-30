# Changelog

## 8.1.0
- Added ATLAS expected-shipment policy.
- Added shipment-based Receiving Workbench with expected and actual serial controls.
- Added receiving validation, serial substitution, over-receipt, unplanned serial, duplicate serial, and unexpected item classifications.
- Added expected-to-actual match and receiving variance tables.
- Added QR population for actual receiving rows.
- Added canonical physical-asset KPI view and suffix-duplicate exclusion.
- Rebuilt Budget and Forecast as an Excel-style editable monthly grid.
- Reworked the UI toward a dense Ramco-style enterprise workbench.
- Added transparent official E88 logo asset.
- Added safe v8.1 upgrade-and-deploy GitHub workflow.

## 7.1.0 — Connected ERP rebuild

- Replaced isolated file-style workflows with one serial-level Supply Chain and Sales transaction engine.
- Added ATLAS upload, validation, shipment creation, and expected-serial generation.
- Added PO and landed-cost controls.
- Added shipment-based receiving and QR/barcode review.
- Added canonical inventory assets and immutable movement ledger.
- Added location, customer, employee, pilot-test, repair, station, and quarantine movements.
- Added requisitions, pre-release checks, deliveries, sales, and lease assignment.
- Added return acceptance and unreconciled battery-swap cases.
- Added customer credit controls.
- Added swapping-station project and asset lifecycle.
- Added budget, forecast, procurement, payment, and sales-receipt registers.
- Added automatic category-based item-code generation.
- Embedded all shared Excel files and generated the opening database.
- Preserved duplicate serial evidence as exception records.
- Added responsive professional UI, clickable KPI drill-downs, dark/light modes, and QR image reading.
- Added guarded database bootstrap, self-tests, CI, deployment, rollback, and UAT documentation.