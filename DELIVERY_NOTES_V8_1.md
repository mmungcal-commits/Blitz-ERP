# E88 FinSys v8.1 Delivery Notes

## Delivered operating flow

`ATLAS upload → expected shipment → Receiving selects shipment reference → actual item/serial entry or QR scan → expected-versus-actual validation → posting → canonical inventory / quarantine exception`

### ATLAS
- The supplier ATLAS workbook creates expected shipments, item lines, expected quantities, and expected serials.
- ATLAS does not create inventory.
- A serial already present in the asset master is retained as an expected-shipment exception rather than silently removed.

### Receiving
- The user selects an open shipment reference.
- The workbench displays expected lines, expected quantities, previously received quantities, remaining quantities, and open expected serials.
- The user selects an expected serial or shipment item line and records the actual serial.
- QR/barcode image reading can populate the active actual-serial row.
- The system validates before posting.

Receiving results:
- `MATCHED`: expected item and expected serial received; asset becomes Available and Clear.
- `SERIAL_SUBSTITUTED`: same expected item, different actual serial; actual asset is created in Quarantine and marked Unreconciled.
- `UNPLANNED_SERIAL`: item belongs to the shipment, but serial is not in ATLAS.
- `OVER_RECEIPT`: expected quantity is already complete.
- `UNEXPECTED_ITEM`: no expected shipment line is selected or matched.
- `DUPLICATE_SERIAL`: actual serial already exists in inventory.

Expected and actual serials are stored together in `erp_expected_receipt_matches`. All non-matched receipts create a controlled variance in `erp_receiving_variances`.

## Inventory count correction
- Raw source records remain available for audit.
- Dashboard and operational allocation use `vw_erp_serialized_assets` only.
- Non-physical quantity proxies and obvious suffixed duplicates such as `-1` and `-2` are excluded from KPI counts when the base serial exists.
- The current opening-data classification produces:
  - Motorcycles: 462
  - Batteries: 1,847
  - Swapping stations: 80
  - Chargers: 496
  - Suffixed duplicate rows excluded: 50

These are system-classified counts and should still be reconciled with approved physical count results before management sign-off.

## Ramco-style interface
- Arial typography and tabular numerals
- Dense enterprise toolbar and workbench tables
- Right-aligned financial values with consistent decimals
- Expected shipment register and editable receiving grid
- Excel-style Budget and Forecast workbench with Department, Cost Center, Account Title, Jan–Dec, FY Budget, Actual, Forecast, Variance, and Variance %
- Official E88 logo with transparent outer background
- Instructional dashboard hero removed

## Deployment
For the already-populated `e88-v7` D1 database, use the GitHub Action:

`Upgrade E88 FinSys v8.1 and Deploy`

Enter confirmation:

`E88_UPGRADE_V81`

Do not run the opening-data bootstrap again for this upgrade.
