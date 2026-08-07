const f = (key, label, type = 'text', options = {}) => ({ key, label, type, ...options });
const o = (...values) => values;

const WORKFLOWS = {
  ledger: {
    stages:o('DRAFT','FOR_APPROVAL','APPROVED','POSTED','REVERSED'),
    actions:[
      { code:'SUBMIT', label:'Submit for Approval', from:o('DRAFT'), to:'FOR_APPROVAL', permission:'EDIT' },
      { code:'APPROVE', label:'Approve', from:o('FOR_APPROVAL'), to:'APPROVED', permission:'APPROVE' },
      { code:'POST', label:'Post', from:o('APPROVED'), to:'POSTED', permission:'POST' },
      { code:'REVERSE', label:'Reverse', from:o('POSTED'), to:'REVERSED', permission:'POST' },
    ],
  },
  request: {
    stages:o('DRAFT','SUBMITTED','APPROVED','IN_PROGRESS','CLOSED','CANCELLED'),
    actions:[
      { code:'SUBMIT', label:'Submit', from:o('DRAFT'), to:'SUBMITTED', permission:'EDIT' },
      { code:'APPROVE', label:'Approve', from:o('SUBMITTED'), to:'APPROVED', permission:'APPROVE' },
      { code:'START', label:'Start Work', from:o('APPROVED'), to:'IN_PROGRESS', permission:'EDIT' },
      { code:'CLOSE', label:'Close', from:o('IN_PROGRESS'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  master: {
    stages:o('DRAFT','ACTIVE','INACTIVE'),
    actions:[
      { code:'ACTIVATE', label:'Activate', from:o('DRAFT','INACTIVE'), to:'ACTIVE', permission:'EDIT' },
      { code:'DEACTIVATE', label:'Deactivate', from:o('ACTIVE'), to:'INACTIVE', permission:'MANAGE' },
    ],
  },
  planning: {
    stages:o('DRAFT','BASELINE','APPROVED','ACTIVE','CLOSED'),
    actions:[
      { code:'BASELINE', label:'Set Baseline', from:o('DRAFT'), to:'BASELINE', permission:'EDIT' },
      { code:'APPROVE', label:'Approve Plan', from:o('BASELINE'), to:'APPROVED', permission:'APPROVE' },
      { code:'ACTIVATE', label:'Activate Plan', from:o('APPROVED'), to:'ACTIVE', permission:'EDIT' },
      { code:'CLOSE', label:'Close Plan', from:o('ACTIVE'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  order: {
    stages:o('DRAFT','FOR_APPROVAL','APPROVED','FULFILMENT','CLOSED','CANCELLED'),
    actions:[
      { code:'SUBMIT', label:'Submit Order', from:o('DRAFT'), to:'FOR_APPROVAL', permission:'EDIT' },
      { code:'APPROVE', label:'Approve Order', from:o('FOR_APPROVAL'), to:'APPROVED', permission:'APPROVE' },
      { code:'FULFIL', label:'Start Fulfilment', from:o('APPROVED'), to:'FULFILMENT', permission:'EDIT' },
      { code:'CLOSE', label:'Close Order', from:o('FULFILMENT'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  contract: {
    stages:o('DRAFT','FOR_APPROVAL','ACTIVE','EXPIRED','TERMINATED'),
    actions:[
      { code:'SUBMIT', label:'Submit Contract', from:o('DRAFT'), to:'FOR_APPROVAL', permission:'EDIT' },
      { code:'ACTIVATE', label:'Approve & Activate', from:o('FOR_APPROVAL'), to:'ACTIVE', permission:'APPROVE' },
      { code:'EXPIRE', label:'Mark Expired', from:o('ACTIVE'), to:'EXPIRED', permission:'EDIT' },
      { code:'TERMINATE', label:'Terminate', from:o('ACTIVE'), to:'TERMINATED', permission:'MANAGE' },
    ],
  },
  movement: {
    stages:o('DRAFT','PLANNED','IN_TRANSIT','RECEIVED','CLOSED','CANCELLED'),
    actions:[
      { code:'PLAN', label:'Confirm Plan', from:o('DRAFT'), to:'PLANNED', permission:'EDIT' },
      { code:'DISPATCH', label:'Dispatch', from:o('PLANNED'), to:'IN_TRANSIT', permission:'EDIT' },
      { code:'RECEIVE', label:'Confirm Receipt', from:o('IN_TRANSIT'), to:'RECEIVED', permission:'EDIT' },
      { code:'CLOSE', label:'Close Movement', from:o('RECEIVED'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  inventory: {
    stages:o('OPEN','IN_PROGRESS','RECONCILED','CLOSED'),
    actions:[
      { code:'START', label:'Start Count', from:o('OPEN'), to:'IN_PROGRESS', permission:'EDIT' },
      { code:'RECONCILE', label:'Reconcile', from:o('IN_PROGRESS'), to:'RECONCILED', permission:'APPROVE' },
      { code:'CLOSE', label:'Close', from:o('RECONCILED'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  maintenance: {
    stages:o('OPEN','PLANNED','IN_PROGRESS','COMPLETED','CLOSED','ON_HOLD'),
    actions:[
      { code:'PLAN', label:'Plan Work', from:o('OPEN'), to:'PLANNED', permission:'EDIT' },
      { code:'START', label:'Start Work', from:o('PLANNED','ON_HOLD'), to:'IN_PROGRESS', permission:'EDIT' },
      { code:'COMPLETE', label:'Complete Work', from:o('IN_PROGRESS'), to:'COMPLETED', permission:'EDIT' },
      { code:'CLOSE', label:'Close Work Order', from:o('COMPLETED'), to:'CLOSED', permission:'APPROVE' },
    ],
  },
  quality: {
    stages:o('DRAFT','INSPECTION','ACCEPTED','REJECTED','CLOSED'),
    actions:[
      { code:'INSPECT', label:'Start Inspection', from:o('DRAFT'), to:'INSPECTION', permission:'EDIT' },
      { code:'ACCEPT', label:'Accept', from:o('INSPECTION'), to:'ACCEPTED', permission:'APPROVE' },
      { code:'REJECT', label:'Reject', from:o('INSPECTION'), to:'REJECTED', permission:'APPROVE' },
      { code:'CLOSE', label:'Close', from:o('ACCEPTED','REJECTED'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  project: {
    stages:o('DRAFT','APPROVED','ACTIVE','ON_HOLD','COMPLETED','CLOSED'),
    actions:[
      { code:'APPROVE', label:'Approve Project', from:o('DRAFT'), to:'APPROVED', permission:'APPROVE' },
      { code:'START', label:'Start Project', from:o('APPROVED'), to:'ACTIVE', permission:'EDIT' },
      { code:'COMPLETE', label:'Complete', from:o('ACTIVE'), to:'COMPLETED', permission:'EDIT' },
      { code:'CLOSE', label:'Close Project', from:o('COMPLETED'), to:'CLOSED', permission:'APPROVE' },
    ],
  },
  people: {
    stages:o('DRAFT','FOR_APPROVAL','ACTIVE','ON_HOLD','CLOSED'),
    actions:[
      { code:'SUBMIT', label:'Submit', from:o('DRAFT'), to:'FOR_APPROVAL', permission:'EDIT' },
      { code:'APPROVE', label:'Approve', from:o('FOR_APPROVAL'), to:'ACTIVE', permission:'APPROVE' },
      { code:'HOLD', label:'Place On Hold', from:o('ACTIVE'), to:'ON_HOLD', permission:'MANAGE' },
      { code:'CLOSE', label:'Close', from:o('ACTIVE','ON_HOLD'), to:'CLOSED', permission:'EDIT' },
    ],
  },
  configuration: {
    stages:o('DRAFT','ACTIVE','PAUSED','INACTIVE'),
    actions:[
      { code:'ACTIVATE', label:'Activate', from:o('DRAFT','PAUSED','INACTIVE'), to:'ACTIVE', permission:'MANAGE' },
      { code:'PAUSE', label:'Pause', from:o('ACTIVE'), to:'PAUSED', permission:'MANAGE' },
      { code:'DEACTIVATE', label:'Deactivate', from:o('ACTIVE','PAUSED'), to:'INACTIVE', permission:'MANAGE' },
    ],
  },
};

const KIND_DEFAULTS = {
  ledger:{ template:'financial', entityLabel:'Entity / Counterparty', dateLabel:'Document Date', amountLabel:'Document Amount', workflow:'ledger' },
  request:{ template:'work', entityLabel:'Requestor / Entity', dateLabel:'Request Date', amountLabel:'Estimated Amount', workflow:'request' },
  master:{ template:'register', entityLabel:'Master Name', dateLabel:'Effective Date', amountLabel:'Reference Value', workflow:'master' },
  planning:{ template:'planning', entityLabel:'Planning Unit', dateLabel:'Plan Date', amountLabel:'Planned Value', workflow:'planning' },
  order:{ template:'sales', entityLabel:'Customer', dateLabel:'Order Date', amountLabel:'Order Value', workflow:'order' },
  contract:{ template:'contract', entityLabel:'Contracting Party', dateLabel:'Contract Date', amountLabel:'Contract Value', workflow:'contract' },
  movement:{ template:'logistics', entityLabel:'Origin / Partner', dateLabel:'Movement Date', amountLabel:'Freight / Declared Value', workflow:'movement' },
  inventory:{ template:'inventory', entityLabel:'Warehouse / Site', dateLabel:'Count Date', amountLabel:'Inventory Value', workflow:'inventory' },
  maintenance:{ template:'maintenance', entityLabel:'Equipment / Site', dateLabel:'Work Date', amountLabel:'Estimated Cost', workflow:'maintenance' },
  quality:{ template:'quality', entityLabel:'Item / Lot / Supplier', dateLabel:'Inspection Date', amountLabel:'Quality Cost', workflow:'quality' },
  project:{ template:'project', entityLabel:'Project / Client', dateLabel:'Project Date', amountLabel:'Project Value', workflow:'project' },
  people:{ template:'people', entityLabel:'Employee / Candidate', dateLabel:'Effective Date', amountLabel:'Compensation / Cost', workflow:'people' },
  configuration:{ template:'configuration', entityLabel:'Configuration Name', dateLabel:'Effective Date', amountLabel:'Reference Value', workflow:'configuration' },
};

const p = (kind, noun, plural, prefix, recordTypes, fields, connections = [], reports = [], quickActions = []) => ({
  kind, noun, plural, prefix, recordTypes, fields, connections, reports, quickActions,
});

export const MODULE_PROFILES = {
  'fa-general-accounting':p('ledger','Journal Entry','Journal Entries','JE',o('Journal Entry','Adjusting Entry','Recurring Journal'),[
    f('ledgerAccount','Ledger Account'),f('counterAccount','Counter Account'),f('postingPeriod','Posting Period','month'),f('debit','Debit','number',{step:'0.01',list:true}),f('credit','Credit','number',{step:'0.01',list:true}),f('referenceNo','Source Reference'),
  ],o('fa-management-accounting','fa-consolidation-reporting'),o('Trial Balance','General Ledger','Journal Register'),o('Create Journal','Post Recurring Entry')),
  'fa-receivables-payables':p('ledger','Payable Document','Payable Documents','AP',o('Supplier Bill','Debit Memo','Payment','Cash Advance','Liquidation'),[
    f('documentNo','Invoice / Bill No.', 'text',{list:true}),f('counterpartyType','Customer / Supplier','select',{options:o('CUSTOMER','SUPPLIER')}),f('dueDate','Due Date','date',{list:true}),f('paymentTerms','Payment Terms'),f('balance','Open Balance','number',{step:'0.01',list:true}),f('agingBucket','Aging Bucket','select',{options:o('CURRENT','1-30','31-60','61-90','OVER_90')}),
  ],o('ip-sourcing-purchasing','fa-general-accounting'),o('AP Aging','Supplier Balances','Payment Forecast'),o('Record Bill','Record Payment')),
  'fa-receivables-management':p('ledger','Receivable','Receivables','AR',o('Sale','Lease Billing','Battery Swap','After-sales','Warehouse Service','Collection'),[
    f('entryNo','Entry No.','text',{list:true}),f('stream','Revenue Stream','select',{options:o('MC_SOLD','MC_LEASED','BATTERY_SWAP','AFTERSALES','WAREHOUSE_SERVICE'),list:true}),f('customerName','Customer','text',{list:true}),f('grossAmount','Gross','number',{step:'0.01',list:true}),f('outputVat','Output VAT','number',{step:'0.01'}),f('collected','Collected','number',{step:'0.01',list:true}),f('balance','Balance','number',{step:'0.01',list:true}),
  ],o('sd-order-management','fa-general-accounting','srp-billing-revenue'),o('Collection Rate','Receivables Ageing','Revenue by Stream'),o('New Entry','Record Collection')),
  'fa-fixed-assets':p('master','Fixed Asset','Fixed Assets','FA',o('Asset Acquisition','Capitalization','Depreciation Run','Asset Disposal','Asset Transfer'),[
    f('assetCode','Asset Code','text',{list:true}),f('assetClass','Asset Class','select',{options:o('MOTORCYCLE','BATTERY','BSS','EQUIPMENT','IT','LEASEHOLD')}),f('serialNo','Serial No.','text',{list:true}),f('acquisitionDate','Acquisition Date','date'),f('usefulLifeMonths','Useful Life (Months)','number'),f('location','Current Location','text',{list:true}),
  ],o('eam-induction-setup','ip-warehouse-management'),o('Asset Register','Depreciation Schedule','Asset Movement'),o('Capitalize Asset','Run Depreciation')),
  'fa-management-accounting':p('planning','Cost Allocation','Cost Allocations','MCA',o('Cost Allocation','Variance Analysis','Profit Center Review','Unit Economics'),[
    f('costCenter','Cost Center','text',{list:true}),f('businessLine','Business Line','select',{options:o('MOTORCYCLE_LEASE','MOTORCYCLE_SALE','RIDEBOX_BSS','AFTERSALES','SHARED_SERVICES')}),f('fiscalPeriod','Fiscal Period','month'),f('allocationBasis','Allocation Basis'),f('budgetAmount','Budget Amount','number',{step:'0.01'}),f('actualAmount','Actual Amount','number',{step:'0.01',list:true}),
  ],o('fa-general-accounting','fa-planning-budgeting'),o('Cost Center P&L','Budget Variance','Unit Economics'),o('Allocate Costs','Review Variance')),
  'fa-consolidation-reporting':p('ledger','Consolidation Run','Consolidation Runs','CON',o('Entity Close','Consolidation Run','Elimination Entry','FX Translation'),[
    f('reportingEntity','Reporting Entity','select',{options:o('E88_VENTURES','NRD_MOTORCYCLE','RIDEBOX','SHARED_SERVICES')}),f('fiscalPeriod','Fiscal Period','month',{list:true}),f('currency','Currency','select',{options:o('PHP','USD','TWD')}),f('eliminationType','Elimination Type'),f('sourceBalance','Source Balance','number',{step:'0.01'}),f('consolidatedBalance','Consolidated Balance','number',{step:'0.01',list:true}),
  ],o('fa-general-accounting','fa-management-accounting'),o('Consolidated P&L','Consolidated Balance Sheet','Consolidated Cash Flow'),o('Run Consolidation','Create Elimination')),
  'fa-financial-services':p('contract','Bank Facility','Bank Facilities','BFS',o('Bank Account','Credit Facility','Loan Drawdown','Debt Service','Investment'),[
    f('bankName','Bank / Institution','text',{list:true}),f('facilityType','Facility Type','select',{options:o('CURRENT_ACCOUNT','TERM_LOAN','CREDIT_LINE','TIME_DEPOSIT')}),f('accountNo','Account / Facility No.'),f('maturityDate','Maturity Date','date',{list:true}),f('interestRate','Interest Rate %','number',{step:'0.01'}),f('availableLimit','Available Limit','number',{step:'0.01',list:true}),
  ],o('fa-receivables-payables','fa-planning-budgeting'),o('Cash Position','Debt Schedule','Facility Utilization'),o('Record Drawdown','Record Debt Service')),
  'fa-planning-budgeting':p('planning','Budget Version','Budget Versions','BUD',o('Annual Budget','Forecast','Rolling Forecast','Budget Transfer'),[
    f('fiscalYear','Fiscal Year','number',{list:true}),f('scenario','Scenario','select',{options:o('BUDGET','BASE','UPSIDE','DOWNSIDE','FORECAST')}),f('department','Budget Department','text',{list:true}),f('costCenter','Cost Center'),f('version','Version'),f('forecastAmount','Forecast Amount','number',{step:'0.01',list:true}),
  ],o('fa-management-accounting','pm-planning-budgeting','srp-budgets'),o('Budget vs Actual','Department Budget','Cash Forecast'),o('Create Budget','Revise Forecast')),
  'fa-grants-funds':p('contract','Fund','Funds & Grants','FND',o('Grant','Restricted Fund','Funding Request','Fund Utilization'),[
    f('fundCode','Fund Code','text',{list:true}),f('grantor','Grantor / Funding Source','text',{list:true}),f('restriction','Restriction'),f('startDate','Start Date','date'),f('expiryDate','Expiry Date','date',{list:true}),f('availableBalance','Available Balance','number',{step:'0.01',list:true}),
  ],o('fa-general-accounting','pm-planning-budgeting'),o('Fund Utilization','Restricted Balance','Grant Expiry'),o('Create Fund','Record Utilization')),

  'sd-crm':p('request','Opportunity','CRM Opportunities','CRM',o('Lead','Opportunity','Customer Visit','Follow-up','Account Review'),[
    f('customerType','Customer Type','select',{options:o('B2B','B2C','B2B2C'),list:true}),f('contactPerson','Contact Person'),f('mobileNo','Mobile No.'),f('leadSource','Lead Source'),f('salesStage','Sales Stage','select',{options:o('PROSPECT','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST'),list:true}),f('nextActionDate','Next Action Date','date',{list:true}),
  ],o('sd-demand-planning','sd-order-management','srp-proposal-estimation'),o('Sales Pipeline','Lead Conversion','Customer Activity'),o('Create Lead','Log Customer Visit')),
  'sd-demand-planning':p('planning','Demand Plan','Demand Plans','DPL',o('Demand Forecast','Sales Forecast','Product Mix Plan','Promotion Forecast'),[
    f('itemCode','Item / Product Code','text',{list:true}),f('forecastPeriod','Forecast Period','month',{list:true}),f('channel','Channel','select',{options:o('B2B','B2C','B2B2C')}),f('baselineQty','Baseline Qty','number'),f('forecastQty','Forecast Qty','number',{list:true}),f('confidencePct','Confidence %','number',{step:'0.01'}),
  ],o('sd-crm','ip-inventory-analysis','mf-planning'),o('Demand Forecast','Forecast Accuracy','Supply Gap'),o('Create Forecast','Recalculate Demand')),
  'sd-order-management':p('order','Sales Order','Sales Orders','SO',o('Motorcycle Sale','Lease Order','Aftersales Order','Battery Swap Order','Other Charge'),[
    f('customerType','Customer Type','select',{options:o('B2B','B2C','B2B2C'),list:true}),f('orderChannel','Order Channel','select',{options:o('DIRECT','DEALER','DIGITAL','FIELD_SALES')}),f('itemCode','Item Code','text',{list:true}),f('quantity','Quantity','number',{min:'1',list:true}),f('requiredDate','Required Date','date',{list:true}),f('deliveryLocation','Delivery Location'),
  ],o('sd-crm','sd-outbound-logistics','sd-lease-contract-management','fa-receivables-management'),o('Sales Order Register','Order Fulfilment','Sales by Channel'),o('Create Sales Order','Check Availability')),
  'sd-lease-contract-management':p('contract','Lease Contract','Lease Contracts','LCT',o('B2B Lease','B2C Lease','B2B2C Lease','Lease Amendment','Lease Termination'),[
    f('businessChannel','Business Channel','select',{options:o('B2B','B2C','B2B2C'),required:true,list:true}),
    f('contractNo','Client Contract Reference','text',{list:true}),f('serviceProvider','Service Provider','text',{default:'E88 Ventures, Inc.'}),
    f('serviceProviderAddress','Service Provider Address / Contact','textarea'),
    f('clientName','Client','text',{required:true,list:true}),f('clientAddress','Client Address','textarea'),f('clientEmail','Client Email','email'),
    f('leasedUnitsDescription','Leased Units / Annex Reference','textarea'),f('replacementValue','Replacement Value','number',{step:'0.01'}),
    f('contractTermMonths','Contract Term (Months)','number',{min:'1',list:true}),f('lockInMonths','Lock-in Period (Months)','number',{min:'0'}),
    f('contractStartDate','Effective Date','date',{required:true}),f('contractEndDate','End of Term','date',{required:true,list:true}),
    f('dailyLeaseRate','Daily Rate (VAT-Ex) / Unit','number',{step:'0.01',list:true}),f('latePenalty','Late Penalty'),
    f('billingBasis','Billing Basis','select',{options:o('MONTHLY_IN_ADVANCE','MONTHLY_IN_ARREARS','QUARTERLY_IN_ADVANCE','OTHER')}),
    f('paymentChannel','Payment Channel','select',{options:o('PDC','BANK_TRANSFER','AUTO_DEBIT','ONLINE','OTHER')}),
    f('providerAuthorizedRep','Service Provider Authorized Representative'),f('clientAuthorizedRep','Client Authorized Representative'),
    f('billingFrequency','Billing Frequency','select',{options:o('MONTHLY','QUARTERLY','ANNUAL')}),
    f('unitCount','Units','number',{min:'0',list:true}),f('depositAmount','Deposit Amount','number',{step:'0.01'}),
  ],o('sd-order-management','eam-equipment-rental','srp-billing-revenue'),o('Active Lease Register','Lease Billing Schedule','Expiring Contracts'),o('Create Lease','Generate Billing Schedule')),
  'sd-outbound-logistics':p('movement','Dispatch','Outbound Dispatches','DSP',o('Dispatch Plan','Dealer Delivery','Retail Delivery','Return Dispatch'),[
    f('dispatchNo','Dispatch No.','text',{list:true}),f('salesOrderNo','Sales Order No.'),f('carrier','Carrier','text',{list:true}),f('vehicleNo','Vehicle No.'),f('route','Route'),f('deliveryDate','Delivery Date','date',{list:true}),f('proofOfDelivery','Proof of Delivery Reference'),
  ],o('sd-order-management','lm-transport','lm-order-warehouse'),o('Dispatch Register','On-time Delivery','Proof of Delivery'),o('Create Dispatch','Assign Carrier')),
  'sd-warranty-management':p('request','Warranty Claim','Warranty Claims','WC',o('Warranty Registration','Warranty Claim','Replacement Authorization','Claim Closure'),[
    f('serialNo','Serial No.','text',{required:true,list:true}),f('itemCode','Item Code'),f('purchaseDate','Purchase Date','date'),f('claimType','Claim Type','select',{options:o('PARTS','LABOR','REPLACEMENT','REFUND')}),f('faultDescription','Fault Description','textarea'),f('warrantyExpiry','Warranty Expiry','date',{list:true}),
  ],o('sd-service-management','qm-acceptance-rejection','ip-warehouse-management'),o('Open Warranty Claims','Claim Cost','Failure Analysis'),o('Register Warranty','Create Claim')),
  'sd-service-management':p('maintenance','Service Job','Service Jobs','SVC',o('Service Request','Preventive Service','Repair Job','Roadside Assistance'),[
    f('serviceTicket','Service Ticket','text',{list:true}),f('serialNo','Motorcycle / Equipment Serial','text',{list:true}),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','CRITICAL'),list:true}),f('serviceCenter','Service Center'),f('scheduledDate','Scheduled Date','date',{list:true}),f('technician','Assigned Technician'),
  ],o('sd-warranty-management','eam-work-management','qm-administration'),o('Service Backlog','Turnaround Time','Service Cost'),o('Create Service Job','Assign Technician')),
  'sd-pim':p('master','Product','Products','PIM',o('Motorcycle Model','Battery Model','BSS Equipment','Spare Part','Service Item'),[
    f('itemCode','Item Code','text',{required:true,list:true}),f('category','Category','select',{options:o('MC','BAT','BSS','SP','CHG','OTH'),list:true}),f('brand','Brand'),f('model','Model','text',{list:true}),f('uom','Unit of Measure'),f('standardCost','Standard Cost','number',{step:'0.01'}),f('salesPrice','Sales Price','number',{step:'0.01'}),
  ],o('ip-inventory-analysis','mf-costing','sd-order-management'),o('Product Catalog','Price List','Product Completeness'),o('Create Product','Publish Product')),
  'sd-customer-portal':p('request','Customer Request','Customer Portal Requests','CPR',o('Service Request','Billing Inquiry','Delivery Inquiry','Contract Request','Complaint'),[
    f('customerAccount','Customer Account','text',{list:true}),f('requestType','Request Type','select',{options:o('SERVICE','BILLING','DELIVERY','CONTRACT','COMPLAINT'),list:true}),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','URGENT')}),f('submittedBy','Submitted By'),f('contactNo','Contact No.'),f('targetResponseDate','Target Response Date','date',{list:true}),
  ],o('sd-crm','sd-service-management','fa-receivables-management'),o('Portal Requests','Response SLA','Customer Issues'),o('Create Request','Assign Request')),

  'ip-inventory-analysis':p('planning','Inventory Plan','Inventory Plans','IAP',o('Stock Analysis','Reorder Plan','Safety Stock Review','Slow-moving Review'),[
    f('itemCode','Item Code','text',{list:true}),f('warehouse','Warehouse','text',{list:true}),f('onHandQty','On-hand Qty','number',{list:true}),f('committedQty','Committed Qty','number'),f('reorderPoint','Reorder Point','number'),f('safetyStock','Safety Stock','number'),f('recommendedOrderQty','Recommended Order Qty','number',{list:true}),
  ],o('sd-demand-planning','ip-warehouse-management','ip-sourcing-purchasing'),o('Stock Availability','Reorder Recommendations','Aging Inventory'),o('Analyze Stock','Create Reorder Plan')),
  'ip-warehouse-management':p('movement','Warehouse Transaction','Warehouse Transactions','WH',o('Goods Receipt','Goods Issue','Stock Transfer','Bin Transfer','Stock Adjustment'),[
    f('warehouse','Warehouse','text',{list:true}),f('binLocation','Bin Location'),f('itemCode','Item Code','text',{list:true}),f('serialNo','Serial No.','text',{list:true}),f('quantity','Quantity','number',{list:true}),f('movementType','Movement Type','select',{options:o('IN','OUT','TRANSFER','ADJUSTMENT')}),f('destination','Destination'),
  ],o('ip-inbound-logistics','ip-cycle-counting','lm-order-warehouse'),o('Warehouse Stock','Movement Register','Bin Utilization'),o('Receive Stock','Issue Stock','Transfer Stock')),
  'ip-cycle-counting':p('inventory','Cycle Count','Cycle Counts','CC',o('Cycle Count Plan','Physical Count','Variance Review','Inventory Reconciliation'),[
    f('countPlanNo','Count Plan No.','text',{list:true}),f('warehouse','Warehouse','text',{list:true}),f('countDate','Count Date','date'),f('itemCode','Item Code','text',{list:true}),f('systemQty','System Qty','number'),f('countedQty','Counted Qty','number',{list:true}),f('varianceQty','Variance Qty','number',{list:true}),
  ],o('ip-warehouse-management','fa-general-accounting'),o('Count Variance','Count Completion','Inventory Adjustments'),o('Create Count Plan','Start Physical Count')),
  'ip-sourcing-purchasing':p('request','Purchase Request','Purchase Requests','PRC',o('Sourcing Request','Request for Quotation','Purchase Requisition','Purchase Order','Supplier Award'),[
    f('requestNo','Request / RFQ No.','text',{list:true}),f('supplier','Supplier','text',{list:true}),f('itemCode','Item Code'),f('quantity','Quantity','number',{list:true}),f('targetPrice','Target Price','number',{step:'0.01'}),f('requiredDate','Required Date','date',{list:true}),f('quotationCount','Quotation Count','number'),
  ],o('ip-supplier-portal','ip-inbound-logistics','fa-receivables-payables'),o('Open Purchase Requests','Supplier Comparison','Purchase Commitments'),o('Create Requisition','Request Quotations')),
  'ip-inbound-logistics':p('movement','Inbound Shipment','Inbound Shipments','IBS',o('Supplier Shipment','Import Shipment','Expected Receipt','Shipment Consolidation'),[
    f('shipmentReference','Shipment Reference','text',{required:true,list:true}),f('supplier','Supplier','text',{list:true}),f('containerNo','Container / AWB No.'),f('origin','Origin'),f('eta','Expected Arrival','date',{list:true}),f('actualArrival','Actual Arrival','date'),f('incoterm','Incoterm'),
  ],o('ip-supplier-portal','ip-warehouse-management','lm-transport'),o('Expected Shipments','Shipment Variance','Inbound Lead Time'),o('Create Expected Shipment','Record Arrival')),
  'ip-subcontracting':p('order','Subcontract Order','Subcontract Orders','SCO',o('Subcontract Request','Material Issue','Subcontract Work Order','Subcontract Receipt'),[
    f('vendor','Subcontractor','text',{list:true}),f('workOrderNo','Work Order No.','text',{list:true}),f('materialCode','Material Code'),f('issueQty','Issue Qty','number'),f('expectedReturnDate','Expected Return','date',{list:true}),f('receivedQty','Received Qty','number'),f('serviceRate','Service Rate','number',{step:'0.01'}),
  ],o('ip-warehouse-management','mf-work-orders','qm-inspection-sampling'),o('Materials at Vendor','Subcontract Aging','Vendor Performance'),o('Create Subcontract Order','Issue Materials')),
  'ip-supplier-portal':p('request','Supplier Submission','Supplier Submissions','SUP',o('Supplier Registration','Shipment Notice','Invoice Submission','Compliance Document','Quotation'),[
    f('supplierCode','Supplier Code','text',{list:true}),f('supplierName','Supplier Name','text',{list:true}),f('submissionType','Submission Type','select',{options:o('REGISTRATION','ASN','INVOICE','COMPLIANCE','QUOTATION')}),f('documentNo','Document No.'),f('expiryDate','Expiry Date','date',{list:true}),f('contactEmail','Contact Email'),
  ],o('ip-sourcing-purchasing','ip-inbound-logistics'),o('Supplier Submissions','Compliance Expiry','Supplier Response'),o('Register Supplier','Submit ASN')),

  'mf-estimation':p('planning','Production Estimate','Production Estimates','EST',o('Product Estimate','Service Estimate','Make-or-Buy Analysis','Cost Estimate'),[
    f('productCode','Product Code','text',{list:true}),f('bomVersion','BOM Version'),f('estimateQty','Estimate Qty','number',{list:true}),f('materialCost','Material Cost','number',{step:'0.01'}),f('laborHours','Labor Hours','number',{step:'0.01'}),f('overheadCost','Overhead Cost','number',{step:'0.01'}),f('unitCost','Estimated Unit Cost','number',{step:'0.01',list:true}),
  ],o('mf-planning','mf-costing','srp-proposal-estimation'),o('Estimate Summary','Cost Breakdown','Estimate Variance'),o('Create Estimate','Run Cost Estimate')),
  'mf-planning':p('planning','Production Plan','Production Plans','MPP',o('Master Production Plan','Material Requirement Plan','Capacity Plan','Supply Plan'),[
    f('planNo','Plan No.','text',{list:true}),f('productCode','Product Code'),f('plannedQty','Planned Qty','number',{list:true}),f('plannedStart','Planned Start','date'),f('plannedEnd','Planned End','date',{list:true}),f('workCenter','Work Center'),f('capacityUtilization','Capacity Utilization %','number',{step:'0.01',list:true}),
  ],o('sd-demand-planning','mf-work-orders','addon-planning-optimization'),o('Production Plan','Material Requirements','Capacity Utilization'),o('Create Production Plan','Run MRP')),
  'mf-work-orders':p('maintenance','Production Work Order','Production Work Orders','PWO',o('Assembly Work Order','Fabrication Work Order','Rework Order','Disassembly Order'),[
    f('workOrderNo','Work Order No.','text',{list:true}),f('productCode','Product Code','text',{list:true}),f('workCenter','Work Center'),f('orderQty','Order Qty','number',{list:true}),f('plannedStart','Planned Start','date'),f('plannedEnd','Planned End','date',{list:true}),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','CRITICAL')}),
  ],o('mf-planning','mf-scheduling','mf-execution'),o('Work Order Status','Production Backlog','Schedule Adherence'),o('Create Work Order','Release Work Order')),
  'mf-scheduling':p('planning','Production Schedule','Production Schedules','SCH',o('Work Center Schedule','Machine Schedule','Labor Schedule','Sequence Plan'),[
    f('resourceCode','Resource / Work Center','text',{list:true}),f('workOrderNo','Work Order No.','text',{list:true}),f('scheduleStart','Schedule Start','datetime-local'),f('scheduleEnd','Schedule End','datetime-local',{list:true}),f('durationHours','Duration Hours','number',{step:'0.25'}),f('sequenceNo','Sequence No.','number'),f('setupTime','Setup Time Hours','number',{step:'0.25'}),
  ],o('mf-work-orders','mf-execution','hcm-workforce-planning'),o('Resource Schedule','Capacity Load','Schedule Conflicts'),o('Create Schedule','Optimize Sequence')),
  'mf-execution':p('maintenance','Production Operation','Production Operations','MEX',o('Production Start','Operation Confirmation','Material Consumption','Output Receipt','Production Exception'),[
    f('workOrderNo','Work Order No.','text',{list:true}),f('operationNo','Operation No.'),f('shift','Shift','select',{options:o('DAY','NIGHT')}),f('goodQty','Good Qty','number',{list:true}),f('rejectQty','Reject Qty','number',{list:true}),f('operator','Operator'),f('completionDate','Completion Date','date'),
  ],o('mf-work-orders','qm-administration','ip-warehouse-management'),o('Production Output','Reject Rate','Work Order Progress'),o('Start Operation','Confirm Output')),
  'mf-costing':p('ledger','Product Cost','Product Costs','CST',o('Standard Cost','Actual Cost','Variance Calculation','Cost Roll-up'),[
    f('productCode','Product Code','text',{list:true}),f('costVersion','Cost Version'),f('costPeriod','Cost Period','month'),f('materialCost','Material Cost','number',{step:'0.01'}),f('laborCost','Labor Cost','number',{step:'0.01'}),f('overheadCost','Overhead Cost','number',{step:'0.01'}),f('totalUnitCost','Total Unit Cost','number',{step:'0.01',list:true}),
  ],o('mf-estimation','fa-management-accounting','sd-pim'),o('Product Cost Sheet','Cost Variance','Cost Roll-up'),o('Calculate Cost','Roll Up Standard Cost')),

  'qm-attributes':p('master','Quality Attribute','Quality Attributes','QAT',o('Specification Attribute','Test Method','Quality Characteristic','Tolerance Rule'),[
    f('itemCode','Item Code','text',{list:true}),f('attributeName','Attribute Name','text',{list:true}),f('dataType','Data Type','select',{options:o('NUMBER','TEXT','BOOLEAN','RANGE')}),f('lowerLimit','Lower Limit','number',{step:'0.01'}),f('upperLimit','Upper Limit','number',{step:'0.01'}),f('uom','Unit of Measure'),f('testMethod','Test Method'),
  ],o('qm-inspection-sampling','sd-pim'),o('Attribute Register','Specification Coverage','Tolerance Exceptions'),o('Create Attribute','Publish Specification')),
  'qm-inspection-sampling':p('quality','Inspection Plan','Inspection Plans','QIP',o('Incoming Inspection Plan','Process Inspection Plan','Final Inspection Plan','Sampling Plan'),[
    f('planCode','Plan Code','text',{list:true}),f('itemCode','Item Code','text',{list:true}),f('inspectionStage','Inspection Stage','select',{options:o('INCOMING','PROCESS','FINAL')}),f('sampleSize','Sample Size','number',{list:true}),f('frequency','Frequency'),f('testMethod','Test Method'),f('acceptanceLevel','Acceptance Level'),
  ],o('qm-attributes','qm-administration','ip-inbound-logistics'),o('Inspection Plans','Sampling Coverage','Inspection Load'),o('Create Inspection Plan','Schedule Inspection')),
  'qm-administration':p('quality','Quality Inspection','Quality Inspections','QIN',o('Incoming Inspection','Process Inspection','Final Inspection','Quality Incident'),[
    f('inspectionNo','Inspection No.','text',{list:true}),f('lotNo','Lot / Batch No.','text',{list:true}),f('itemCode','Item Code'),f('sampleQty','Sample Qty','number'),f('acceptedQty','Accepted Qty','number',{list:true}),f('rejectedQty','Rejected Qty','number',{list:true}),f('disposition','Disposition','select',{options:o('ACCEPT','REWORK','RETURN','SCRAP')}),
  ],o('qm-inspection-sampling','qm-acceptance-rejection','mf-execution'),o('Inspection Results','Defect Trend','Quality Incidents'),o('Record Inspection','Create Quality Incident')),
  'qm-acceptance-rejection':p('quality','Acceptance Decision','Acceptance & Rejection Decisions','QAR',o('Lot Acceptance','Lot Rejection','Deviation Approval','Supplier Return'),[
    f('lotNo','Lot / Batch No.','text',{list:true}),f('supplier','Supplier','text',{list:true}),f('inspectionNo','Inspection No.'),f('acceptedQty','Accepted Qty','number'),f('rejectedQty','Rejected Qty','number',{list:true}),f('reasonCode','Reason Code'),f('correctiveAction','Corrective Action','textarea'),
  ],o('qm-administration','ip-supplier-portal','sd-warranty-management'),o('Acceptance Rate','Rejected Lots','Supplier Quality'),o('Accept Lot','Reject Lot')),

  'pm-planning-budgeting':p('planning','Project Budget','Project Budgets','PBD',o('Project Budget','Project Forecast','Budget Revision','Funding Plan'),[
    f('projectCode','Project Code','text',{list:true}),f('budgetPeriod','Budget Period','month'),f('costCategory','Cost Category','text',{list:true}),f('originalBudget','Original Budget','number',{step:'0.01'}),f('revisedBudget','Revised Budget','number',{step:'0.01',list:true}),f('committedCost','Committed Cost','number',{step:'0.01'}),f('actualCost','Actual Cost','number',{step:'0.01'}),
  ],o('pm-definition','pm-tracking','fa-planning-budgeting'),o('Project Budget','Commitment Report','Cost Forecast'),o('Create Project Budget','Revise Budget')),
  'pm-definition':p('project','Project','Projects','PRJ',o('BSS Rollout Project','Facility Project','Technology Project','Customer Project','Internal Project'),[
    f('projectCode','Project Code','text',{required:true,list:true}),f('projectManager','Project Manager','text',{list:true}),f('sponsor','Sponsor'),f('businessUnit','Business Unit'),f('startDate','Start Date','date'),f('targetEndDate','Target End Date','date',{list:true}),f('siteLocation','Site / Location'),
  ],o('pm-planning-budgeting','pm-tracking','fm-site-administration'),o('Project Register','Project Portfolio','Project Governance'),o('Create Project','Approve Project Charter')),
  'pm-tracking':p('project','Project Milestone','Project Milestones','PMT',o('Milestone','Progress Update','Project Risk','Project Issue','Change Request'),[
    f('projectCode','Project Code','text',{list:true}),f('milestone','Milestone / Deliverable','text',{list:true}),f('percentComplete','Progress %','number',{min:'0',max:'100',list:true}),f('health','Health','select',{options:o('GREEN','AMBER','RED'),list:true}),f('dueDate','Due Date','date',{list:true}),f('riskOwner','Risk / Action Owner'),
  ],o('pm-definition','pm-closure','fm-work-reporting'),o('Project Progress','Milestone Status','Risk Register'),o('Update Progress','Create Change Request')),
  'pm-billing':p('ledger','Project Billing','Project Billings','PB',o('Milestone Billing','Time & Material Billing','Progress Billing','Retention Billing'),[
    f('projectCode','Project Code','text',{list:true}),f('customer','Customer','text',{list:true}),f('milestone','Billing Milestone'),f('billingPeriod','Billing Period','month'),f('invoiceNo','Invoice No.'),f('billableAmount','Billable Amount','number',{step:'0.01',list:true}),f('dueDate','Due Date','date',{list:true}),
  ],o('pm-tracking','fa-receivables-management','srp-billing-revenue'),o('Project Billing Register','Unbilled Revenue','Project Receivables'),o('Create Project Billing','Generate Invoice')),
  'pm-closure':p('project','Project Closure','Project Closures','PCL',o('Completion Review','Financial Closure','Contract Closure','Lessons Learned'),[
    f('projectCode','Project Code','text',{list:true}),f('closureDate','Closure Date','date',{list:true}),f('finalCost','Final Cost','number',{step:'0.01'}),f('finalRevenue','Final Revenue','number',{step:'0.01'}),f('acceptanceReference','Acceptance Reference'),f('lessonsLearned','Lessons Learned','textarea'),f('openItems','Open Items','number',{list:true}),
  ],o('pm-definition','pm-tracking','fa-consolidation-reporting'),o('Project Closure Status','Final Project Margin','Open Closure Items'),o('Start Closure','Approve Closure')),

  'eam-induction-setup':p('master','Equipment','Equipment Register','EQP',o('Motorcycle','Battery','BSS Equipment','Service Equipment','IT Equipment'),[
    f('equipmentCode','Equipment Code','text',{required:true,list:true}),f('serialNo','Serial No.','text',{required:true,list:true}),f('equipmentCategory','Equipment Category','text',{list:true}),f('model','Model'),f('location','Location','text',{list:true}),f('inServiceDate','In-service Date','date'),f('capacity','Capacity / Rating'),
  ],o('fa-fixed-assets','eam-preventive-maintenance','eam-equipment-rental'),o('Equipment Register','Equipment by Location','Asset Utilization'),o('Induct Equipment','Assign Location')),
  'eam-preventive-maintenance':p('maintenance','Maintenance Plan','Maintenance Plans','PMP',o('Time-based Plan','Meter-based Plan','Inspection Plan','Service Campaign'),[
    f('equipmentCode','Equipment Code','text',{list:true}),f('maintenancePlan','Maintenance Plan','text',{list:true}),f('frequency','Frequency'),f('lastServiceDate','Last Service Date','date'),f('nextDueDate','Next Due Date','date',{list:true}),f('assignedTeam','Assigned Team'),f('estimatedDurationHours','Estimated Duration Hours','number',{step:'0.25'}),
  ],o('eam-induction-setup','eam-work-management','sd-service-management'),o('Maintenance Due','Preventive Compliance','Maintenance Backlog'),o('Create Maintenance Plan','Generate Work Orders')),
  'eam-online-maintenance':p('maintenance','Maintenance Request','Maintenance Requests','MWR',o('Fault Report','Breakdown Request','Inspection Finding','Corrective Request'),[
    f('requestNo','Request No.','text',{list:true}),f('equipmentCode','Equipment Code','text',{list:true}),f('faultCode','Fault Code'),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','CRITICAL'),list:true}),f('reportedAt','Reported At','datetime-local'),f('downtimeHours','Downtime Hours','number',{step:'0.25',list:true}),f('reportedBy','Reported By'),
  ],o('eam-work-management','eam-reliability-review','sd-service-management'),o('Open Maintenance Requests','Breakdown Downtime','Response SLA'),o('Report Fault','Create Work Order')),
  'eam-shutdown-outage':p('project','Shutdown Plan','Shutdown & Outage Plans','OUT',o('Planned Shutdown','Emergency Outage','Maintenance Window','Restart Plan'),[
    f('outageNo','Outage No.','text',{list:true}),f('equipmentCode','Equipment / Site','text',{list:true}),f('outageType','Outage Type','select',{options:o('PLANNED','EMERGENCY','MAINTENANCE')}),f('startDateTime','Start','datetime-local'),f('endDateTime','End','datetime-local',{list:true}),f('scope','Scope','textarea'),f('restartOwner','Restart Owner'),
  ],o('eam-work-management','fm-site-administration','lm-command-center'),o('Outage Calendar','Shutdown Readiness','Outage Duration'),o('Create Shutdown Plan','Authorize Outage')),
  'eam-work-management':p('maintenance','Maintenance Work Order','Maintenance Work Orders','MWO',o('Corrective Work Order','Preventive Work Order','Inspection Work Order','Emergency Work Order'),[
    f('workOrderNo','Work Order No.','text',{list:true}),f('equipmentCode','Equipment / Location','text',{list:true}),f('taskDescription','Task Description','textarea'),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','CRITICAL'),list:true}),f('scheduledStart','Scheduled Start','datetime-local'),f('scheduledEnd','Scheduled End','datetime-local',{list:true}),f('assignedTeam','Assigned Team'),f('permitRequired','Permit Required','checkbox'),
  ],o('eam-online-maintenance','eam-preventive-maintenance','hcm-workforce'),o('Work Order Summary','Planned vs Unplanned','Maintenance Cost'),o('Create Work Order','Assign Resources')),
  'eam-reliability-review':p('planning','Reliability Review','Reliability Reviews','REL',o('Failure Analysis','Reliability Review','Root Cause Analysis','Improvement Action'),[
    f('equipmentCode','Equipment Code','text',{list:true}),f('failureMode','Failure Mode','text',{list:true}),f('mtbfHours','MTBF Hours','number',{step:'0.01'}),f('mttrHours','MTTR Hours','number',{step:'0.01'}),f('failureCount','Failure Count','number',{list:true}),f('rootCause','Root Cause','textarea'),f('recommendation','Recommendation','textarea'),
  ],o('eam-online-maintenance','eam-work-management','qm-administration'),o('Equipment Reliability','Failure Trend','MTBF / MTTR'),o('Start Reliability Review','Create Improvement Action')),
  'eam-equipment-rental':p('contract','Equipment Rental','Equipment Rentals','RNT',o('Rental Contract','Rental Dispatch','Rental Return','Rental Extension'),[
    f('equipmentCode','Equipment Code','text',{required:true,list:true}),f('customerCode','Customer Code','text',{list:true}),f('rentalLocation','Rental Location','text',{list:true}),f('rentalStartDate','Rental Start Date','date'),f('rentalEndDate','Rental End Date','date',{list:true}),f('rentalRate','Rental Rate','number',{step:'0.01'}),f('meterOut','Meter Out','number'),f('meterIn','Meter In','number'),
  ],o('eam-induction-setup','sd-lease-contract-management','lm-transport'),o('Rental Fleet','Rental Utilization','Rental Returns Due'),o('Create Rental','Locate Equipment')),

  'fm-assessment':p('quality','Facility Assessment','Facility Assessments','FAS',o('Site Assessment','Safety Assessment','Condition Survey','Compliance Inspection'),[
    f('siteCode','Site Code','text',{list:true}),f('assetArea','Asset / Area'),f('assessmentType','Assessment Type','text',{list:true}),f('inspectionDate','Inspection Date','date'),f('score','Assessment Score','number',{min:'0',max:'100',list:true}),f('riskLevel','Risk Level','select',{options:o('LOW','MEDIUM','HIGH','CRITICAL'),list:true}),f('finding','Finding','textarea'),
  ],o('fm-site-administration','fm-work-reporting','qm-administration'),o('Facility Condition','Assessment Findings','Critical Risks'),o('Create Assessment','Raise Work Request')),
  'fm-quotation':p('order','Facility Quotation','Facility Quotations','FQT',o('Service Quotation','Project Quotation','Maintenance Quotation','Variation Quotation'),[
    f('quotationNo','Quotation No.','text',{list:true}),f('customer','Customer','text',{list:true}),f('siteCode','Site Code'),f('scope','Scope of Work','textarea'),f('validUntil','Valid Until','date',{list:true}),f('laborAmount','Labor Amount','number',{step:'0.01'}),f('materialAmount','Material Amount','number',{step:'0.01'}),
  ],o('fm-contracts','srp-proposal-estimation','sd-order-management'),o('Quotation Register','Quotation Conversion','Quotation Margin'),o('Create Quotation','Convert to Contract')),
  'fm-contracts':p('contract','Facility Contract','Facility Contracts','FMC',o('Maintenance Contract','Facility Management Contract','Service Level Agreement','Contract Amendment'),[
    f('contractNo','Contract No.','text',{list:true}),f('customer','Customer','text',{list:true}),f('siteCode','Site Code','text',{list:true}),f('contractStart','Contract Start','date'),f('contractEnd','Contract End','date',{list:true}),f('sla','Service Level Agreement'),f('contractManager','Contract Manager'),
  ],o('fm-quotation','fm-site-administration','lm-contracting-billing'),o('Active Facility Contracts','SLA Performance','Contract Expiry'),o('Create Contract','Create SLA')),
  'fm-site-administration':p('master','Facility Site','Facility Sites','SITE',o('BSS Site','Warehouse','Service Center','Office','Customer Site'),[
    f('siteCode','Site Code','text',{required:true,list:true}),f('siteName','Site Name','text',{list:true}),f('address','Address','textarea'),f('siteManager','Site Manager'),f('siteType','Site Type','select',{options:o('BSS','WAREHOUSE','SERVICE_CENTER','OFFICE','CUSTOMER_SITE')}),f('capacity','Capacity','number',{list:true}),f('operationalStatus','Operational Status','select',{options:o('PLANNED','ACTIVE','SUSPENDED','CLOSED'),list:true}),
  ],o('pm-definition','eam-induction-setup','lm-hub-management'),o('Site Register','Site Capacity','Site Status'),o('Create Site','Activate Site')),
  'fm-resource-allocation':p('planning','Resource Allocation','Resource Allocations','RAL',o('People Allocation','Equipment Allocation','Space Allocation','Shift Allocation'),[
    f('siteCode','Site / Project','text',{list:true}),f('resourceType','Resource Type','select',{options:o('EMPLOYEE','CONTRACTOR','EQUIPMENT','SPACE'),list:true}),f('resourceCode','Resource Code','text',{list:true}),f('skill','Skill / Capability'),f('quantity','Quantity','number'),f('allocationStart','Allocation Start','date'),f('allocationEnd','Allocation End','date',{list:true}),
  ],o('fm-site-administration','hcm-workforce','eam-induction-setup'),o('Resource Allocation','Capacity Utilization','Allocation Conflicts'),o('Allocate Resource','Rebalance Resources')),
  'fm-work-reporting':p('maintenance','Facility Work Report','Facility Work Reports','FWR',o('Daily Work Report','Maintenance Report','Site Visit Report','Incident Report'),[
    f('siteCode','Site Code','text',{list:true}),f('workOrderNo','Work Order No.','text',{list:true}),f('workPerformed','Work Performed','textarea'),f('laborHours','Labor Hours','number',{step:'0.25'}),f('materialsUsed','Materials Used','textarea'),f('percentComplete','Completion %','number',{min:'0',max:'100',list:true}),f('reportedBy','Reported By'),
  ],o('fm-site-administration','eam-work-management','pm-tracking'),o('Daily Work Reports','Work Completion','Labor Utilization'),o('Create Work Report','Complete Work')),

  'lm-transport':p('movement','Transport Trip','Transport Trips','TRP',o('Pickup Trip','Delivery Trip','Transfer Trip','Return Trip'),[
    f('tripNo','Trip No.','text',{list:true}),f('route','Route','text',{list:true}),f('vehicleNo','Vehicle No.','text',{list:true}),f('driver','Driver'),f('carrier','Carrier'),f('pickupDateTime','Pickup','datetime-local'),f('deliveryDateTime','Delivery','datetime-local',{list:true}),f('distanceKm','Distance Km','number',{step:'0.1'}),
  ],o('sd-outbound-logistics','ip-inbound-logistics','lm-fleet-management'),o('Transport Plan','Delivery Performance','Transport Cost'),o('Create Trip','Assign Vehicle')),
  'lm-order-warehouse':p('order','Warehouse Order','Warehouse Orders','WHO',o('Picking Order','Packing Order','Staging Order','Dispatch Order'),[
    f('warehouseOrderNo','Warehouse Order No.','text',{list:true}),f('salesOrderNo','Sales Order No.','text',{list:true}),f('warehouse','Warehouse','text',{list:true}),f('waveNo','Wave No.'),f('pickStatus','Pick Status','select',{options:o('OPEN','PICKING','PICKED','STAGED','DISPATCHED'),list:true}),f('picker','Picker'),f('stagingArea','Staging Area'),
  ],o('sd-order-management','ip-warehouse-management','lm-transport'),o('Order Picking','Warehouse Throughput','Staging Status'),o('Create Picking Wave','Confirm Staging')),
  'lm-hub-management':p('master','Logistics Hub','Logistics Hubs','HUB',o('Distribution Hub','Cross-dock Hub','BSS Hub','Service Hub'),[
    f('hubCode','Hub Code','text',{required:true,list:true}),f('hubName','Hub Name','text',{list:true}),f('location','Location','text',{list:true}),f('hubManager','Hub Manager'),f('capacity','Capacity','number'),f('utilizationPct','Utilization %','number',{step:'0.01',list:true}),f('operatingHours','Operating Hours'),
  ],o('lm-order-warehouse','fm-site-administration','lm-command-center'),o('Hub Capacity','Hub Throughput','Hub Utilization'),o('Create Hub','Update Capacity')),
  'lm-command-center':p('request','Logistics Alert','Logistics Alerts','LCC',o('Shipment Alert','Delivery Exception','Capacity Alert','Route Incident','Inventory Alert'),[
    f('alertNo','Alert No.','text',{list:true}),f('alertType','Alert Type','select',{options:o('SHIPMENT','DELIVERY','CAPACITY','ROUTE','INVENTORY'),list:true}),f('referenceNo','Reference No.'),f('severity','Severity','select',{options:o('INFO','WARNING','HIGH','CRITICAL'),list:true}),f('location','Location'),f('detectedAt','Detected At','datetime-local'),f('resolution','Resolution','textarea'),
  ],o('lm-transport','lm-order-warehouse','ip-inbound-logistics'),o('Open Logistics Alerts','Delivery Exceptions','Network Performance'),o('Create Alert','Resolve Exception')),
  'lm-contracting-billing':p('contract','Logistics Contract','Logistics Contracts & Billings','LCB',o('Carrier Contract','Rate Agreement','Freight Bill','Service Charge'),[
    f('carrier','Carrier / Service Provider','text',{list:true}),f('contractNo','Contract No.','text',{list:true}),f('rateType','Rate Type','select',{options:o('PER_TRIP','PER_KM','PER_UNIT','FLAT_RATE')}),f('effectiveDate','Effective Date','date'),f('expiryDate','Expiry Date','date',{list:true}),f('billingPeriod','Billing Period','month'),f('chargeAmount','Charge Amount','number',{step:'0.01',list:true}),
  ],o('lm-transport','fa-receivables-payables','srp-rates-contracts'),o('Carrier Contracts','Freight Billing','Rate Variance'),o('Create Rate Agreement','Generate Freight Bill')),
  'lm-fleet-management':p('maintenance','Fleet Vehicle','Fleet Vehicles','FLT',o('Vehicle Registration','Vehicle Assignment','Fuel Log','Service Schedule','Vehicle Incident'),[
    f('vehicleNo','Vehicle / Plate No.','text',{required:true,list:true}),f('vehicleType','Vehicle Type','text',{list:true}),f('assignedDriver','Assigned Driver'),f('currentLocation','Current Location','text',{list:true}),f('odometerKm','Odometer Km','number'),f('nextServiceDate','Next Service Date','date',{list:true}),f('registrationExpiry','Registration Expiry','date'),
  ],o('lm-transport','eam-preventive-maintenance','hcm-workforce'),o('Fleet Register','Vehicle Utilization','Service Due'),o('Register Vehicle','Schedule Service')),

  'hcm-workforce':p('people','Employee','Employees','EMP',o('Employee Record','Employee Assignment','Transfer','Promotion','Separation'),[
    f('employeeNo','Employee No.','text',{required:true,list:true}),f('position','Position','text',{list:true}),f('departmentCode','Department','text',{list:true}),f('manager','Manager'),f('employmentType','Employment Type','select',{options:o('REGULAR','PROBATIONARY','CONTRACT','CONSULTANT')}),f('hireDate','Hire Date','date'),f('workLocation','Work Location'),
  ],o('hcm-talent','hcm-development','hcm-payroll-benefits'),o('Employee Register','Headcount by Department','Employee Movement'),o('Create Employee','Transfer Employee')),
  'hcm-recruitment':p('people','Candidate Application','Candidate Applications','REC',o('Job Requisition','Candidate Application','Interview','Job Offer','Onboarding'),[
    f('requisitionNo','Requisition No.','text',{list:true}),f('position','Position','text',{list:true}),f('candidateName','Candidate Name','text',{list:true}),f('recruitmentStage','Stage','select',{options:o('SOURCING','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED'),list:true}),f('interviewDate','Interview Date','date'),f('recruiter','Recruiter'),f('expectedStartDate','Expected Start','date'),
  ],o('hcm-workforce','hcm-workforce-planning'),o('Recruitment Pipeline','Time to Fill','Open Requisitions'),o('Create Requisition','Add Candidate')),
  'hcm-talent':p('people','Talent Review','Talent Reviews','TLT',o('Performance Goal','Performance Review','Succession Plan','Talent Calibration'),[
    f('employeeNo','Employee No.','text',{list:true}),f('reviewPeriod','Review Period','text',{list:true}),f('goal','Goal / Competency','textarea'),f('rating','Rating','number',{min:'1',max:'5',step:'0.1',list:true}),f('potential','Potential','select',{options:o('LOW','MEDIUM','HIGH')}),f('successorReadiness','Successor Readiness'),f('reviewer','Reviewer'),
  ],o('hcm-workforce','hcm-development'),o('Performance Ratings','Talent Matrix','Succession Coverage'),o('Create Goal','Start Talent Review')),
  'hcm-development':p('people','Development Plan','Development Plans','DEV',o('Training Request','Development Plan','Certification','Learning Completion'),[
    f('employeeNo','Employee No.','text',{list:true}),f('programName','Program / Course','text',{list:true}),f('provider','Provider'),f('startDate','Start Date','date'),f('endDate','End Date','date',{list:true}),f('developmentStatus','Learning Status','select',{options:o('PLANNED','ENROLLED','IN_PROGRESS','COMPLETED')}),f('certificationExpiry','Certification Expiry','date'),
  ],o('hcm-workforce','hcm-talent'),o('Learning Plan','Training Completion','Certification Expiry'),o('Create Development Plan','Record Completion')),
  'hcm-payroll-benefits':p('ledger','Payroll Run','Payroll & Benefit Runs','PAY',o('Payroll Run','Allowance','Deduction','Benefit Enrollment','Final Pay'),[
    f('employeeNo','Employee No.','text',{list:true}),f('payPeriod','Pay Period','text',{list:true}),f('basicPay','Basic Pay','number',{step:'0.01'}),f('allowances','Allowances','number',{step:'0.01'}),f('deductions','Deductions','number',{step:'0.01'}),f('netPay','Net Pay','number',{step:'0.01',list:true}),f('paymentDate','Payment Date','date',{list:true}),
  ],o('hcm-workforce','fa-general-accounting'),o('Payroll Register','Benefit Cost','Payroll Variance'),o('Create Payroll Run','Post Payroll')),
  'hcm-workforce-planning':p('planning','Workforce Plan','Workforce Plans','WFP',o('Headcount Plan','Hiring Plan','Shift Plan','Capacity Plan'),[
    f('departmentCode','Department','text',{list:true}),f('roleTitle','Role / Position','text',{list:true}),f('currentHeadcount','Current Headcount','number'),f('requiredHeadcount','Required Headcount','number',{list:true}),f('headcountGap','Headcount Gap','number',{list:true}),f('planStartDate','Plan Start','date'),f('priority','Priority','select',{options:o('LOW','NORMAL','HIGH','CRITICAL')}),
  ],o('hcm-recruitment','fm-resource-allocation','mf-scheduling'),o('Headcount Plan','Workforce Gap','Hiring Forecast'),o('Create Workforce Plan','Raise Job Requisition')),

  'srp-proposal-estimation':p('order','Proposal','Proposals & Estimates','PROP',o('Sales Proposal','Service Proposal','Project Estimate','Commercial Offer'),[
    f('opportunityNo','Opportunity No.','text',{list:true}),f('client','Client','text',{list:true}),f('proposalScope','Scope','textarea'),f('probabilityPct','Probability %','number',{min:'0',max:'100',list:true}),f('validUntil','Valid Until','date',{list:true}),f('estimatedCost','Estimated Cost','number',{step:'0.01'}),f('estimatedMarginPct','Estimated Margin %','number',{step:'0.01'}),
  ],o('sd-crm','srp-rates-contracts','srp-sow-project'),o('Proposal Pipeline','Win Probability','Proposal Margin'),o('Create Proposal','Convert to SOW')),
  'srp-rates-contracts':p('contract','Rate Contract','Rate Contracts','RATE',o('Rate Card','Resource Rate','Service Rate','Contract Amendment'),[
    f('client','Client','text',{list:true}),f('rateCardNo','Rate Card No.','text',{list:true}),f('resourceRole','Resource / Service Role'),f('rateBasis','Rate Basis','select',{options:o('HOURLY','DAILY','MONTHLY','FIXED')}),f('rateAmount','Rate Amount','number',{step:'0.01',list:true}),f('effectiveDate','Effective Date','date'),f('expiryDate','Expiry Date','date',{list:true}),
  ],o('srp-proposal-estimation','srp-timesheet','srp-billing-revenue'),o('Rate Card Register','Contract Expiry','Rate Comparison'),o('Create Rate Card','Renew Contract')),
  'srp-sow-project':p('project','Statement of Work','Statements of Work','SOW',o('Statement of Work','Work Package','Change Order','SOW Acceptance'),[
    f('sowNo','SOW No.','text',{required:true,list:true}),f('client','Client','text',{list:true}),f('projectManager','Project Manager'),f('scope','Scope / Deliverables','textarea'),f('startDate','Start Date','date'),f('endDate','End Date','date',{list:true}),f('contractValue','Contract Value','number',{step:'0.01',list:true}),
  ],o('srp-proposal-estimation','srp-timesheet','srp-billing-revenue'),o('SOW Register','Deliverable Status','SOW Margin'),o('Create SOW','Create Work Package')),
  'srp-timesheet':p('people','Timesheet','Timesheets','TS',o('Regular Time','Overtime','Project Time','Non-billable Time'),[
    f('employeeNo','Employee No.','text',{list:true}),f('projectCode','Project / SOW','text',{list:true}),f('workDate','Work Date','date',{list:true}),f('activity','Activity'),f('hours','Hours','number',{min:'0',max:'24',step:'0.25',list:true}),f('billable','Billable','checkbox'),f('approver','Approver'),
  ],o('srp-sow-project','srp-billing-revenue','hcm-payroll-benefits'),o('Timesheet Register','Billable Utilization','Missing Timesheets'),o('Enter Timesheet','Submit Week')),
  'srp-expense':p('ledger','Expense Claim','Expense Claims','EXP',o('Travel Expense','Project Expense','Reimbursement','Cash Advance Liquidation'),[
    f('employeeNo','Employee No.','text',{list:true}),f('projectCode','Project / Cost Center','text',{list:true}),f('expenseDate','Expense Date','date',{list:true}),f('expenseCategory','Expense Category','text',{list:true}),f('receiptNo','Receipt No.'),f('taxAmount','Tax Amount','number',{step:'0.01'}),f('reimbursable','Reimbursable','checkbox'),
  ],o('srp-sow-project','fa-receivables-payables','hcm-payroll-benefits'),o('Expense Register','Project Expenses','Reimbursement Status'),o('Create Expense Claim','Submit Liquidation')),
  'srp-billing-revenue':p('ledger','Billing Document','Billing & Revenue Documents','BR',o('Customer Invoice','Revenue Recognition','Credit Note','Billing Adjustment'),[
    f('client','Client','text',{list:true}),f('projectCode','Project / SOW','text',{list:true}),f('invoiceNo','Invoice No.','text',{list:true}),f('billingPeriod','Billing Period','month'),f('billingBasis','Billing Basis','select',{options:o('MILESTONE','TIME_MATERIAL','FIXED_FEE','USAGE')}),f('recognizedRevenue','Recognized Revenue','number',{step:'0.01',list:true}),f('dueDate','Due Date','date',{list:true}),
  ],o('srp-sow-project','srp-timesheet','fa-receivables-management'),o('Billing Register','Revenue Recognition','Unbilled Revenue'),o('Generate Invoice','Recognize Revenue')),
  'srp-budgets':p('planning','Service Project Budget','Service Project Budgets','SBUD',o('SOW Budget','Resource Budget','Expense Budget','Revenue Forecast'),[
    f('projectCode','Project / SOW','text',{list:true}),f('budgetPeriod','Budget Period','month'),f('costCategory','Cost Category','text',{list:true}),f('budgetAmount','Budget Amount','number',{step:'0.01'}),f('forecastAmount','Forecast Amount','number',{step:'0.01',list:true}),f('actualAmount','Actual Amount','number',{step:'0.01'}),f('varianceAmount','Variance','number',{step:'0.01',list:true}),
  ],o('srp-sow-project','srp-resource-bench','fa-planning-budgeting'),o('Project Budget','Budget Variance','Revenue Forecast'),o('Create Project Budget','Revise Forecast')),
  'srp-resource-bench':p('planning','Resource Availability','Resource & Bench Plans','BENCH',o('Resource Availability','Bench Assignment','Project Allocation','Skill Match'),[
    f('employeeNo','Employee / Resource No.','text',{list:true}),f('primarySkill','Primary Skill','text',{list:true}),f('availabilityPct','Availability %','number',{min:'0',max:'100',list:true}),f('availableFrom','Available From','date',{list:true}),f('availableTo','Available To','date'),f('targetProject','Target Project'),f('billingRate','Billing Rate','number',{step:'0.01'}),
  ],o('srp-sow-project','hcm-workforce','fm-resource-allocation'),o('Bench Register','Resource Utilization','Skill Availability'),o('Add Resource Availability','Match to Project')),

  'tool-advanced-reporting':p('configuration','Report Definition','Advanced Reports','RPT',o('Operational Report','Financial Report','Management Report','Exception Report'),[
    f('reportName','Report Name','text',{required:true,list:true}),f('dataSource','Data Source / Module','text',{list:true}),f('reportType','Report Type','select',{options:o('TABLE','SUMMARY','CHART','PIVOT')}),f('dateField','Date Field'),f('filterDefinition','Filters','textarea'),f('columnDefinition','Columns / Measures','textarea'),f('schedule','Delivery Schedule'),
  ],o('addon-analytics','tool-data-uploads'),o('Report Catalog','Scheduled Reports','Report Usage'),o('Create Report','Run Report')),
  'tool-wizard-interface':p('configuration','Wizard','Wizard Interfaces','WIZ',o('Transaction Wizard','Setup Wizard','Import Wizard','Approval Wizard'),[
    f('wizardName','Wizard Name','text',{required:true,list:true}),f('targetModule','Target Module','text',{list:true}),f('stepCount','Step Count','number',{list:true}),f('entryRole','Allowed Role'),f('completionAction','Completion Action'),f('validationRules','Validation Rules','textarea'),f('helpText','User Guidance','textarea'),
  ],o('tool-embedded-workflow','addon-extension-toolkit'),o('Wizard Catalog','Wizard Completion','Wizard Errors'),o('Create Wizard','Test Wizard')),
  'tool-embedded-workflow':p('configuration','Workflow','Embedded Workflows','WF',o('Approval Workflow','Notification Workflow','Escalation Workflow','Automation Rule'),[
    f('workflowName','Workflow Name','text',{required:true,list:true}),f('targetModule','Target Module','text',{list:true}),f('triggerEvent','Trigger Event'),f('approvalLevels','Approval Levels','number'),f('conditionExpression','Conditions','textarea'),f('escalationHours','Escalation Hours','number'),f('notificationRecipients','Recipients'),
  ],o('tool-wizard-interface','addon-soa-collaboration'),o('Workflow Catalog','Pending Workflow Items','Workflow SLA'),o('Create Workflow','Activate Workflow')),
  'tool-data-uploads':p('request','Data Upload Job','Data Upload Jobs','UPL',o('Master Data Upload','Opening Balance Upload','Transaction Upload','Correction Upload'),[
    f('uploadName','Upload Name','text',{required:true,list:true}),f('targetModule','Target Module','text',{list:true}),f('templateType','Template Type'),f('fileName','File Name'),f('rowCount','Row Count','number',{list:true}),f('validRows','Valid Rows','number'),f('errorRows','Error Rows','number',{list:true}),
  ],o('tool-advanced-reporting','addon-extension-toolkit'),o('Upload History','Validation Errors','Upload Reconciliation'),o('Create Upload Job','Validate File')),

  'addon-analytics':p('configuration','Analytics View','Analytics Views','ANL',o('KPI Dashboard','Trend Analysis','Variance Analysis','Predictive View'),[
    f('viewName','Analytics View Name','text',{required:true,list:true}),f('sourceModule','Source Module','text',{list:true}),f('measure','Measure'),f('dimension','Dimension'),f('chartType','Chart Type','select',{options:o('BAR','LINE','PIE','TABLE','SCORECARD')}),f('refreshFrequency','Refresh Frequency'),f('ownerRole','Owner Role'),
  ],o('tool-advanced-reporting','addon-planning-optimization'),o('Analytics Catalog','KPI Performance','Dashboard Usage'),o('Create Analytics View','Refresh Analytics')),
  'addon-mobility':p('configuration','Mobile Workspace','Mobile Workspaces','MOB',o('Field Sales App','Inventory Inquiry','Order Approval','Work Progress','Inspection App','Fault Reporting'),[
    f('workspaceName','Mobile Workspace Name','text',{required:true,list:true}),f('targetModule','Target Module','text',{list:true}),f('mobileAction','Mobile Action'),f('offlineEnabled','Offline Enabled','checkbox'),f('locationEnabled','Location Enabled','checkbox'),f('deviceRole','Allowed Device Role'),f('syncFrequency','Sync Frequency'),
  ],o('sd-order-management','lm-transport','eam-work-management'),o('Mobile Workspace Catalog','Mobile Sync Status','Mobile Transactions'),o('Create Mobile Workspace','Publish to Mobile')),
  'addon-extension-toolkit':p('configuration','Extension','Extensions','EXT',o('Custom Field','Business Rule','UI Extension','API Extension'),[
    f('extensionName','Extension Name','text',{required:true,list:true}),f('targetModule','Target Module','text',{list:true}),f('extensionType','Extension Type','select',{options:o('CUSTOM_FIELD','BUSINESS_RULE','UI','API')}),f('version','Version'),f('developer','Developer'),f('sourceReference','Source Reference'),f('testStatus','Test Status','select',{options:o('NOT_TESTED','PASSED','FAILED'),list:true}),
  ],o('tool-wizard-interface','addon-soa-collaboration'),o('Extension Catalog','Deployment Status','Extension Errors'),o('Create Extension','Deploy Extension')),
  'addon-esignature':p('request','Signature Envelope','Signature Envelopes','ESG',o('Contract Signature','Approval Signature','Acknowledgment','Certificate'),[
    f('envelopeNo','Envelope No.','text',{list:true}),f('documentType','Document Type','text',{list:true}),f('documentReference','Document Reference'),f('signerName','Signer Name','text',{list:true}),f('signerEmail','Signer Email'),f('sentDate','Sent Date','date'),f('expiryDate','Expiry Date','date',{list:true}),
  ],o('sd-lease-contract-management','fm-contracts','srp-sow-project'),o('Signature Envelopes','Pending Signatures','Signature Turnaround'),o('Create Envelope','Send for Signature')),
  'addon-device-integration':p('configuration','Device Connection','Device Connections','DEVX',o('BSS Device','GPS Tracker','QR Scanner','IoT Sensor','Payment Device'),[
    f('deviceId','Device ID','text',{required:true,list:true}),f('deviceType','Device Type','select',{options:o('BSS','GPS','QR_SCANNER','IOT_SENSOR','PAYMENT')}),f('assignedAsset','Assigned Asset / Site','text',{list:true}),f('endpoint','Endpoint / Topic'),f('lastSeenAt','Last Seen At','datetime-local',{list:true}),f('firmwareVersion','Firmware Version'),f('connectionStatus','Connection Status','select',{options:o('ONLINE','OFFLINE','ERROR'),list:true}),
  ],o('eam-induction-setup','fm-site-administration','addon-soa-collaboration'),o('Device Register','Online Devices','Device Alerts'),o('Register Device','Test Connection')),
  'addon-soa-collaboration':p('configuration','Integration Service','Integration Services','SOA',o('API Service','Webhook','Scheduled Integration','Partner Connection'),[
    f('serviceName','Service Name','text',{required:true,list:true}),f('partnerSystem','Partner System','text',{list:true}),f('integrationType','Integration Type','select',{options:o('REST_API','WEBHOOK','SCHEDULED','FILE')}),f('endpoint','Endpoint'),f('authenticationType','Authentication Type'),f('lastRunAt','Last Run At','datetime-local',{list:true}),f('lastResult','Last Result','select',{options:o('SUCCESS','WARNING','FAILED'),list:true}),
  ],o('addon-device-integration','tool-data-uploads'),o('Integration Catalog','Integration Runs','Integration Errors'),o('Create Integration','Test Integration')),
  'addon-planning-optimization':p('planning','Optimization Scenario','Optimization Scenarios','OPT',o('Demand & Supply Plan','Production Schedule Optimization','Transport Optimization','Warehouse Optimization','Maintenance Schedule Optimization'),[
    f('scenarioName','Scenario Name','text',{required:true,list:true}),f('optimizationArea','Optimization Area','select',{options:o('DEMAND_SUPPLY','PRODUCTION','TRANSPORT','WAREHOUSE','MAINTENANCE'),list:true}),f('planningHorizon','Planning Horizon'),f('objective','Optimization Objective'),f('constraintDefinition','Constraints','textarea'),f('baselineCost','Baseline Cost','number',{step:'0.01'}),f('optimizedCost','Optimized Cost','number',{step:'0.01',list:true}),
  ],o('sd-demand-planning','mf-planning','lm-transport','ip-warehouse-management','eam-work-management'),o('Optimization Scenarios','Savings Opportunity','Constraint Violations'),o('Create Scenario','Run Optimization')),
};

export function definitionFor(module) {
  const profile = MODULE_PROFILES[module.code];
  if (!profile) throw new Error(`Missing functional definition for ${module.code}`);
  const defaults = KIND_DEFAULTS[profile.kind];
  const workflow = WORKFLOWS[defaults.workflow];
  return {
    ...module,
    ...defaults,
    ...profile,
    workflow,
    statusLabels:Object.fromEntries(workflow.stages.map(status => [status, status.replaceAll('_',' ')])),
  };
}

export const MODULE_PROFILE_COUNT = Object.keys(MODULE_PROFILES).length;
