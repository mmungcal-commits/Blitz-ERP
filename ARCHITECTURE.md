# E88 FinSys v7.1 Architecture

## Platform

- **Web/API:** Cloudflare Workers, Hono
- **Database:** Cloudflare D1 / SQLite-compatible relational model
- **Static application:** Cloudflare Worker static assets
- **Authentication:** Cloudflare Access identity header, restricted to `@nrdev.ph`
- **Documents:** Optional Cloudflare R2 `DOCS` binding
- **Mobile:** Responsive browser application for Android and iOS

## Domain structure

### Master data

- `erp_items`: item code, category, model, serialized/non-serialized classification
- `erp_assets`: one canonical serial record and its current state
- `erp_locations`: warehouse, customer, project site, station, employee, repair, quarantine
- `erp_partners`: customers, vendors, employees, and site partners

### Inbound logistics

- `erp_purchase_orders` and lines
- `erp_landed_cost_headers`, lines, and allocations
- `erp_import_batches` and source-row archive
- `erp_shipments`, lines, and expected assets
- `erp_receipts` and receipt lines

ATLAS is the supplier manifest. Posting an ATLAS import creates the shipment and expected serial list. Receiving selects that shipment and checks each scanned serial against the manifest.

### Inventory and movement

- `erp_assets` is the current-state table.
- `erp_stock_ledger` is the permanent movement history.
- Movement posting uses optimistic locking to reject conflicting concurrent updates.
- Serial exceptions and reconciliation cases are separated from canonical inventory.

Supported states and holders include warehouse availability, customer lease/sale, employee custody, pilot testing, swapping station, repair, quarantine, return, and disposal.

### Outbound and commercial

- `erp_requisitions` and lines
- `erp_pre_release_checks`
- `erp_deliveries` and delivery assets
- `erp_sales_orders` and sales lines
- `erp_assignments` and assignment assets
- Customer credit events and blocking controls

An outbound transaction consumes a currently available serial and updates the same asset state. It does not create another independent inventory record.

### Returns and battery reconciliation

- A returned serial is accepted and recorded even when it differs from the expected serial.
- Battery mismatches are classified as `BATTERY_SWAP`.
- The actual returned battery is moved to Returns Quarantine.
- A case remains `UNRECONCILED` until an authorized reviewer resolves it.
- No source evidence is deleted.

### Swapping-station projects

- `erp_station_projects` records planning, progress, target date, activation, and operating status.
- `erp_station_project_assets` links actual BSS/locker, battery, charger, and component serials to the project.
- Inventory traceability and project status remain connected.

### Finance and planning

- Procurement and payment registers
- Sales receipts
- Approved budget by department/account/month
- Planning drivers from the financial model
- Landed-cost records and allocations

## Code generation

New item codes are generated atomically from `erp_sequences`:

| Category | Prefix |
|---|---|
| Motorcycle | `MC-` |
| Battery | `BAT-` |
| Swapping station / locker / spaceport | `BSS-` |
| Spare part | `SP-` |
| Charger | `CHG-` |
| Other | `OTH-` |

Opening-data migration advances each sequence beyond the highest imported code to prevent collision.

## Security model

- Cloudflare Access must protect the Worker URL.
- `Cf-Access-Authenticated-User-Email` is the production identity source.
- Users outside `nrdev.ph` are rejected.
- Permissions are checked server-side by module/action: View, Create, Edit, Approve, Post, Export, Manage.
- The application does not store user passwords when Cloudflare Access is used.
- Audit logs retain user, action, record, before/after details, and timestamp.
