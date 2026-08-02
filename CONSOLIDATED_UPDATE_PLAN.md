# E88 — Consolidated Update Plan (everything your system needs)

Built from your live production backup. Each item marked with its true status.

## ✅ ALREADY LIVE (deployed, verified in your repo)
- ATLAS expected-shipment import fix
- Landed cost applied at goods receipt (+ GL posting)
- Per-class inventory reconciliation (no cross-class netting)
- Battery sales/lease fix (all-numeric barcodes now resolve)
- Analytics module: reports catalog (per-report date modes) + date-range KPIs
- Your r36/r37 Stock Analysis fix (preserved)

## 🟢 READY TO APPLY — safe, I built it
1. **Operating bank account** (`0028_operational_setup.sql`) — you had none, which blocks
   vendor payments. Apply via `wrangler d1 execute DB --remote --file=...`, or add in
   Finance → Bank Accounts (GL 1010). Idempotent.

## 🟡 YOUR QUICK IN-APP ACTIONS (minutes, no code)
2. **Create a 2nd approver user** — you have only 1 user, so maker-checker (journals, POs,
   payments) is blocked. Admin → Users → add a Finance approver. (Passwords must be set via
   the app's login flow — not scriptable safely.)

## 🔴 NEEDS A FINANCE DECISION — I've teed it up, cannot post for you
3. **Inventory valuation restatement (the ~₱27M reconciliation).**
   Your GL was set by a *"Controlled provisional valuation"* that is inconsistent with
   asset-level costs, differently per class:
   - MC: subledger ₱17.5M already EXCEEDS GL ₱12.0M
   - BAT: GL ₱45.2M vs subledger ₱32.5M, only 80 unvalued units (gap not explainable)
   - BSS: GL ₱9.2M vs subledger ₱5.8M
   There is no mechanical rule that fixes all three — your controller must set the basis:
   - **Option A — restate GL to true landed cost** (correct costs; a formal opening-balance
     restatement). Needs your real FX + freight + duty per SKU.
   - **Option B — value subledger to the existing provisional GL** (no GL change; keeps
     understated costs; note MC already exceeds GL so needs a write-down there).
   **What I need from you to build the journal:** the chosen option, and for Option A the
   real landed costs. Then I generate one reviewable revaluation journal per class, you sign
   off, and every class reconciles at ₱0.

## 🟠 DATA CLEANUP BACKLOG (real, follows from item 3)
4. **5,446 unvalued assets**, **5,566 open valuation exceptions**, **6,697 serial
   exceptions**, and messy free-text `status` values (OKLA_CHINA, UNDER_REPAIR, donation
   notes). These get resolved as part of the valuation basis decision + a status cleanup pass.

## ⚪ OPTIONAL NEXT — module UAT with your real data
5. Drive these end-to-end with you: lease billing (your swap business), returns/RMA,
   depreciation runs, period close, bank reconciliation. Code exists; needs UAT with real data.

---

### The ONE thing that unlocks the most
Item 3 is the heart of it. Send me your **real FX, freight, and duty per product** (from your
OKLA/AMPACE/YUNKU commercial invoices + the customs/brokerage documents), tell me Option A or
B, and I will build the revaluation. That single decision closes the ₱27M and clears most of
the exception backlog.
