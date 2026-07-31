# E88 Enterprise System v13.0 Administrator Guide

## Required administrative setup

1. Create named users and assign the minimum necessary roles.
2. Maintain departments, entities, locations, warehouses, document sequences, periods, and tax settings.
3. Review the default approval matrix and create narrower module/document/department rules where required.
4. Do not assign a user incompatible requester and final-approver responsibilities without an approved exception.
5. Configure provider endpoints only through secure environment variables or platform secrets.
6. Monitor pending approvals, integration failures, valuation exceptions, unreconciled serials, overdue returns, and failed postings.
7. Close accounting periods only after subledger reconciliation and reopen them only through authorized administration.
8. Correct posted transactions through reversal and replacement; never delete database history.

## Approval matrix defaults

- Up to 100,000: SCM_MANAGER
- 100,000.01 to 1,000,000: FINANCE
- Above 1,000,000: ADMIN

These are software defaults only. E88 management must approve the production limits and any module-specific override.

## Daily control reports

- Pending workflow approvals
- Inventory valuation exceptions
- Serial/custody mismatches
- Delivery and return obligations
- GRNI and unmatched supplier invoices
- AR/AP aging and unapplied cash
- Integration run failures
- Journal posting and reversal exceptions

## Backup and recovery

Export D1 before every production migration and retain the previous Worker deployment. Test restoration into a separate D1 database at least once before go-live.
