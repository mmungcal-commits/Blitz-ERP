# Blitz - ERP — status against IMPROVE_ERP.docx

Audited against the live code on 7 Aug 2026, build `BLITZ-ERP-20260807-R23.0`.
Every line below was checked in the source, not assumed. "Partial" means something
real exists but does not yet do what the document asks.

Legend: **Done** · **Partial** · **Not built**

---

## 1. Branding, login, shell

| # | Requirement | Status |
|---|---|---|
| a | Logo background removed, "E88 Ventures Inc." white in the logo | Done |
| b | "Enterprise System" renamed to Blitz - ERP | Done |
| c | Lively, dynamic login page | Done |
| d | Separate login selector: System Administration does setup but cannot approve | Done |
| — | Module rail frozen in place whether groups are collapsed or expanded | Done |
| — | Live system, demo data removed, fully functional | Done |

## 2. Navigation order

| # | Requirement | Status |
|---|---|---|
| — | Hide Sourcing & Planning | Done |
| — | Order: Inbound → Warehouse → Cycle Counting → Reports | **Partial** — the order is right, but Reports is deleted at runtime by a hidden-modules list, so it never appears. The report screens exist and are unreachable. |

## 3. Purchase Order

| # | Requirement | Status |
|---|---|---|
| a | Row editable when DRAFT | **Not built** — no edit route and no edit control on the row |
| b | Admin has no approval role | **Partial** — the scope split works; stale `role_code='ADMIN'` bypasses still exist in three files and would reopen the hole if that role is ever assigned |
| c | No instructional notes, no long dashes | **Partial** — dashes all gone; several instructional notes remain (approval link, goods receipt, expected shipments) |
| d | Vendor connected to the vendor list | Done |
| e | Remarks placed after the amount | Done |
| f | Routing: Dept Manager (if filled) → Dept Head → Finance → CEO | Done |
| g | Typed signature renders in a signature font | Done |
| h | Mandatory document upload | **Partial** — enforced in the browser only; the API accepts a PO with no attachment |
| i | Every printed field exists in the entry form | Done |
| j | On save route to approval; on full approval auto-create the RFP | **Partial** — routing works; the RFP is *not* created automatically, the email only says one can be raised |

## 4. Expected shipments and goods receipt

| # | Requirement | Status |
|---|---|---|
| a–d | Select approved PO, show expected items, ATLAS upload replaces them with detail, proceed to receipt | Done |
| 5a–b | Select shipment; receive by QR / serial / manual on a phone | Done |
| 5c | Numbered printable Goods Receipt | Done |
| 5c | Discrepancies reconciled by **Finance only**, acknowledged by the department head | **Not built** — any user with generic receiving-approve rights can resolve; no department-head acknowledgement step |

## 5. Warehouse Management

| # | Requirement | Status |
|---|---|---|
| a | Overview improved, KPI cards drill into their ledger | **Partial** — location and item cards drill; the class cards silently do nothing |
| b | QR scanning on Unit Visibility | **Partial** — scanning exists in Stock Movement and QR Trace, but not on Unit Visibility itself |
| c | Available for Lease / Available for Sale, add-new status with restricted rule | Done |
| c | An item tagged SOLD becomes non-movable **and disappears from the system** | **Partial** — the move is blocked, but sold units still show in the register |
| d | No direct moves; save routes to a requisition slip and the approval chain | Done — the slip lives inline on the Stock Movement page rather than as its own tab |

## 6. Inventory & Cycle Counting

| # | Requirement | Status |
|---|---|---|
| a | Print count sheet shows a white screen | Done — fixed |
| b | Mobile: select count form, scan, count, auto-posts to the sheet | Done |
| c | On submit, chain of Dept Manager → Dept Head → Finance | **Not built** — submit goes straight to a single approve step |
| d | Only Finance can override a discrepancy, with remarks | Done |
| + | Item code fills in its own description from the master | Done (R23) |
| + | Count rows editable and removable while the sheet is open | Done (R21) |
| + | Count sheet CSV upload with a template | Done (R22) |
| + | An open count sheet can be removed | Done (R23) |
| + | Phone tile launcher for the count | Done (R23) |

## 7. Order Management

| # | Requirement | Status |
|---|---|---|
| a | Remove order value | Done |
| b | Sales does not handle serials | Done |
| b | Customer "add new" drop-card; per-day rate; contract uploader | Done — the uploader sits after Delivery Address, not beside Contract End |
| c | Generate an SOA, editable to cover selected months | **Not built** |
| d | Draft editable; only Finance overrides | Done |
| e | Fix card alignment (qty) | **Not built** |
| f | Remove or hide Order Approval and Order Controls | **Not built** — both tabs are still live |

## 8. Outbound Logistics

| # | Requirement | Status |
|---|---|---|
| a | A sales order with a requisition disappears from the list | Done |
| b | Pre-release required on every requisition | **Partial** — only enforced for motorcycles; every other category skips it |
| c | Goods Issue cards clickable to update movement | Done |
| d | Draft delivery/return editable and voidable | Done |
| e | Posted return emails you and the department head | **Not built** — no notification is sent |

## 9. Service Management

**This module was rebuilt.** The screenshots in the document show the old generic
shell (Service Center / Service Jobs / Work Approval / Service Analytics / Service
Controls). The current build replaces that with a five-step strip: **Job Order →
Assembly Card → Estimate & Markup → Completion → Excess Return.** Your Finance role
has full rights to all of it.

| # | Requirement | Status |
|---|---|---|
| a | Upload files related to after-sales work | Done |
| b | Assembly card selects items from inventory; selected items leave inventory | Done — the serial is moved to `IN_SERVICE` through the stock ledger, so it is auditable and cannot be picked onto a second job |
| c | Auto-compute estimated job cost plus markup % into revenue | Done — material, labour and markup |
| d | Printable Job Order ticket | Done |
| e | On completion, final cost posted from actual items used | Done |
| f | Excess parts returned to inventory and made available | Done |

If it looks empty, that is because there are no job orders yet — every counter reads
zero on a live system with no data. Open **New Job Order** to start one.

## 10. Interface

| # | Requirement | Status |
|---|---|---|
| — | Works on computers and on Android / iOS | **Partial** — the phone tile launcher shipped for Inventory in R23; the other modules still open the desktop rail on a handset |
| — | KPI cards and reports in the Ramco style: status tiles, donut / bar / line charts, pending-approval and trend panels | **Not built** — the cards exist and are clickable, but there are no charts anywhere in the system |

---

## What I would do next, in order

1. **Finish the count** — everything the physical count needs is live now.
2. **The three silent gaps**, because each one lets a control be skipped without
   anyone noticing: PO attachment enforced only in the browser, pre-release skipped
   for non-motorcycles, and goods-receipt discrepancies resolvable by anyone.
3. **The missing approval chains** — cycle count (Dept Manager → Dept Head → Finance)
   and PO → auto-create RFP. These are the two places where the document describes a
   flow the system does not yet complete.
4. **The visible gaps** — Reports unreachable, Order Approval / Order Controls still
   showing, SOA generation, return-posted notification.
5. **The interface pass** — charts and status tiles across the modules, and the phone
   launcher extended past Inventory.
