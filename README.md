# E88 Enterprise System v11.0 — Full Connected ERP

**Copyright © 2026 AL23. All rights reserved.**

E88 FinSys is a Cloudflare Workers and D1 enterprise application for E88 supply chain, inventory, logistics, sales, lease, project planning, budgeting, and finance controls.

## Full operational modules

- Every enterprise module has its own record types, fields, auto-numbered documents, workflow actions, approval worklist, live reports, data dictionary, controls, and connected-module navigation.
- Sales & Distribution includes CRM, demand planning, connected sales orders, lease contracts and document storage, outbound logistics, warranty, service, PIM, and customer requests.
- Inventory & Procurement includes inventory planning, warehouse visibility, mobile QR cycle counting, sourcing and RFQ, purchase orders, ATLAS expected shipments, QR goods receipt, subcontracting, and supplier submissions.
- Connected sales-order approval reserves only clear available serials and creates assignments and outbound deliveries.
- Approved purchase orders are selectable by ATLAS; goods receipt creates serial inventory and Finance entries; landed costs increase inventory and Accounts Payable.
- User administration includes selectable module access, role-level action permissions, password activation/reset, and immutable access audit.

## Connected Finance

- Every operational transaction is retained as a source-to-ledger event with its source document and serial reference.
- Goods receipts debit inventory and credit GRNI; landed costs increase inventory; delivered sales create revenue, VAT, and COGS.
- Lease deployment remains a custody movement; recurring lease billing creates Accounts Receivable and lease revenue.
- Approved count shortages, losses, damage, and write-offs create inventory-variance journals.
- Capitalized motorcycles, batteries, and BSS equipment move from inventory to the fixed-asset register and depreciate by controlled monthly runs.
- Finance includes legal entities, chart of accounts, periods, journals, AR/AP aging, Requests for Payment, tax controls, treasury, bank reconciliation, fixed assets, budget versus actual, GL, trial balance, P&L, balance sheet, and cash flow.
- System journals are prepared automatically, but Finance validates and posts them. Preparers cannot approve their own work.
- Void, reversal, period close, depreciation, bank reconciliation, and payment workflows preserve independent approval and audit evidence.

## Core transaction flow

`ATLAS supplier upload → expected shipment → receiving workbench → actual serial validation → inventory / quarantine → stock movement → requisition / sale / lease → delivery → return → reconciliation`

ATLAS is the basis of what E88 expects to receive. Inventory is created only from the actual receipt posted by Receiving.

## Connected ERP controls

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
- All 83 enterprise modules use their own record types, fields, workflows, reports, and module connections.
- Sales and Distribution connects CRM, demand, sales orders, lease contracts, outbound custody, delivery, and returns.
- Requisitions support customers, employees, demos, pilots, departments, dealers, projects, and lease deployments.
- Lease contracts store signed documents, commercial terms, and the actual serialized units in Annex A.
- A delete or reversal is never physical deletion: it requires a reason and approval by another authorized user.

See `DELIVERY_NOTES_V8_1.md` for the complete release scope.

## Verification

```bash
npm install
python -m pip install openpyxl
npm run build
```

The release runs structure, unit, complete opening-data, authentication, permission, Finance, and inventory-to-ledger integration tests before deployment.

## Upgrade the existing live database

The live database is configured as:

- Binding: `DB`
- Database: `e88-v7`
- Database ID: `37da8de0-9574-43d0-8bde-69719342cbbd`

Use GitHub Actions:

1. Open **Actions**.
2. Select **Full Build E88 Connected ERP**.
3. Click **Run workflow** on branch `main`.
4. Enter `E88_COMPLETE_CONNECTED_ERP`.
5. Run the workflow.

This installs the non-destructive connected Finance migration and deploys the Worker. Do not run the opening-data bootstrap again.
