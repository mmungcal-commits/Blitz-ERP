# Blitz - ERP — status against IMPROVE_ERP.docx

Re-audited against the live code on 7 Aug 2026, build `BLITZ-ERP-20260807-R32.0`.
Every line was checked in the source, not assumed.

**Short answer: no, not everything. 38 of 45 points are done. Seven are not.**

---

## Closed since the first audit today

| Point | What changed |
|---|---|
| 3c | Instructional notes stripped from every module — 13 rail panels, 8 loose notes, 6 in-form notes |
| 3h | PO attachment enforced by the API, not only the browser |
| 5c | Receiving discrepancies: Finance clears, a *different* department head acknowledges |
| 6c | Cycle count runs Dept Manager → Dept Head → Finance; only Finance posts |
| 8b | Pre-release required on **every** category, not just motorcycles |
| 8e | A posted goods return emails Finance and the department heads |
| 2 | Reports is back in the inventory group — it was being deleted at runtime by a hidden-modules list |
| 7f | Order Approval and Order Controls are off the rail |
| 1a | Logo lettering actually white; a global rule was forcing *every* logo in the app to 48px |
| 10 | Charts on four screens, sign-in rebuilt, landing dashboard added |
| — | Activation links are now **emailed**. They never were — `admin.js` had no mailer at all |

## Still not built — the seven

| # | Requirement | Why it is open |
|---|---|---|
| 3a | PO row editable when DRAFT | No edit route, no edit control. Needs `PATCH /purchase-orders/:id` and a form |
| 3j | Full PO approval auto-creates the RFP | Approval only emails to say one *can* be raised. Nothing creates it |
| 5b | QR scanning on **Unit Visibility** | Scanning exists in Stock Movement and QR Trace, not on the visibility screen |
| 5a | Class KPI cards drill into their data | The per-class cards render with no click handler |
| 7c | Generate an SOA, editable by month | Nothing exists — no route, no UI |
| 7e | Card alignment on the sales screens | The Lines column is not right-aligned like the other numerics |
| 10 | Mobile beyond Inventory | Only Cycle Counting and Warehouse have phone tiles; nine groups still open the desktop rail |

## Partly done

- **Charts** cover the landing dashboard, Cycle Counting, Warehouse and Service.
  Inbound, Outbound, Procurement, Order Management and the generic module screens
  still show the old flat cards.
- **Sold units** are excluded from every listing and cannot move. Worth confirming
  that is what "no longer seen in the system" meant.

## One thing to confirm rather than fix

`openSalesOrderForm` creates a sales order with **no line items** — the submit sets
`lines=[]`, and the line builder it would use is unreachable dead code.

That looks like a bug, but it may be correct: your document says *"the sales has no
ruling of serials as this will be the function of the supply chain in the outbound
logistics."* A sales order here is rate-based — customer, per-day rate, contract
dates — and serials attach later in the outbound requisition.

If that is the intent, the fix is to delete the dead builder. If a sales order should
carry item lines, that is a real gap. **Tell me which** — I did not want to guess on
something that changes how sales works.

---

## Not in the document, but you should know

- **Six of eight accounts are still not activated.** Needs your login: System
  Administration → User Access → send the links. The email path works now.
- The Apps Script mail handshake has never been proven end to end. The first
  activation you send proves it either way — the dialog now reports whether the
  send actually left.
