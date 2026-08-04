-- E88 Enterprise System - Demo data seed
-- Idempotent (INSERT OR IGNORE keyed on business keys). Safe to re-run.
-- Uses VALUES + scalar subqueries (no long UNION ALL chains) to stay within
-- D1's compound-SELECT term limit.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounting periods for 2026 (needed by finance postings)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_accounting_periods(entity_id,fiscal_year,period_no,period_name,start_date,end_date,status) VALUES
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,1,'2026-01','2026-01-01','2026-01-31','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,2,'2026-02','2026-02-01','2026-02-28','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,3,'2026-03','2026-03-01','2026-03-31','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,4,'2026-04','2026-04-01','2026-04-30','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,5,'2026-05','2026-05-01','2026-05-31','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,6,'2026-06','2026-06-01','2026-06-30','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,7,'2026-07','2026-07-01','2026-07-31','OPEN'),
((SELECT id FROM erp_legal_entities WHERE entity_code='E88'),2026,8,'2026-08','2026-08-01','2026-08-31','OPEN');

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
INSERT OR IGNORE INTO erp_assets(asset_no,serial_no,serial_type,item_id,item_code,item_name,category,current_location_id,current_location_code,current_status,unit_cost,landed_cost,condition_code,reconciliation_status,source_system) VALUES
('AST00000101','E88EXP2026A001','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',82000,82000,'GOOD','CLEAR','DEMO'),
('AST00000102','E88EXP2026A002','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',82000,82000,'GOOD','CLEAR','DEMO'),
('AST00000103','E88EXP2026A003','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',82000,82000,'GOOD','CLEAR','DEMO'),
('AST00000104','E88EXP2026A004','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE','LEASED',82000,82000,'GOOD','CLEAR','DEMO'),
('AST00000105','E88EXP2026A005','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE','LEASED',82000,82000,'GOOD','CLEAR','DEMO'),
('AST00000201','E88RNG2026B001','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002','E88 Ranger E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',96000,96000,'GOOD','CLEAR','DEMO'),
('AST00000202','E88RNG2026B002','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002','E88 Ranger E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',96000,96000,'GOOD','CLEAR','DEMO'),
('AST00000203','E88RNG2026B003','MOTORCYCLE',(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002','E88 Ranger E-Motorcycle','MC',(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE','SOLD',96000,96000,'GOOD','CLEAR','DEMO'),
('AST00000301','AMP72452026C001','BATTERY',(SELECT id FROM erp_items WHERE item_code='BAT000001'),'BAT000001','Ampace 72V 45Ah Battery Pack','BAT',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',38000,38000,'GOOD','CLEAR','DEMO'),
('AST00000302','AMP72452026C002','BATTERY',(SELECT id FROM erp_items WHERE item_code='BAT000001'),'BAT000001','Ampace 72V 45Ah Battery Pack','BAT',(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN','AVAILABLE',38000,38000,'GOOD','CLEAR','DEMO'),
('AST00000303','AMP72452026C003','BATTERY',(SELECT id FROM erp_items WHERE item_code='BAT000001'),'BAT000001','Ampace 72V 45Ah Battery Pack','BAT',(SELECT id FROM erp_locations WHERE code='BSS-QC'),'BSS-QC','DEPLOYED',38000,38000,'GOOD','CLEAR','DEMO'),
('AST00000304','AMP72452026C004','BATTERY',(SELECT id FROM erp_items WHERE item_code='BAT000001'),'BAT000001','Ampace 72V 45Ah Battery Pack','BAT',(SELECT id FROM erp_locations WHERE code='BSS-QC'),'BSS-QC','DEPLOYED',38000,38000,'GOOD','CLEAR','DEMO'),
('AST00000401','RB8CAB2026D001','SWAP_STATION',(SELECT id FROM erp_items WHERE item_code='BSS000001'),'BSS000001','RideBox Swap Cabinet 8-Slot','BSS',(SELECT id FROM erp_locations WHERE code='BSS-QC'),'BSS-QC','DEPLOYED',420000,420000,'GOOD','CLEAR','DEMO');

-- ---------------------------------------------------------------------------
-- Balanced POSTED journals (drive Trial Balance, P&L, GL)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_journal_headers(journal_no,entity_id,journal_date,journal_type,source_module,source_type,source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,status,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at) VALUES
('JE-DEMO-01',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-01-05','GENERAL','DEMO','DEMO_SEED','JE-DEMO-01','DEMO_JE-DEMO-01','Capital injection - shareholder funding','PHP',1,8000000,8000000,'POSTED','demo-seed','demo-seed','2026-01-05','demo-seed','2026-01-05','demo-seed','2026-01-05'),
('JE-DEMO-02',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-01-10','GENERAL','DEMO','DEMO_SEED','JE-DEMO-02','DEMO_JE-DEMO-02','Opening inventory purchase on credit','PHP',1,4700000,4700000,'POSTED','demo-seed','demo-seed','2026-01-10','demo-seed','2026-01-10','demo-seed','2026-01-10'),
('JE-DEMO-03',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-02-01','GENERAL','DEMO','DEMO_SEED','JE-DEMO-03','DEMO_JE-DEMO-03','Partial payment to supplier','PHP',1,2000000,2000000,'POSTED','demo-seed','demo-seed','2026-02-01','demo-seed','2026-02-01','demo-seed','2026-02-01'),
('JE-DEMO-04',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-03-15','GENERAL','DEMO','DEMO_SEED','JE-DEMO-04','DEMO_JE-DEMO-04','Motorcycle sale invoice','PHP',1,1120000,1120000,'POSTED','demo-seed','demo-seed','2026-03-15','demo-seed','2026-03-15','demo-seed','2026-03-15'),
('JE-DEMO-05',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-03-15','GENERAL','DEMO','DEMO_SEED','JE-DEMO-05','DEMO_JE-DEMO-05','Cost of motorcycles sold','PHP',1,700000,700000,'POSTED','demo-seed','demo-seed','2026-03-15','demo-seed','2026-03-15','demo-seed','2026-03-15'),
('JE-DEMO-06',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-04-02','GENERAL','DEMO','DEMO_SEED','JE-DEMO-06','DEMO_JE-DEMO-06','Customer receipt','PHP',1,1120000,1120000,'POSTED','demo-seed','demo-seed','2026-04-02','demo-seed','2026-04-02','demo-seed','2026-04-02'),
('JE-DEMO-07',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-04-30','GENERAL','DEMO','DEMO_SEED','JE-DEMO-07','DEMO_JE-DEMO-07','Lease revenue billing','PHP',1,336000,336000,'POSTED','demo-seed','demo-seed','2026-04-30','demo-seed','2026-04-30','demo-seed','2026-04-30'),
('JE-DEMO-08',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-05-31','GENERAL','DEMO','DEMO_SEED','JE-DEMO-08','DEMO_JE-DEMO-08','Energy and battery-swap revenue','PHP',1,224000,224000,'POSTED','demo-seed','demo-seed','2026-05-31','demo-seed','2026-05-31','demo-seed','2026-05-31'),
('JE-DEMO-09',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-05-05','GENERAL','DEMO','DEMO_SEED','JE-DEMO-09','DEMO_JE-DEMO-09','Warehouse rent - supplier bill','PHP',1,168000,168000,'POSTED','demo-seed','demo-seed','2026-05-05','demo-seed','2026-05-05','demo-seed','2026-05-05'),
('JE-DEMO-10',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-06-15','GENERAL','DEMO','DEMO_SEED','JE-DEMO-10','DEMO_JE-DEMO-10','Payroll for period','PHP',1,500000,500000,'POSTED','demo-seed','demo-seed','2026-06-15','demo-seed','2026-06-15','demo-seed','2026-06-15'),
('JE-DEMO-11',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-06-20','GENERAL','DEMO','DEMO_SEED','JE-DEMO-11','DEMO_JE-DEMO-11','Utilities payment','PHP',1,50400,50400,'POSTED','demo-seed','demo-seed','2026-06-20','demo-seed','2026-06-20','demo-seed','2026-06-20'),
('JE-DEMO-12',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-06-30','GENERAL','DEMO','DEMO_SEED','JE-DEMO-12','DEMO_JE-DEMO-12','Monthly depreciation','PHP',1,80000,80000,'POSTED','demo-seed','demo-seed','2026-06-30','demo-seed','2026-06-30','demo-seed','2026-06-30');

-- Journal lines (VALUES + scalar subqueries)
INSERT OR IGNORE INTO erp_journal_lines(journal_id,line_no,account_id,description,debit,credit,base_debit,base_credit) VALUES
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-01'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Operating bank funding',8000000,0,8000000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-01'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='3000'),'Share capital',0,8000000,0,8000000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-02'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1200'),'Motorcycles and parts inventory',3500000,0,3500000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-02'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1220'),'Batteries and BSS inventory',1200000,0,1200000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-02'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='2000'),'Accounts payable - suppliers',0,4700000,0,4700000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-03'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='2000'),'Accounts payable settled',2000000,0,2000000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-03'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Bank disbursement',0,2000000,0,2000000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-04'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1100'),'Accounts receivable',1120000,0,1120000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-04'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='4000'),'Motorcycle sales revenue',0,1000000,0,1000000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-04'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='2100'),'Output VAT',0,120000,0,120000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-05'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='5000'),'Cost of motorcycles sold',700000,0,700000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-05'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1200'),'Inventory relief',0,700000,0,700000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-06'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Bank collection',1120000,0,1120000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-06'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1100'),'Receivable settled',0,1120000,0,1120000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-07'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1100'),'Lease receivable',336000,0,336000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-07'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='4010'),'Lease revenue',0,300000,0,300000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-07'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='2100'),'Output VAT',0,36000,0,36000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-08'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Cash from swaps',224000,0,224000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-08'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='4020'),'Energy and battery swap revenue',0,200000,0,200000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-08'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='2100'),'Output VAT',0,24000,0,24000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-09'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='6100'),'Warehouse rent',150000,0,150000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-09'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1150'),'Input VAT',18000,0,18000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-09'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='2110'),'Expanded withholding tax payable',0,7500,0,7500),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-09'),4,(SELECT id FROM erp_chart_accounts WHERE account_code='2000'),'Accounts payable - landlord',0,160500,0,160500),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-10'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='6000'),'Payroll and benefits',500000,0,500000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-10'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='2120'),'Withholding tax on compensation',0,40000,0,40000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-10'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Net pay disbursed',0,460000,0,460000),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-11'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='6200'),'Utilities and communications',45000,0,45000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-11'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1150'),'Input VAT',5400,0,5400,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-11'),3,(SELECT id FROM erp_chart_accounts WHERE account_code='1010'),'Bank payment',0,50400,0,50400),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-12'),1,(SELECT id FROM erp_chart_accounts WHERE account_code='6800'),'Depreciation expense',80000,0,80000,0),
((SELECT id FROM erp_journal_headers WHERE journal_no='JE-DEMO-12'),2,(SELECT id FROM erp_chart_accounts WHERE account_code='1390'),'Accumulated depreciation',0,80000,0,80000);

-- ---------------------------------------------------------------------------
-- AP subledger documents (drive AP aging report)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_subledger_documents(document_no,entity_id,document_type,partner_id,document_date,due_date,currency,gross_amount,net_amount,vat_amount,withholding_amount,open_balance,status,created_by,posted_by,posted_at) VALUES
('AP00000001',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'SUPPLIER_BILL',(SELECT id FROM erp_partners WHERE partner_code='V-AMPACE'),'2026-05-05','2026-06-04','PHP',168000,150000,18000,7500,160500,'POSTED','demo-seed','demo-seed','2026-05-05'),
('AP00000002',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'SUPPLIER_BILL',(SELECT id FROM erp_partners WHERE partner_code='V-NIU'),'2026-06-18','2026-07-18','PHP',560000,500000,60000,0,560000,'POSTED','demo-seed','demo-seed','2026-06-18'),
('AP00000003',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'SUPPLIER_BILL',(SELECT id FROM erp_partners WHERE partner_code='V-LOGI'),'2026-07-01','2026-07-31','PHP',89600,80000,9600,0,89600,'POSTED','demo-seed','demo-seed','2026-07-01'),
('AP00000004',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'SUPPLIER_BILL',(SELECT id FROM erp_partners WHERE partner_code='V-AMPACE'),'2026-07-20','2026-08-19','PHP',2700000,2700000,0,0,2700000,'POSTED','demo-seed','demo-seed','2026-07-20');

-- ---------------------------------------------------------------------------
-- Payment requests (RFP worklist, various stages)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_payment_requests(request_no,entity_id,request_date,requestor_email,payee_partner_id,payee_name,department,cost_center,purpose,request_type,supplier_invoice_no,invoice_date,gross_amount,vat_amount,withholding_amount,net_payable,due_date,payment_method,status,department_approved_by,department_approved_at,finance_validated_by,finance_validated_at,final_approved_by,final_approved_at,paid_by,paid_at,payment_reference) VALUES
('RFP00000001',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-07-02','mmungcal@nrdev.ph',(SELECT id FROM erp_partners WHERE partner_code='V-AMPACE'),'Ampace Technology Ltd.','Supply Chain','SCM-01','Payment for battery pack shipment','SUPPLIER_PAYMENT','AMP-INV-2201','2026-05-05',168000,18000,7500,160500,'2026-08-04','BANK_TRANSFER','SUBMITTED',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('RFP00000002',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-07-10','mmungcal@nrdev.ph',(SELECT id FROM erp_partners WHERE partner_code='V-NIU'),'NIU Technologies','Supply Chain','SCM-01','Payment for motorcycle units','SUPPLIER_PAYMENT','NIU-INV-8890','2026-06-18',560000,60000,0,560000,'2026-08-10','BANK_TRANSFER','DEPARTMENT_APPROVED','Samuel Kniazeff Jr','2026-07-11',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('RFP00000003',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-07-15','mmungcal@nrdev.ph',(SELECT id FROM erp_partners WHERE partner_code='V-LOGI'),'FastFreight Logistics Inc.','Logistics','LOG-02','Freight and delivery services','SUPPLIER_PAYMENT','FF-INV-4471','2026-07-01',89600,9600,0,89600,'2026-08-14','BANK_TRANSFER','FINANCE_VALIDATED','Samuel Kniazeff Jr','2026-07-16','Mark Alexis Mungcal','2026-07-18',NULL,NULL,NULL,NULL,NULL),
('RFP00000004',(SELECT id FROM erp_legal_entities WHERE entity_code='E88'),'2026-06-20','mmungcal@nrdev.ph',(SELECT id FROM erp_partners WHERE partner_code='V-AMPACE'),'Ampace Technology Ltd.','Supply Chain','SCM-01','Advance payment for Q3 order','SUPPLIER_PAYMENT','AMP-INV-2150','2026-06-15',2700000,0,0,2700000,'2026-07-20','BANK_TRANSFER','PAID','Samuel Kniazeff Jr','2026-06-21','Mark Alexis Mungcal','2026-06-23','Francis Ryan Simsim','2026-06-24','mmungcal@nrdev.ph','2026-06-25','BT-2026-0091');

-- ---------------------------------------------------------------------------
-- Sales orders + lines
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_sales_orders(sales_order_no,transaction_type,customer_id,order_date,contract_start,contract_end,status,gross_amount,delivery_address,source_system,created_by,posted_by,posted_at) VALUES
('SO000001','SALE',(SELECT id FROM erp_partners WHERE partner_code='C-JUANHAUL'),'2026-03-15',NULL,NULL,'POSTED',1120000,'Pasig City, Metro Manila','DEMO','demo-seed','demo-seed','2026-03-15'),
('SO000002','LEASE',(SELECT id FROM erp_partners WHERE partner_code='C-RIDEBOX'),'2026-04-01','2026-04-01','2027-03-31','POSTED',336000,'BGC, Taguig City','DEMO','demo-seed','demo-seed','2026-04-01'),
('SO000003','SALE',(SELECT id FROM erp_partners WHERE partner_code='C-GRABEXP'),'2026-07-28',NULL,NULL,'DRAFT',192000,'Quezon City, Metro Manila','DEMO','demo-seed',NULL,NULL);

INSERT OR IGNORE INTO erp_sales_lines(sales_order_id,line_no,item_id,item_code,description,qty,unit_price,serial_no,line_role) VALUES
((SELECT id FROM erp_sales_orders WHERE sales_order_no='SO000001'),1,(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002','E88 Ranger E-Motorcycle',1,1000000,'E88RNG2026B003','PRIMARY'),
((SELECT id FROM erp_sales_orders WHERE sales_order_no='SO000002'),1,(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001','E88 Explorer E-Motorcycle',2,150000,'E88EXP2026A004','PRIMARY'),
((SELECT id FROM erp_sales_orders WHERE sales_order_no='SO000003'),1,(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002','E88 Ranger E-Motorcycle',2,96000,NULL,'PRIMARY');

-- ---------------------------------------------------------------------------
-- Deliveries + delivery assets
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_deliveries(delivery_no,sales_order_id,requested_date,scheduled_date,actual_release_date,actual_delivery_date,origin_location_id,destination,recipient_name,recipient_phone,status,source_system,created_by) VALUES
('DLV000001',(SELECT id FROM erp_sales_orders WHERE sales_order_no='SO000001'),'2026-03-16','2026-03-18','2026-03-18','2026-03-19',(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'Pasig City, Metro Manila','Juan Dela Cruz','+63 917 000 1234','DELIVERED','DEMO','demo-seed'),
('DLV000002',(SELECT id FROM erp_sales_orders WHERE sales_order_no='SO000002'),'2026-04-02','2026-04-04','2026-04-04',NULL,(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'BGC, Taguig City','RideBox Fleet Desk','+63 917 000 5678','IN_TRANSIT','DEMO','demo-seed');

INSERT OR IGNORE INTO erp_delivery_assets(delivery_id,asset_id,serial_no,item_code,qty) VALUES
((SELECT id FROM erp_deliveries WHERE delivery_no='DLV000001'),(SELECT id FROM erp_assets WHERE serial_no='E88RNG2026B003'),'E88RNG2026B003','MC000002',1),
((SELECT id FROM erp_deliveries WHERE delivery_no='DLV000002'),(SELECT id FROM erp_assets WHERE serial_no='E88EXP2026A004'),'E88EXP2026A004','MC000001',1),
((SELECT id FROM erp_deliveries WHERE delivery_no='DLV000002'),(SELECT id FROM erp_assets WHERE serial_no='E88EXP2026A005'),'E88EXP2026A005','MC000001',1);

-- ---------------------------------------------------------------------------
-- Stock ledger movements (drive movement register / stock analysis)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO erp_stock_ledger(movement_no,movement_date,movement_type,asset_id,serial_no,item_id,item_code,qty,from_location_id,from_location_code,to_location_id,to_location_code,from_status,to_status,source_doc_type,source_doc_no,reason_code,posted_by) VALUES
('MV00000001','2026-01-10','RECEIPT',(SELECT id FROM erp_assets WHERE serial_no='E88EXP2026A001'),'E88EXP2026A001',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001',1,NULL,NULL,(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN',NULL,'AVAILABLE','RECEIPT','RCV000001','GOODS_RECEIPT','demo-seed'),
('MV00000002','2026-01-10','RECEIPT',(SELECT id FROM erp_assets WHERE serial_no='E88RNG2026B001'),'E88RNG2026B001',(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002',1,NULL,NULL,(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN',NULL,'AVAILABLE','RECEIPT','RCV000001','GOODS_RECEIPT','demo-seed'),
('MV00000003','2026-03-01','TRANSFER',(SELECT id FROM erp_assets WHERE serial_no='E88EXP2026A004'),'E88EXP2026A004',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001',1,(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN',(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE','AVAILABLE','AVAILABLE','TRANSFER','TRF000001','STOCK_REBALANCE','demo-seed'),
('MV00000004','2026-03-18','ISSUE',(SELECT id FROM erp_assets WHERE serial_no='E88RNG2026B003'),'E88RNG2026B003',(SELECT id FROM erp_items WHERE item_code='MC000002'),'MC000002',1,(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE',NULL,NULL,'AVAILABLE','SOLD','DELIVERY','DLV000001','SALE_RELEASE','demo-seed'),
('MV00000005','2026-04-04','ISSUE',(SELECT id FROM erp_assets WHERE serial_no='E88EXP2026A004'),'E88EXP2026A004',(SELECT id FROM erp_items WHERE item_code='MC000001'),'MC000001',1,(SELECT id FROM erp_locations WHERE code='WH-CAVITE'),'WH-CAVITE',NULL,NULL,'AVAILABLE','LEASED','DELIVERY','DLV000002','LEASE_RELEASE','demo-seed'),
('MV00000006','2026-05-20','DEPLOY',(SELECT id FROM erp_assets WHERE serial_no='AMP72452026C003'),'AMP72452026C003',(SELECT id FROM erp_items WHERE item_code='BAT000001'),'BAT000001',1,(SELECT id FROM erp_locations WHERE code='WH-MAIN'),'WH-MAIN',(SELECT id FROM erp_locations WHERE code='BSS-QC'),'BSS-QC','AVAILABLE','DEPLOYED','DEPLOYMENT','BSSP000001','STATION_STOCKING','demo-seed');

-- ---------------------------------------------------------------------------
-- Mark demo seed applied
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO erp_settings(key,value,updated_at) VALUES
('DEMO_SEED_APPLIED','2026-08-04',datetime('now')),
('DEMO_MODE','1',datetime('now'));
