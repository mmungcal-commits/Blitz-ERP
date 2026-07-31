# E88 Enterprise System v13.0 Go-Live Checklist

## Governance and sign-off

- [ ] Executive sponsor, Finance, SCM, Sales, HR, Operations, IT, and process owners approve rollout scope.
- [ ] UAT scenarios are completed with no unresolved critical/high defects.
- [ ] Cutover owner, rollback owner, and support escalation contacts are assigned.
- [ ] Production change window and user communication are approved.

## Infrastructure and security

- [ ] Production D1 database ID and Worker environment are confirmed.
- [ ] R2 bucket `e88-erp-documents` is created and bound as `DOCS`.
- [ ] Cloudflare Access restricts the application to authorized users.
- [ ] Secrets, tokens, and provider credentials are stored outside source control.
- [ ] Named users, roles, departments, and segregation-of-duties conflicts are reviewed.

## Data and Finance

- [ ] Legal entities, chart of accounts, tax codes, banks, departments, locations, warehouses, items, customers, suppliers, and employees are approved.
- [ ] Opening inventory, AR, AP, cash, fixed assets, equity, and retained earnings reconcile to approved cutover balances.
- [ ] Inventory and fixed-asset subledgers reconcile to the GL.
- [ ] Accounting periods, numbering, approval matrices, and monetary limits are approved.
- [ ] Historical valuation exceptions are assigned and cost-dependent transactions remain blocked until approved.
- [ ] Philippine payroll and statutory configuration is reviewed by HR/Payroll/Tax owners.

## Process readiness

- [ ] Procure-to-pay, order-to-cash, lease, returns, inventory custody, fixed assets, and bank reconciliation pass UAT.
- [ ] Manufacturing, Quality, Projects, EAM, Facilities, Logistics, HCM, and SRP process owners sign off their scenarios.
- [ ] External eSignature, device, SOA/collaboration, and optimization connections are configured and tested where required.
- [ ] User manuals, support process, and training attendance are completed.

## Deployment

- [ ] Current Worker and D1 database are backed up.
- [ ] Migration `0021` is applied exactly once to an existing v12 database.
- [ ] `npm run build` passes.
- [ ] Deployment guard passes and the Worker deploys successfully.
- [ ] `/api/health` reports version `13.0.0` and rollout specialist build mode.
- [ ] Live smoke test passes for login, document upload, transaction posting, approval, report, and audit history.

## Go-live authorization

- [ ] Finance sign-off
- [ ] Operations/SCM sign-off
- [ ] Sales/Commercial sign-off
- [ ] HR sign-off
- [ ] IT/Security sign-off
- [ ] Executive sponsor approval
