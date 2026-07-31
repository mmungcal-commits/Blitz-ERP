# E88 Enterprise System v13.0 Rollout Self-Test Report

Generated: 2026-07-31T10:54:22
**Result: 73/73 tests passed.**

- [x] **All opening SQL chunks execute** — 9 chunks
- [x] **No foreign-key violations** — 0 violations
- [x] **Actual source workbooks embedded** — 0
- [x] **Source rows archived** — 0
- [x] **Canonical assets loaded** — 8650
- [x] **Asset quality classification covers all assets** — 8650
- [x] **Dashboard canonical view excludes non-physical and duplicate rows** — 2885
- [x] **ATLAS receiving match control installed** — 
- [x] **PO-controlled ATLAS link installed** — 
- [x] **Cycle count control installed** — 
- [x] **Inventory planning control installed** — 
- [x] **Connected requisition custody control installed** — 
- [x] **Lease contract and actual-unit control installed** — 
- [x] **Delete and reversal approval control installed** — 
- [x] **Existing requisitions have custody context** — 207
- [x] **Serial custody history view installed** — 
- [x] **Connected double-entry journal installed** — 
- [x] **Inventory finance event bridge installed** — 
- [x] **AR/AP subledgers installed** — 
- [x] **Treasury reconciliation installed** — 
- [x] **Fixed asset and depreciation installed** — 
- [x] **Four legal entities configured** — 4
- [x] **Finance chart of accounts configured** — 63
- [x] **Finance cutover inventory agrees with serial subledger** — subledger=66355519.99, gl=66355519.99
- [x] **Every inventory class separately reconciles to its GL account** — MC=0.0, BAT=0.0, BSS=0.0, SP=0.0, CHG=0.0, OTH=0.0
- [x] **Motorcycles, batteries, lockers/BSS, spare parts and chargers remain distinct** — MC,BAT,BSS,SP,CHG,OTH
- [x] **Lease motorcycle and battery fixed assets use separate GL accounts** — 
- [x] **Transaction-purpose accounting rules installed** — 12
- [x] **Connected functional submodules installed** — 70
- [x] **Controlled provisional serial valuation loaded** — 3084
- [x] **Missing historical costs remain visible and blocked** — 5566
- [x] **Historical lease units capitalized to fixed assets** — 604
- [x] **Operational inventory subledger agrees with GL** — subledger=66355519.99, gl=66355519.99
- [x] **Fixed asset subledger agrees with GL** — subledger=22273649.02, gl=22273649.02
- [x] **No finance posting errors at cutover** — 0
- [x] **Return-obligation control installed** — 
- [x] **Sales-return source and finance bridge installed** — 
- [x] **Landed-cost VAT and accrual controls installed** — 
- [x] **All rollout specialist engine tables installed** — 26/26
- [x] **All 83 enterprise modules mapped to an engine** — 83
- [x] **Rollout readiness view covers every enterprise module** — 83
- [x] **Core transaction modules retain specialist core engines** — 16
- [x] **Wider enterprise modules use specialist engines** — 56
- [x] **Platform add-ons have controlled integration engines** — 11
- [x] **Default amount-based approval matrix installed** — 3
- [x] **Default approval roles resolve to active roles** — 0
- [x] **Pending approval queue view installed** — 
- [x] **Specialist chart accounts installed** — 11
- [x] **Enterprise document flow view installed** — 
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
| `erp_import_rows` | 0 |
| `erp_transaction_purpose_rules` | 12 |
| `erp_return_obligations` | 0 |
| `erp_inventory_valuation_exceptions` | 5,566 |
| `erp_module_submodules` | 70 |
| `erp_fixed_asset_books` | 604 |
| `erp_specialist_module_config` | 83 |
| `erp_approval_matrices` | 3 |
| `erp_workflow_approvals` | 0 |
| `erp_core_workflow_approvals` | 0 |
| `erp_enterprise_record_links` | 0 |
| `erp_crm_pipeline_records` | 0 |
| `erp_manufacturing_documents` | 0 |
| `erp_quality_documents` | 0 |
| `erp_project_documents` | 0 |
| `erp_eam_documents` | 0 |
| `erp_facility_documents` | 0 |
| `erp_logistics_documents` | 0 |
| `erp_hcm_documents` | 0 |
| `erp_srp_documents` | 0 |
| `erp_finance_specialist_documents` | 0 |
| `erp_platform_integrations` | 0 |

## Inventory by category

| Category | Assets |
|---|---:|
| MC | 3,177 |
| BAT | 2,641 |
| OTH | 1,169 |
| CHG | 682 |
| SP | 644 |
| BSS | 337 |

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
