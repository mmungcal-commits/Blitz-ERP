# Changelog

## 11.0.0
- Removed the generic empty Reports and Setup fallback from every enterprise module.
- Added live module-specific registers, approval worklists, operational analytics, CSV exports, data dictionaries, workflow controls, and connected-module navigation across all 83 modules.
- Added a connected Sales Order workbench with customers and holders, serialized availability, credit control, approval, assignment, and delivery generation.
- Added a connected Sourcing and Purchasing center with RFQs, purchase orders, approval, ATLAS linkage, commitments, landed cost, and Finance posting.
- Connected CRM records to customer activities, PIM records to the item master, and supplier/subcontract records to the vendor master.
- Completed User Access administration with per-user module checkboxes, role permissions, and immutable access audit.
- Preserved approval-controlled void/reversal, unique document numbering, document uploads, AL23 copyright, and the internal Ramco-style workbench.

## 10.0.0
- Added a connected double-entry Finance engine across E88, NRD Motorcycle, RideBox, and Shared Services.
- Added source-to-ledger events for receipts, landed cost, sales revenue, COGS, lease billing, returns/custody, count adjustments, write-offs, fixed-asset capitalization, depreciation, collections, and payments.
- Added cutover opening inventory tied to the exact serial-level inventory subledger.
- Added chart of accounts, accounting periods, journal preparation/approval/posting/reversal, General Ledger, Trial Balance, P&L, Balance Sheet, and Cash Flow.
- Added AR/AP documents, aging, applications, VAT/EWT controls, lease billing, and controlled Request for Payment processing.
- Added bank accounts, statement transactions, posted-journal matching, zero-difference reconciliation, and independent approval.
- Added a serial-linked fixed-asset register and controlled depreciation runs.
- Added operational-to-Finance exception retry and inventory-to-GL reconciliation.
- Enforced approval before deletion, void, reversal, period close, bank reconciliation, depreciation posting, and payment confirmation.

## 9.1.0
- Added distinct functional definitions, forms, workflows, reports, and connections for all 83 enterprise modules.
- Connected requisitions, serialized allocations, pre-release checks, goods issuance, delivery custody, and lease-based goods returns.
- Added lease contract commercial terms, signed-document storage, and actual serialized unit assignments.
- Added customer, employee, demo, pilot, department, dealer, project, and lease deployment holders.
- Added partial return handling while preventing already returned serials from being selected again.
- Added approval-controlled void and reversal requests with separation of duties and immutable audit evidence.
- Rebuilt User Access as a direct profile, module checkbox, and role-authority workspace.

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
