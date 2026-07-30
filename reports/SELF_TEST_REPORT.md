# E88 FinSys v8.1 Self-Test Report

Generated: 2026-07-30T00:59:12
**Result: 32/32 tests passed.**

- [x] **All opening SQL chunks execute** — 13 chunks
- [x] **No foreign-key violations** — 0 violations
- [x] **Actual source workbooks embedded** — 14
- [x] **Source rows archived** — 24118
- [x] **Canonical assets loaded** — 8650
- [x] **Asset quality classification covers all assets** — 8650
- [x] **Dashboard canonical view excludes non-physical and duplicate rows** — 2885
- [x] **ATLAS receiving match control installed** — 
- [x] **No duplicate canonical asset serials** — 
- [x] **Duplicate serial evidence preserved** — 6697
- [x] **Shipments created from STELLAR/ATLAS** — 28
- [x] **ATLAS expected serials created** — 2015
- [x] **Historical receiving linked to shipments** — 2015
- [x] **Stock movements loaded** — 5807
- [x] **Sales and lease assignments loaded** — 264
- [x] **Delivery asset history loaded** — 1115
- [x] **Historical returns loaded** — 46
- [x] **Battery swaps remain unreconciled** — 323
- [x] **Requisitions loaded** — 207
- [x] **Pre-release checks loaded** — 289
- [x] **Approved purchase orders loaded** — 20
- [x] **Procurement register loaded** — 1261
- [x] **Sales receipts loaded** — 140
- [x] **Budget loaded** — 133
- [x] **Planning drivers loaded** — 4096
- [x] **Station projects linked to assets** — 389
- [x] **Admin live access loaded** — 
- [x] **Sales serials resolve to assets** — 0
- [x] **Delivery serials resolve to assets** — 0
- [x] **New item codes cannot collide with opening codes** — MC:max=71,next=72; BAT:max=40,next=41; BSS:max=57,next=58; SP:max=21,next=22; CHG:max=4,next=5; OTH:max=156,next=157
- [x] **Legacy plaintext passwords redacted from database archive** — 0
- [x] **Bundled source workbooks contain no readable passwords** — 0

## Loaded operational counts

| Table | Rows |
|---|---:|
| `erp_items` | 761 |
| `erp_assets` | 8,650 |
| `erp_serial_exceptions` | 6,697 |
| `erp_shipments` | 28 |
| `erp_expected_assets` | 2,015 |
| `erp_receipts` | 15 |
| `erp_receipt_lines` | 2,015 |
| `erp_stock_ledger` | 5,807 |
| `erp_sales_orders` | 264 |
| `erp_sales_lines` | 1,053 |
| `erp_deliveries` | 143 |
| `erp_delivery_assets` | 1,115 |
| `erp_return_orders` | 46 |
| `erp_return_lines` | 324 |
| `erp_reconciliation_cases` | 323 |
| `erp_requisitions` | 207 |
| `erp_requisition_lines` | 624 |
| `erp_pre_release_checks` | 289 |
| `erp_purchase_orders` | 20 |
| `erp_landed_cost_headers` | 8 |
| `erp_station_projects` | 44 |
| `erp_station_project_assets` | 389 |
| `erp_sales_receipts` | 140 |
| `erp_procurement_register` | 1,261 |
| `erp_payment_register` | 1,261 |
| `erp_budget_plan` | 133 |
| `erp_planning_drivers` | 4,096 |
| `erp_import_rows` | 24,118 |

## Inventory by category

| Category | Assets |
|---|---:|
| MC | 3,177 |
| BAT | 3,083 |
| OTH | 1,469 |
| SP | 345 |
| BSS | 336 |
| CHG | 240 |

## Inventory by current status

| Status | Assets |
|---|---:|
| AVAILABLE | 5,922 |
| LEASED | 747 |
| SOLD | 502 |
| TRANSFER_OUT | 421 |
| PILOT_TEST | 377 |
| ASSIGNED | 257 |
| INVENTORY_TRANSFER | 75 |
| DONE | 59 |
| DONATION | 50 |
| SALE_TO_CLIENT | 40 |
| INVENTORY_TRANSFER_FOR_RIDEBOX_SERVICE_CENTER | 26 |
| MYTHOS | 26 |
| INVENTORY_TRANSFER_TO_STA_ROSA | 21 |
| STOCK_TRANSFER_|_STOCK_TRANSFER | 19 |
| UNDER_REPAIR | 11 |
| REPLACEMENT_OF_OFFLINE_BATTERY_IN_JAMO_CORP | 10 |
| QUARANTINE | 9 |
| REPLACED_PARTS | 9 |
| LOANER_UNIT | 8 |
| OKLA_CHINA | 7 |
| EMPLOYEE_UNIT | 6 |
| CORINTHIAN_HILLS | 5 |
| MOBILE_BSS | 5 |
| FOR_CORNER_STONE | 4 |
| ASSIGMENT_TO_EMPLOYEE | 3 |
| OTHERS | 3 |
| BACK_UP_BATTERY_FOR_FOREST_HILLS_EVENT | 2 |
| ENAN/ARBY | 2 |
| INVENTORY_TRANSFER_TO_TCI | 2 |
| PARTS_REPLACEMENT | 2 |
| REPLACEMENT_FOR_D400_BLACK_WITH_DEFFECTIVE_PARTS | 2 |
| REPLACEMENT_FOR_OFFLINE_BATTERIES | 2 |
| REPLACEMENT_OF_2_OFFLINE_BATTERIES | 2 |
| INSTALL_TO_SAMPLE_UNIT_IN_TCI | 1 |
| PQM/CRIS_MENDOZA | 1 |
| PULL_OUT_DEFECTIVE_BATTERIES_FROM_STA_ROSA_&_BF_HOMES_PARANAQUE | 1 |
| REPLACED_DEFFECTIVE_PARTS_|_REPLACEMET_PARTS_FOR_DEFFECTIVE_ODOMETER_FOR_DASMA_MAKATI | 1 |
| REPLACEMENT_OF_CONTROLLER_OF_CLIENT_UNDER_WARRANTY | 1 |
| REPLACEMENT_OF_OFFLINE_BATTERY_IN_POWERFILL_SANDOVAL_PASIG | 1 |
| REPLACEMENT_PARTS_FOR_D400_DASHBOARD | 1 |
| REPLACE_DEFFECTIVE_PART_FOR_EMPLOYEE_SERVICE_UNIT_(PMS) | 1 |
| RIDEBOX_SERVICE_CENTER_ASGARD | 1 |
| SALE_TO_CLIENT_|_SALE_TO_CLIENT | 1 |
| SERVICE_UNIT | 1 |
| SOURCING_OF_POSSIBLE_LOCKERS_LOCATION | 1 |
| STOCK_TRANSFER | 1 |
| SWAPPING_OF_PARTS_(SEAT) | 1 |

## Test boundary

The package was tested locally against SQLite using the complete schema, legacy opening data, connected ERP migrations, and all generated opening-data chunks. Live Cloudflare Access, R2 uploads, D1 concurrency, and the production Workers deployment must still be smoke-tested after deployment because those services are not available in the local container.
