# E88 — Live Data Findings & Corrections (from your production backup)

I loaded your real production database (8,650 assets, 373 customers, 264 sales orders) and
checked it end to end. Here is the honest state and what to correct.

## Healthy on your live system
- **Trial balance balances**: Dr = Cr = ₱131,486,069.
- **Real master data intact**: 373 customers, 17 vendors, 761 items, 566 locations, 63 accounts.
- **Real activity**: 264 posted sales orders, 101 deliveries completed, 42 returns.

## Correction 1 — Operating bank account (FIX READY)
Your live system had **zero bank accounts**, which blocks vendor payments (P2P) from
completing. Fix provided: `0028_operational_setup.sql` seeds a BDO operating account linked
to GL 1010. Apply it, OR add it in the app: Finance → Bank Accounts → add "BDO Operating",
GL account 1010. (Idempotent — safe.)

## Correction 2 — Second approver user (YOUR 2-MINUTE ACTION)
You have **only 1 user (admin)**. Every workflow with maker-checker (journals, POs, payments)
needs a *different* approver, so with one user those flows are blocked. 
Do this in the app: Admin → Users → create a second user (e.g. a Finance approver) with an
approver/finance role. I did not script this because passwords must be set through the app's
proper login flow, not raw SQL.

## The big one — Inventory reconciliation (NEEDS YOUR DECISION, not a blind fix)
Your inventory GL is **off from the subledger by ~₱27M** (MC ₱4.9M, BAT ₱18.8M, BSS ₱3.4M).
I found exactly why, and it is **not** something I should auto-post:

- Your GL was set by an opening journal literally titled *"Controlled **provisional**
  valuation of opening serialized inventory."* Implied cost per unit in the GL is
  **MC ₱3,861, BAT ₱27,607, BSS ₱37,141**.
- True landed cost is **₱33k–65k** per motorcycle. So your GL is at a *provisional,
  understated* basis — not landed cost.
- **5,446 assets have no cost at all** (unit_cost = 0), which is why the subledger
  under-counts the GL.

Why I will not just "post a journal to fix it": if I valued those 5,446 units at landed
cost, the subledger would jump to **₱100M+** and overshoot the ₱66M GL — making it worse.
And your asset `status` field is full of free-text (OKLA_CHINA, UNDER_REPAIR, donation
notes), so the true on-hand population itself needs cleanup first. Posting the wrong
multi-million journal to your live books would harm you, not help.

### The correct path (I will build each step with you)
1. **You give me the real landed costs** (actual FX + freight + duty per SKU). This replaces
   the provisional basis.
2. I generate a **controlled revaluation**: re-value on-hand inventory (subledger) AND
   restate the GL opening balance to true landed cost, per class — one reviewable journal.
3. **Your controller signs off** (it is an opening-balance restatement — a finance decision).
4. I apply it; every class then reconciles at ₱0.

## Data-cleanup backlog (real, but not blocking books)
- **5,566 open inventory valuation exceptions** and **6,697 open serial exceptions** — mostly
  the unvalued units above and non-standard statuses. These clear as part of step 2–4.

## Bottom line
Your books balance and your real data is intact and in use. Two quick operational fixes
(bank account, second user) unblock payments and approvals. The ₱27M reconciliation is a
provisional-valuation restatement that needs your real costs and your controller's sign-off —
I've laid out the exact path and I'll build the revaluation the moment you send the numbers.
