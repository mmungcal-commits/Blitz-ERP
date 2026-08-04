-- E88 Enterprise System - Demo data seed
-- Idempotent (INSERT OR IGNORE keyed on business keys). Safe to re-run.
-- Populates partners, items, locations, serialized assets, balanced POSTED
-- journals (Trial Balance / P&L), AP subledger, RFP payment requests,
-- sales orders, deliveries and stock-ledger movements so every end report
-- and process shows realistic demo activity.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounting period for current month (needed by finance postings)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_accounting_periods(
  entity_id,fiscal_year,period_no,period_name,start_date,end_date,status
)
SELECT e.id, 2026, m.period_no,
       printf('2026-%02d', m.period_no),
       printf('2026-%02d-01', m.period_no),
       date(printf('2026-%02d-01', m.period_no),'+1 month','-1 day'),
       'OPEN'
FROM erp_legal_entities e
CROSS JOIN (
  SELECT 1 period_no UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
  UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8
) m
WHERE e.entity_code='E88';

-- ---------------------------------------------------------------------------
-- Partners (vendors + customers)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_partners(partner_code,partner_type,name,address,email,phone,credit_status,source_system) VALUES
('V-AMPACE','VENDOR','Ampace Technology Ltd.','Xiamen, Fujian, China','sales@ampace.com','+86 592 000 1111','CLEAR','DEMO'),
('V-NIU','VENDOR','NIU Technologies','Changzhou, Jiangsu, China','supply@niu.com','+86 519 000 2222','CLEAR','DEMO'),
('V-LOGI','VENDOR','FastFreight Logistics Inc.','Paranaque City, Metro Manila','ops@fastfreight.ph','+63 2 8555 3333','CLEAR','DEMO'),
('C-RIDEBOX','CUSTOMER','RideBox Mobility Corp.','BGC, Taguig City','fleet@ridebox.ph','+63 2 8777 4444','CLEAR','DEMO'),
('C-GRABEXP','CUSTOMER','Grab Express Riders Coop','Quezon City, Metro Manila','coop@grabexp.ph','+63 2 8666 5555','CLEAR','DEMO'),
('C-JUANHAUL','CUSTOMER','JuanHaul Delivery Services','Pasig City, Metro Manila','admin@juanhaul.ph','+63 2 8444 6666','CLEAR','DEMO');

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_locations(code,name,location_type,address,active) VALUES
('WH-MAIN','Main Warehouse - Pasig','WAREHOUSE','15 Brixton St., Kapitolyo, Pasig City',1),
('WH-CAVITE','Cavite Distribution Hub','WAREHOUSE','Dasmarinas, Cavite',1),
('BSS-QC','RideBox Swap Station - QC','STATION','Commonwealth Ave., Quezon City',1);

-- ---------------------------------------------------------------------------
-- Items (item master)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_items(item_code,item_name,normalized_name,category,subcategory,manufacturer,model,serialized,base_uom,standard_cost,source_system) VALUES
('MC000001','E88 Explorer E-Motorcycle','e88 explorer e-motorcycle','MC','MOTORCYCLE','E88','Explorer',1,'EA',82000,'DEMO'),
('MC000002','E88 Ranger E-Motorcycle','e88 ranger e-motorcycle','MC','MOTORCYCLE','E88','Ranger',1,'EA',96000,'DEMO'),
('BAT000001','Ampace 72V 45Ah Battery Pack','ampace 72v 45ah battery pack','BAT','BATTERY','Ampace','AP-72-45',1,'EA',38000,'DEMO'),
('BSS000001','RideBox Swap Cabinet 8-Slot','ridebox swap cabinet 8-slot','BSS','SWAP_STATION','E88','RB-8',1,'EA',420000,'DEMO'),
('SP000001','Brake Pad Set','brake pad set','SP','SPARE_PART','E88','BP-STD',0,'EA',450,'DEMO'),
('CHG000001','Portable Charger 72V','portable charger 72v','CHG','CHARGER','E88','PC-72',0,'EA',3800,'DEMO');

-- ---------------------------------------------------------------------------
-- Serialized assets (inventory subledger)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_assets(asset_no,serial_no,serial_type,item_id,item_code,item_name,category,current_location_id,current_location_code,current_status,unit_cost,landed_cost,condition_code,reconciliation_status,source_system)
SELECT v.asset_no,v.serial_no,v.serial_type,i.id,v.item_code,i.item_name,v.category,
       l.id,v.loc_code,v.status,v.unit_cost,v.unit_cost,'GOOD','CLEAR','DEMO'
FROM (
  SELECT 'AST00000101' asset_no,'E88EXP2026A001' serial_no,'MOTORCYCLE' serial_type,'MC000001' item_code,'MC' category,'WH-MAIN' loc_code,'AVAILABLE' status,82000 unit_cost
  UNION ALL SELECT 'AST00000102','E88EXP2026A002','MOTORCYCLE','MC000001','MC','WH-MAIN','AVAILABLE',82000
  UNION ALL SELECT 'AST00000103','E88EXP2026A003','MOTORCYCLE','MC000001','MC','WH-MAIN','AVAILABLE',82000
  UNION ALL SELECT 'AST00000104','E88EXP2026A004','MOTORCYCLE','MC000001','MC','WH-CAVITE','LEASED',82000
  UNION ALL SELECT 'AST00000105','E88EXP2026A005','MOTORCYCLE','MC000001','MC','WH-CAVITE','LEASED',82000
  UNION ALL SELECT 'AST00000201','E88RNG2026B001','MOTORCYCLE','MC000002','MC','WH-MAIN','AVAILABLE',96000
  UNION ALL SELECT 'AST00000202','E88RNG2026B002','MOTORCYCLE','MC000002','MC','WH-MAIN','AVAILABLE',96000
  UNION ALL SELECT 'AST00000203','E88RNG2026B003','MOTORCYCLE','MC000002','MC','WH-CAVITE','SOLD',96000
  UNION ALL SELECT 'AST00000301','AMP72452026C001','BATTERY','BAT000001','BAT','WH-MAIN','AVAILABLE',38000
  UNION ALL SELECT 'AST00000302','AMP72452026C002','BATTERY','BAT000001','BAT','WH-MAIN','AVAILABLE',38000
  UNION ALL SELECT 'AST00000303','AMP72452026C003','BATTERY','BAT000001','BAT','BSS-QC','DEPLOYED',38000
  UNION ALL SELECT 'AST00000304','AMP72452026C004','BATTERY','BAT000001','BAT','BSS-QC','DEPLOYED',38000
  UNION ALL SELECT 'AST00000401','RB8CAB2026D001','SWAP_STATION','BSS000001','BSS','BSS-QC','DEPLOYED',420000
) v
JOIN erp_items i ON i.item_code=v.item_code
LEFT JOIN erp_locations l ON l.code=v.loc_code;

-- ---------------------------------------------------------------------------
-- Balanced POSTED journals (drive Trial Balance, P&L, GL)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_journal_headers(journal_no,entity_id,journal_date,journal_type,source_module,source_type,source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at)
SELECT v.journal_no,e.id,v.jdate,'GENERAL','DEMO','DEMO_SEED',v.journal_no,'DEMO_'||v.journal_no,v.descr,'PHP',1,v.amt,v.amt,'POSTED','demo-seed','demo-seed',v.jdate,'demo-seed',v.jdate,'demo-seed',v.jdate
FROM (
  SELECT 'JE-DEMO-01' journal_no,'2026-01-05' jdate,8000000 amt,'Capital injection - shareholder funding' descr
  UNION ALL SELECT 'JE-DEMO-02','2026-01-10',4700000,'Opening inventory purchase on credit'
  UNION ALL SELECT 'JE-DEMO-03','2026-02-01',2000000,'Partial payment to supplier'
  UNION ALL SELECT 'JE-DEMO-04','2026-03-15',1120000,'Motorcycle sale invoice'
  UNION ALL SELECT 'JE-DEMO-05','2026-03-15',700000,'Cost of motorcycles sold'
  UNION ALL SELECT 'JE-DEMO-06','2026-04-02',1120000,'Customer receipt'
  UNION ALL SELECT 'JE-DEMO-07','2026-04-30',336000,'Lease revenue billing'
  UNION ALL SELECT 'JE-DEMO-08','2026-05-31',224000,'Energy and battery-swap revenue'
  UNION ALL SELECT 'JE-DEMO-09','2026-05-05',168000,'Warehouse rent - supplier bill'
  UNION ALL SELECT 'JE-DEMO-10','2026-06-15',500000,'Payroll for period'
  UNION ALL SELECT 'JE-DEMO-11','2026-06-20',50400,'Utilities payment'
  UNION ALL SELECT 'JE-DEMO-12','2026-06-30',80000,'Monthly depreciation'
) v
CROSS JOIN erp_legal_entities e
WHERE e.entity_code='E88';

-- Journal lines
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit)
SELECT h.id,v.line_no,a.id,v.descr,v.debit,v.credit,v.debit,v.credit
FROM (
  -- JE-DEMO-01 Capital injection
  SELECT 'JE-DEMO-01' jn,1 line_no,'1010' acct,'Operating bank funding' descr,8000000 debit,0 credit
  UNION ALL SELECT 'JE-DEMO-01',2,'3000','Share capital',0,8000000
  -- JE-DEMO-02 Opening inventory
  UNION ALL SELECT 'JE-DEMO-02',1,'1200','Motorcycles and parts inventory',3500000,0
  UNION ALL SELECT 'JE-DEMO-02',2,'1220','Batteries and BSS inventory',1200000,0
  UNION ALL SELECT 'JE-DEMO-02',3,'2000','Accounts payable - suppliers',0,4700000
  -- JE-DEMO-03 Supplier partial payment
  UNION ALL SELECT 'JE-DEMO-03',1,'2000','Accounts payable settled',2000000,0
  UNION ALL SELECT 'JE-DEMO-03',2,'1010','Bank disbursement',0,2000000
  -- JE-DEMO-04 Motorcycle sale
  UNION ALL SELECT 'JE-DEMO-04',1,'1100','Accounts receivable',1120000,0
  UNION ALL SELECT 'JE-DEMO-04',2,'4000','Motorcycle sales revenue',0,1000000
  UNION ALL SELECT 'JE-DEMO-04',3,'2100','Output VAT',0,120000
  -- JE-DEMO-05 COGS
  UNION ALL SELECT 'JE-DEMO-05',1,'5000','Cost of motorcycles sold',700000,0
  UNION ALL SELECT 'JE-DEMO-05',2,'1200','Inventory relief',0,700000
  -- JE-DEMO-06 Customer receipt
  UNION ALL SELECT 'JE-DEMO-06',1,'1010','Bank collection',1120000,0
  UNION ALL SELECT 'JE-DEMO-06',2,'1100','Receivable settled',0,1120000
  -- JE-DEMO-07 Lease revenue
  UNION ALL SELECT 'JE-DEMO-07',1,'1100','Lease receivable',336000,0
  UNION ALL SELECT 'JE-DEMO-07',2,'4010','Lease revenue',0,300000
  UNION ALL SELECT 'JE-DEMO-07',3,'2100','Output VAT',0,36000
  -- JE-DEMO-08 Energy revenue
  UNION ALL SELECT 'JE-DEMO-08',1,'1010','Cash from swaps',224000,0
  UNION ALL SELECT 'JE-DEMO-08',2,'4020','Energy and battery swap revenue',0,200000
  UNION ALL SELECT 'JE-DEMO-08',3,'2100','Output VAT',0,24000
  -- JE-DEMO-09 Rent supplier bill (EWT 5%)
  UNION ALL SELECT 'JE-DEMO-09',1,'6100','Warehouse rent',150000,0
  UNION ALL SELECT 'JE-DEMO-09',2,'1150','Input VAT',18000,0
  UNION ALL SELECT 'JE-DEMO-09',3,'2110','Expanded withholding tax payable',0,7500
  UNION ALL SELECT 'JE-DEMO-09',4,'2000','Accounts payable - landlord',0,160500
  -- JE-DEMO-10 Payroll
  UNION ALL SELECT 'JE-DEMO-10',1,'6000','Payroll and benefits',500000,0
  UNION ALL SELECT 'JE-DEMO-10',2,'2120','Withholding tax on compensation',0,40000
  UNION ALL SELECT 'JE-DEMO-10',3,'1010','Net pay disbursed',0,460000
  -- JE-DEMO-11 Utilities
  UNION ALL SELECT 'JE-DEMO-11',1,'6200','Utilities and communications',45000,0
  UNION ALL SELECT 'JE-DEMO-11',2,'1150','Input VAT',5400,0
  UNION ALL SELECT 'JE-DEMO-11',3,'1010','Bank payment',0,50400
  -- JE-DEMO-12 Depreciation
  UNION ALL SELECT 'JE-DEMO-12',1,'6800','Depreciation expense',80000,0
  UNION ALL SELECT 'JE-DEMO-12',2,'1390','Accumulated depreciation',0,80000
) v
JOIN erp_journal_headers h ON h.journal_no=v.jn
JOIN erp_chart_accounts a ON a.account_code=v.acct;

-- ---------------------------------------------------------------------------
-- AP subledger documents (drive AP aging report)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_subledger_documents(document_no,entity_id,document_type,partner_id,document_date,due_date,currency,gross_amount,net_amount,vat_amount,withholding_amount,open_balance,status,created_by,posted_by,posted_at)
SELECT v.document_no,e.id,'SUPPLIER_BILL',p.id,v.doc_date,v.due_date,'PHP',v.gross,v.net,v.vat,v.wht,v.open_bal,'POSTED','demo-seed','demo-seed',v.doc_date
FROM (
  SELECT 'AP00000001' document_no,'V-AMPACE' pcode,'2026-05-05' doc_date,'2026-06-04' due_date,168000 gross,150000 net,18000 vat,7500 wht,160500 open_bal
  UNION ALL SELECT 'AP00000002','V-NIU','2026-06-18','2026-07-18',560000,500000,60000,0,560000
  UNION ALL SELECT 'AP00000003','V-LOGI','2026-07-01','2026-07-31',89600,80000,9600,0,89600
  UNION ALL SELECT 'AP00000004','V-AMPACE','2026-07-20','2026-08-19',2700000,2700000,0,0,2700000
) v
JOIN erp_partners p ON p.partner_code=v.pcode
CROSS JOIN erp_legal_entities e
WHERE e.entity_code='E88';

-- ---------------------------------------------------------------------------
-- Payment requests (RFP worklist, various stages)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_payment_requests(request_no,entity_id,request_date,requestor_email,payee_partner_id,payee_name,department,cost_center,purpose,request_type,supplier_invoice_no,invoice_date,gross_amount,vat_amount,withholding_amount,net_payable,due_date,payment_method,status,department_approved_by,department_approved_at,finance_validated_by,finance_validated_at,final_approved_by,final_approved_at,paid_by,paid_at,payment_reference)
SELECT v.request_no,e.id,v.req_date,v.requestor,p.id,pr.name,v.dept,v.cc,v.purpose,v.rtype,v.inv_no,v.inv_date,v.gross,v.vat,v.wht,v.net,v.due,v.method,v.status,
       v.dept_by,v.dept_at,v.fin_by,v.fin_at,v.fap_by,v.fap_at,v.paid_by,v.paid_at,v.pay_ref
FROM (
  SELECT 'RFP00000001' request_no,'2026-07-02' req_date,'mmungcal@nrdev.ph' requestor,'V-AMPACE' pcode,'Supply Chain' dept,'SCM-01' cc,'Payment for battery pack shipment' purpose,'SUPPLIER_PAYMENT' rtype,'AMP-INV-2201' inv_no,'2026-05-05' inv_date,168000 gross,18000 vat,7500 wht,160500 net,'2026-08-04' due,'BANK_TRANSFER' method,'SUBMITTED' status,NULL dept_by,NULL dept_at,NULL fin_by,NULL fin_at,NULL fap_by,NULL fap_at,NULL paid_by,NULL paid_at,NULL pay_ref
  UNION ALL SELECT 'RFP00000002','2026-07-10','mmungcal@nrdev.ph','V-NIU','Supply Chain','SCM-01','Payment for motorcycle units','SUPPLIER_PAYMENT','NIU-INV-8890','2026-06-18',560000,60000,0,560000,'2026-08-10','BANK_TRANSFER','DEPARTMENT_APPROVED','Samuel Kniazeff Jr','2026-07-11',NULL,NULL,NULL,NULL,NULL,NULL,NULL
  UNION ALL SELECT 'RFP00000003','2026-07-15','mmungcal@nrdev.ph','V-LOGI','Logistics','LOG-02','Freight and delivery services','SUPPLIER_PAYMENT','FF-INV-4471','2026-07-01',89600,9600,0,89600,'2026-08-14','BANK_TRANSFER','FINANCE_VALIDATED','Samuel Kniazeff Jr','2026-07-16','Mark Alexis Mungcal','2026-07-18',NULL,NULL,NULL,NULL,NULL
  UNION ALL SELECT 'RFP00000004','2026-06-20','mmungcal@nrdev.ph','V-AMPACE','Supply Chain','SCM-01','Advance payment for Q3 order','SUPPLIER_PAYMENT','AMP-INV-2150','2026-06-15',2700000,0,0,2700000,'2026-07-20','BANK_TRANSFER','PAID','Samuel Kniazeff Jr','2026-06-21','Mark Alexis Mungcal','2026-06-23','Francis Ryan Simsim','2026-06-24','mmungcal@nrdev.ph','2026-06-25','BT-2026-0091'
) v
JOIN erp_partners p ON p.partner_code=v.pcode
JOIN erp_partners pr ON pr.partner_code=v.pcode
CROSS JOIN erp_legal_entities e
WHERE e.entity_code='E88';

-- ---------------------------------------------------------------------------
-- Sales orders + lines
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_sales_orders(sales_order_no,transaction_type,customer_id,order_date,contract_start,contract_end,status,gross_amount,delivery_address,source_system,created_by,posted_by,posted_at)
SELECT v.so_no,v.ttype,c.id,v.odate,v.cstart,v.cend,v.status,v.gross,v.addr,'DEMO','demo-seed','demo-seed',v.odate
FROM (
  SELECT 'SO000001' so_no,'SALE' ttype,'C-JUANHAUL' ccode,'2026-03-15' odate,NULL cstart,NULL cend,'POSTED' status,1120000 gross,'Pasig City, Metro Manila' addr
  UNION ALL SELECT 'SO000002','LEASE','C-RIDEBOX','2026-04-01','2026-04-01','2027-03-31','POSTED',336000,'BGC, Taguig City'
  UNION ALL SELECT 'SO000003','SALE','C-GRABEXP','2026-07-28',NULL,NULL,'DRAFT',192000,'Quezon City, Metro Manila'
) v
JOIN erp_partners c ON c.partner_code=v.ccode;

INSERT OR IGNORE INTO erp_sales_lines(sales_order_id,line_no,item_id,item_code,description,qty,unit_price,serial_no,line_role)
SELECT s.id,v.line_no,i.id,v.item_code,i.item_name,v.qty,v.price,v.serial_no,v.role
FROM (
  SELECT 'SO000001' so,1 line_no,'MC000002' item_code,1 qty,1000000 price,'E88RNG2026B003' serial_no,'PRIMARY' role
  UNION ALL SELECT 'SO000002',1,'MC000001',2,150000,'E88EXP2026A004','PRIMARY'
  UNION ALL SELECT 'SO000003',1,'MC000002',2,96000,NULL,'PRIMARY'
) v
JOIN erp_sales_orders s ON s.sales_order_no=v.so
JOIN erp_items i ON i.item_code=v.item_code;

-- ---------------------------------------------------------------------------
-- Deliveries + delivery assets
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_deliveries(delivery_no,sales_order_id,requested_date,scheduled_date,actual_release_date,actual_delivery_date,origin_location_id,destination,recipient_name,recipient_phone,status,source_system,created_by)
SELECT v.dlv_no,s.id,v.rdate,v.sdate,v.reldate,v.ddate,l.id,v.dest,v.recipient,v.phone,v.status,'DEMO','demo-seed'
FROM (
  SELECT 'DLV000001' dlv_no,'SO000001' so,'2026-03-16' rdate,'2026-03-18' sdate,'2026-03-18' reldate,'2026-03-19' ddate,'WH-CAVITE' loc,'Pasig City, Metro Manila' dest,'Juan Dela Cruz' recipient,'+63 917 000 1234' phone,'DELIVERED' status
  UNION ALL SELECT 'DLV000002','SO000002','2026-04-02','2026-04-04','2026-04-04',NULL,'WH-CAVITE','BGC, Taguig City','RideBox Fleet Desk','+63 917 000 5678','IN_TRANSIT'
) v
JOIN erp_sales_orders s ON s.sales_order_no=v.so
LEFT JOIN erp_locations l ON l.code=v.loc;

INSERT OR IGNORE INTO erp_delivery_assets(delivery_id,asset_id,serial_no,item_code,qty)
SELECT d.id,a.id,v.serial_no,v.item_code,1
FROM (
  SELECT 'DLV000001' dlv,'E88RNG2026B003' serial_no,'MC000002' item_code
  UNION ALL SELECT 'DLV000002','E88EXP2026A004','MC000001'
  UNION ALL SELECT 'DLV000002','E88EXP2026A005','MC000001'
) v
JOIN erp_deliveries d ON d.delivery_no=v.dlv
LEFT JOIN erp_assets a ON a.serial_no=v.serial_no;

-- ---------------------------------------------------------------------------
-- Stock ledger movements (drive movement register / stock analysis)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_stock_ledger(movement_no,movement_date,movement_type,asset_id,serial_no,item_id,item_code,qty,from_location_id,from_location_code,to_location_id,to_location_code,from_status,to_status,source_doc_type,source_doc_no,reason_code,posted_by)
SELECT v.mv_no,v.mdate,v.mtype,a.id,v.serial_no,i.id,v.item_code,1,
       fl.id,v.from_code,tl.id,v.to_code,v.from_status,v.to_status,v.doc_type,v.doc_no,v.reason,'demo-seed'
FROM (
  SELECT 'MV00000001' mv_no,'2026-01-10' mdate,'RECEIPT' mtype,'E88EXP2026A001' serial_no,'MC000001' item_code,NULL from_code,'WH-MAIN' to_code,NULL from_status,'AVAILABLE' to_status,'RECEIPT' doc_type,'RCV000001' doc_no,'GOODS_RECEIPT' reason
  UNION ALL SELECT 'MV00000002','2026-01-10','RECEIPT','E88RNG2026B001','MC000002',NULL,'WH-MAIN',NULL,'AVAILABLE','RECEIPT','RCV000001','GOODS_RECEIPT'
  UNION ALL SELECT 'MV00000003','2026-03-01','TRANSFER','E88EXP2026A004','MC000001','WH-MAIN','WH-CAVITE','AVAILABLE','AVAILABLE','TRANSFER','TRF000001','STOCK_REBALANCE'
  UNION ALL SELECT 'MV00000004','2026-03-18','ISSUE','E88RNG2026B003','MC000002','WH-CAVITE',NULL,'AVAILABLE','SOLD','DELIVERY','DLV000001','SALE_RELEASE'
  UNION ALL SELECT 'MV00000005','2026-04-04','ISSUE','E88EXP2026A004','MC000001','WH-CAVITE',NULL,'AVAILABLE','LEASED','DELIVERY','DLV000002','LEASE_RELEASE'
  UNION ALL SELECT 'MV00000006','2026-05-20','DEPLOY','AMP72452026C003','BAT000001','WH-MAIN','BSS-QC','AVAILABLE','DEPLOYED','DEPLOYMENT','BSSP000001','STATION_STOCKING'
) v
LEFT JOIN erp_assets a ON a.serial_no=v.serial_no
LEFT JOIN erp_items i ON i.item_code=v.item_code
LEFT JOIN erp_locations fl ON fl.code=v.from_code
LEFT JOIN erp_locations tl ON tl.code=v.to_code;

-- ---------------------------------------------------------------------------
-- Mark demo seed applied
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('DEMO_SEED_APPLIED','2026-08-04',datetime('now')),
('DEMO_MODE','1',datetime('now'));
