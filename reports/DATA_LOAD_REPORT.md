# E88 FinSys v8.1 Data Load Report

Generated: 2026-07-30T00:59:12

## Actual source workbooks

| Source | Archived operational rows |
|---|---:|
| 2026 SCM Warehouse Documents.xlsx | 286 |
| ATLAS - Asset Manifest (1).xlsx | 2,033 |
| Detailed_Receipts_2026.xlsx | 931 |
| E88_AM_FINAL_v5A.xlsx | 711 |
| E88_ApprovedBudget2026 (4)(1).xlsx | 1,357 |
| E88_ProcurementMonitoring_2026.xlsx | 6,003 |
| E88_SalesMonitoring_2026.xlsx | 960 |
| Pre-release Unit Checklist.xlsx | 292 |
| SATURN _ DELIVERY MONITORING _ LAST MILE (3).xlsx | 1,161 |
| SCM Live Dashboard (3).xlsx | 262 |
| SCM Requisition Slip 1226.xlsx | 208 |
| STAKU - SALES_LEASE B2B (4).xlsx | 265 |
| STAR _ E88 SCM Inventory2026 (4).xlsx | 9,600 |
| STELLAR _ Shipment.xlsx | 49 |

## Canonicalization policy

- One canonical asset is retained for each normalized serial number.
- Duplicate master occurrences are preserved as open serial exceptions; they are not deleted.
- Operational references across STAR, STAKU, SATURN, ATLAS, requisitions, checklists, and warehouse documents link back to the canonical asset.
- Battery serial swaps on return are accepted into quarantine and remain `UNRECONCILED` until reviewed.
- Missing item descriptions automatically receive category-based item codes. Runtime sequences are advanced past every migrated code.
- Legacy password columns are redacted from both the database source archive and the deployable workbook copy. All non-credential operational fields remain included.
