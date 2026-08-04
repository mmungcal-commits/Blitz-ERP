-- Reassign demo RFP requestors so they differ from the finance/CEO approvers.
-- The system enforces segregation of duties (a requester cannot approve their own
-- request). The demo RFPs were seeded with mmungcal@nrdev.ph as requestor, which is
-- also the finance approver / typical demo login, so the approval chain could not be
-- walked. Give each RFP a realistic department requestor instead.
UPDATE erp_payment_requests SET requestor_email='raymond.ops@nrdev.ph'
  WHERE request_no IN ('RFP00000001','RFP00000002','RFP00000004') AND requestor_email='mmungcal@nrdev.ph';
UPDATE erp_payment_requests SET requestor_email='grace.logistics@nrdev.ph'
  WHERE request_no='RFP00000003' AND requestor_email='mmungcal@nrdev.ph';
