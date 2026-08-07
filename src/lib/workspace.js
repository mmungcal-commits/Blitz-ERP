import { all } from './db.js';

const item = (code, label, permission, action = 'VIEW') => ({ code, label, permission, action });

export const WORKSPACE_GROUPS = [
  { code:'fa', title:'Finance & Accounting', items:[
    item('fa-general-accounting','General Accounting','FINANCE'),
    item('fa-receivables-payables','Receivables & Payables Mgmt.','FINANCE'),
    item('fa-receivables-management','Receivables Management','RECEIVABLES'),
    item('fa-fixed-assets','Fixed Assets Management','FINANCE'),
    item('fa-management-accounting','Management Accounting','FINANCE'),
    item('fa-consolidation-reporting','Consolidation & Reporting','FINANCE'),
    item('fa-financial-services','Financial Services','FINANCE'),
    item('fa-planning-budgeting','Planning & Budgeting','FINANCE'),
    item('fa-grants-funds','Grants & Funds Management','FINANCE'),
    item('ip-supplier-portal','Vendor Accreditation','FINANCE'),
  ]},
  { code:'sd', title:'Sales & Distribution', items:[
    item('sd-crm','CRM','CUSTOMERS'),
    item('sd-order-management','Order Management','SALES'),
    item('sd-lease-contract-management','Lease Contract Management','SALES'),
    item('sd-outbound-logistics','Outbound Logistics','DELIVERIES'),
    item('sd-warranty-management','Warranty Management','RETURNS'),
    item('sd-service-management','Service Management','CUSTOMERS'),
    item('sd-pim','PIM','INVENTORY'),
    item('sd-customer-portal','Customer Portal','CUSTOMERS'),
  ]},
  { code:'ip', title:'Inventory & Procurement', items:[
    item('ip-inbound-logistics','Inbound Logistics','SHIPMENTS'),
    item('ip-warehouse-management','Warehouse Management','INVENTORY'),
    item('ip-cycle-counting','Inventory & Cycle Counting','INVENTORY'),
    item('ip-inventory-analysis','Reports','INVENTORY'),
  ]},
  { code:'mf', title:'Manufacturing', items:[
    item('mf-estimation','Estimation','PLANNING'),
    item('mf-planning','Planning','PLANNING'),
    item('mf-work-orders','Work Order Management','PLANNING'),
    item('mf-scheduling','Scheduling','PLANNING'),
    item('mf-execution','Manufacturing Execution','RECEIVING'),
    item('mf-costing','Costing','PLANNING'),
  ]},
  { code:'qm', title:'Quality Management', items:[
    item('qm-attributes','Attribute Management','INVENTORY'),
    item('qm-inspection-sampling','Inspection & Sampling Plans','RECEIVING'),
    item('qm-administration','Quality Administration','DELIVERIES'),
    item('qm-acceptance-rejection','Acceptance & Rejection analysis','RETURNS'),
  ]},
  { code:'pm', title:'Project Management', items:[
    item('pm-planning-budgeting','Planning & Budgeting','PLANNING'),
    item('pm-definition','Project Definition','STATIONS'),
    item('pm-tracking','Project Planning & Tracking','STATIONS'),
    item('pm-billing','Billing','SALES'),
    item('pm-closure','Project Closure','STATIONS'),
  ]},
  { code:'eam', title:'Enterprise Asset Management', items:[
    item('eam-induction-setup','Equipment Induction & Setup','INVENTORY'),
    item('eam-preventive-maintenance','Preventive Maintenance','INVENTORY'),
    item('eam-online-maintenance','Online Maintenance','RETURNS'),
    item('eam-shutdown-outage','Shutdown / Outage Mgmt.','STATIONS'),
    item('eam-work-management','Work Management','STATIONS'),
    item('eam-reliability-review','Reliability & Review','RETURNS'),
    item('eam-equipment-rental','Equipment Rental Mgmt.','SALES'),
  ]},
  { code:'fm', title:'Facility Management', items:[
    item('fm-assessment','Assessment','STATIONS'),
    item('fm-quotation','Quotation','SALES'),
    item('fm-contracts','Contract Mgmt','SALES'),
    item('fm-site-administration','Site Administration','STATIONS'),
    item('fm-resource-allocation','Resource Allocation','STATIONS'),
    item('fm-work-reporting','Work Reporting','STATIONS'),
  ]},
  { code:'lm', title:'Logistics Management', items:[
    item('lm-transport','Transport Management','DELIVERIES'),
    item('lm-order-warehouse','Order & Warehouse Management','SHIPMENTS'),
    item('lm-hub-management','Hub Management','INVENTORY'),
    item('lm-command-center','Logistics Command center','DASHBOARD'),
    item('lm-contracting-billing','Contracting and Billing','SALES'),
    item('lm-fleet-management','Fleet Management','INVENTORY'),
  ]},
  { code:'hcm', title:'HCM', items:[
    item('hcm-workforce','Workforce Management','ADMIN'),
    item('hcm-recruitment','Recruitment','ADMIN'),
    item('hcm-talent','Talent Management','ADMIN'),
    item('hcm-development','Employee Development','ADMIN'),
    item('hcm-payroll-benefits','Payroll & Benefits','ADMIN'),
    item('hcm-workforce-planning','Work Force Planning','ADMIN'),
  ]},
  { code:'srp', title:'SRP', items:[
    item('srp-proposal-estimation','Proposal & Estimation','SALES'),
    item('srp-rates-contracts','Rates & Contract Mgmt','SALES'),
    item('srp-sow-project','SOW /Project Mgmt','SALES'),
    item('srp-timesheet','Timesheet Mgmt','PLANNING'),
    item('srp-expense','Expense Mgmt','PLANNING'),
    item('srp-billing-revenue','Billing & Revenue Mgmt','SALES'),
    item('srp-budgets','Budgets','PLANNING'),
    item('srp-resource-bench','Resource & Bench Mgmt','PLANNING'),
  ]},
];

export const WORKSPACE_TOOLS = [
  item('tool-advanced-reporting','Advanced Reporting','DASHBOARD'),
  item('tool-wizard-interface','Wizard Interface','ADMIN'),
  item('tool-embedded-workflow','Embedded Workflow','ADMIN'),
  item('tool-data-uploads','Data Uploads','ADMIN'),
];

export const WORKSPACE_ADDONS = [
  item('addon-analytics','Analytics','DASHBOARD'),
  item('addon-mobility','Mobility','ADMIN'),
  item('addon-extension-toolkit','Extension Toolkit','ADMIN'),
  item('addon-esignature','eSignature','ADMIN'),
  item('addon-device-integration','Device Integration','ADMIN'),
  item('addon-soa-collaboration','SOA Integration / Collaboration','ADMIN'),
  item('addon-planning-optimization','Advanced Planning & Optimization','PLANNING'),
];

export const WORKSPACE_MODULES = [
  ...WORKSPACE_GROUPS.flatMap(group => group.items.map(value => ({ ...value, groupCode:group.code, groupTitle:group.title, type:'module' }))),
  ...WORKSPACE_TOOLS.map(value => ({ ...value, groupCode:'tools', groupTitle:'Enterprise Tools', type:'tool' })),
  ...WORKSPACE_ADDONS.map(value => ({ ...value, groupCode:'addons', groupTitle:'Enterprise Add-ons', type:'addon' })),
];

export function workspaceModule(code) {
  return WORKSPACE_MODULES.find(module => module.code === code);
}

export async function effectiveWorkspaceAccess(db, user, permissions) {
  if (user.session_scope === 'ADMIN') return [];
  const rows = await all(db, `SELECT module_code,allowed FROM erp_user_workspace_access WHERE user_id=?`, [user.id]);
  if (rows.length) return rows.filter(row => row.allowed).map(row => row.module_code);
  const viewable = new Set((permissions || []).filter(row => row.can_view).map(row => row.module));
  return WORKSPACE_MODULES.filter(module => viewable.has(module.permission)).map(module => module.code);
}
