# E88 FinSys v7.1 Go-Live Checklist

## Backup and environment

- [ ] Current Worker deployment retained for rollback
- [ ] Current D1 database exported
- [ ] New D1 database created for v7.1
- [ ] R2 document bucket configured
- [ ] Cloudflare Access permits only authorized `@nrdev.ph` users
- [ ] Admin account `mmungcal@nrdev.ph` can sign in

## Opening data

- [ ] 14 source workbooks shown in Opening Data Control
- [ ] 8,650 canonical assets loaded
- [ ] 6,697 serial exceptions visible for review
- [ ] Duplicate canonical serial count remains zero
- [ ] 28 shipments and 2,015 expected assets loaded
- [ ] 5,807 stock movements loaded
- [ ] Sales/lease, delivery, return, procurement, budget, and planning counts agree with the reports

## Critical process tests

- [ ] Upload one new ATLAS workbook and preview exceptions
- [ ] Post ATLAS and confirm automatic shipment creation
- [ ] Receive a matching QR serial against the shipment
- [ ] Receive an unplanned or duplicate serial and confirm quarantine/exception
- [ ] Create a new item description and confirm automatic item code
- [ ] Transfer a motorcycle to another location
- [ ] Assign a unit to a customer
- [ ] Assign a unit to an employee or pilot test
- [ ] Create requisition and pre-release checklist
- [ ] Release a delivery and confirm the same serial is updated
- [ ] Record a return with matching serial
- [ ] Record a returned battery with a different serial and confirm `BATTERY_SWAP` / `UNRECONCILED`
- [ ] Resolve a reconciliation case through authorized approval
- [ ] Confirm unavailable/quarantined serials cannot be assigned or delivered
- [ ] Confirm blocked customers cannot receive new commercial transactions without authorized override

## Security and concurrency

- [ ] Staff permissions tested by module/action
- [ ] Unauthorized module/API requests return 403
- [ ] Two users attempting the same serial cannot both post
- [ ] Audit log records user, action, date, and record
- [ ] Mobile Android and iOS transaction screens tested

## Final approval

- [ ] Supply Chain opening balances approved
- [ ] Commercial assignments approved
- [ ] Finance procurement/budget records approved
- [ ] Unreconciled serial exception owner assigned
- [ ] Management approves production cutover
