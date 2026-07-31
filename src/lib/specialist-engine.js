import { all, first, run } from './db.js';
import { normalizeText, ensurePartner, ensureItem, nextCode } from './codes.js';
import { captureFinanceEvent, reversePostedJournal } from './finance.js';
import { definitionFor } from './module-definitions.js';
import { workspaceModule } from './workspace.js';

const n = value => Number(value || 0);
const text = value => normalizeText(value);
const upper = value => text(value).toUpperCase();
const isoDate = value => (text(value) || new Date().toISOString()).slice(0, 10);

const DOMAIN_TABLES = {
  CRM:{ header:'erp_crm_pipeline_records', line:null, fk:null },
  MANUFACTURING:{ header:'erp_manufacturing_documents', line:'erp_manufacturing_lines', fk:'document_id' },
  QUALITY:{ header:'erp_quality_documents', line:'erp_quality_results', fk:'quality_document_id' },
  PROJECTS:{ header:'erp_project_documents', line:'erp_project_lines', fk:'project_document_id' },
  EAM:{ header:'erp_eam_documents', line:'erp_eam_lines', fk:'eam_document_id' },
  FACILITY:{ header:'erp_facility_documents', line:'erp_facility_lines', fk:'facility_document_id' },
  LOGISTICS:{ header:'erp_logistics_documents', line:'erp_logistics_stops', fk:'logistics_document_id' },
  HCM:{ header:'erp_hcm_documents', line:'erp_hcm_lines', fk:'hcm_document_id' },
  SRP:{ header:'erp_srp_documents', line:'erp_srp_lines', fk:'srp_document_id' },
  FINANCE:{ header:'erp_finance_specialist_documents', line:'erp_finance_specialist_lines', fk:'finance_document_id' },
  PLATFORM:{ header:'erp_platform_integrations', line:null, fk:null },
};

const LINE_SCHEMAS = {
  MANUFACTURING:[
    ['lineType','Line Type','select',['BOM','MATERIAL','OPERATION','OUTPUT','BYPRODUCT','SUBCONTRACT']],
    ['referenceCode','Item / Operation Code','text'],['description','Description','text',null,true],
    ['quantity','Planned Quantity','number'],['actualQuantity','Actual Quantity','number'],
    ['hours','Hours','number'],['rate','Unit Cost / Rate','number'],['amount','Amount','number'],
    ['status','Status','select',['PLANNED','RESERVED','ISSUED','CONFIRMED','COMPLETED','CANCELLED']],
  ],
  QUALITY:[
    ['lineType','Characteristic Type','select',['ATTRIBUTE','VISUAL','MEASUREMENT','FUNCTIONAL','DOCUMENT']],
    ['referenceCode','Characteristic / Defect Code','text'],['description','Characteristic','text',null,true],
    ['lowerLimit','Lower Limit','number'],['upperLimit','Upper Limit','number'],
    ['measuredValue','Measured Value','text'],['resultCode','Result','select',['PENDING','PASS','FAIL','DEVIATION']],
    ['correctiveAction','Corrective Action','text'],
  ],
  PROJECTS:[
    ['lineType','Line Type','select',['WBS','TASK','MILESTONE','RISK','ISSUE','CHANGE','COST','BILLING']],
    ['referenceCode','Reference Code','text'],['description','Description','text',null,true],
    ['ownerEmail','Owner','email'],['startDate','Start Date','date'],['endDate','End Date','date'],
    ['percentComplete','Progress %','number'],['quantity','Quantity','number'],['hours','Hours','number'],
    ['rate','Rate','number'],['amount','Amount','number'],['billable','Billable','checkbox'],
    ['status','Status','select',['OPEN','PLANNED','ACTIVE','ON_HOLD','COMPLETED','CLOSED']],
  ],
  EAM:[
    ['lineType','Line Type','select',['TASK','MATERIAL','LABOR','CHECK','METER','FINDING']],
    ['referenceCode','Item / Task Code','text'],['description','Description','text',null,true],
    ['technician','Technician','text'],['quantity','Quantity','number'],['hours','Hours','number'],
    ['rate','Unit Cost / Rate','number'],['amount','Amount','number'],
    ['resultCode','Result','select',['PENDING','PASS','FAIL','REPLACED','REPAIRED']],
    ['status','Status','select',['OPEN','PLANNED','ISSUED','COMPLETED','CLOSED']],
  ],
  FACILITY:[
    ['lineType','Line Type','select',['RESOURCE','SCOPE','MATERIAL','LABOR','FINDING','WORK_REPORT']],
    ['referenceCode','Reference Code','text'],['description','Description','text',null,true],
    ['resourceType','Resource Type','text'],['quantity','Quantity','number'],['hours','Hours','number'],
    ['rate','Rate','number'],['amount','Amount','number'],['startDate','Start Date','date'],['endDate','End Date','date'],
    ['status','Status','select',['PLANNED','ALLOCATED','IN_PROGRESS','COMPLETED','CLOSED']],
  ],
  LOGISTICS:[
    ['lineType','Stop Type','select',['PICKUP','DELIVERY','TRANSFER','RETURN','HUB','WAYPOINT']],
    ['referenceCode','Reference No.','text'],['description','Location / Address','text',null,true],
    ['contactName','Contact Name','text'],['quantity','Quantity','number'],
    ['plannedAt','Planned Date/Time','datetime-local'],['actualAt','Actual Date/Time','datetime-local'],
    ['proofReference','POD / Proof Reference','text'],
    ['status','Status','select',['PLANNED','ARRIVED','COMPLETED','FAILED','CANCELLED']],
  ],
  HCM:[
    ['lineType','Line Type','select',['PAY_COMPONENT','BENEFIT','DEDUCTION','ATTENDANCE','GOAL','TRAINING','INTERVIEW']],
    ['referenceCode','Component / Reference','text'],['description','Description','text',null,true],
    ['workDate','Work Date','date'],['hours','Hours','number'],['quantity','Quantity','number'],['rate','Rate','number'],
    ['earningAmount','Earning','number'],['deductionAmount','Deduction','number'],['employerAmount','Employer Cost','number'],
    ['taxable','Taxable','checkbox'],['statutory','Statutory','checkbox'],['status','Status','select',['OPEN','APPROVED','POSTED','CLOSED']],
  ],
  SRP:[
    ['lineType','Line Type','select',['SERVICE','RESOURCE','TIMESHEET','EXPENSE','MILESTONE','BILLING','BUDGET']],
    ['referenceCode','Reference Code','text'],['description','Description','text',null,true],
    ['employeeNo','Employee / Resource No.','text'],['workDate','Work Date','date'],['quantity','Quantity','number'],
    ['hours','Hours','number'],['rate','Rate','number'],['costAmount','Cost Amount','number'],
    ['billableAmount','Billable Amount','number'],['taxAmount','Tax Amount','number'],['billable','Billable','checkbox'],
    ['status','Status','select',['OPEN','APPROVED','BILLED','POSTED','CLOSED']],
  ],
  FINANCE:[
    ['lineType','Line Type','select',['BALANCE','ELIMINATION','FUND_ALLOCATION','UTILIZATION','TRANSLATION']],
    ['referenceCode','Account / Entity Code','text'],['description','Description','text',null,true],
    ['entityCode','Entity Code','text'],['accountCode','Account Code','text'],['counterpartyCode','Counterparty','text'],
    ['debit','Debit','number'],['credit','Credit','number'],['amount','Amount','number'],
    ['eliminationType','Elimination Type','text'],['status','Status','select',['OPEN','MATCHED','POSTED','ELIMINATED']],
  ],
};

function schemaFor(domain) {
  return (LINE_SCHEMAS[domain] || []).map(([key,label,type,options,required]) => ({ key,label,type,options:options||[],required:!!required }));
}

export function specialistSchemaForDomain(domain) {
  return schemaFor(upper(domain));
}

export async function specialistConfig(db, moduleCode) {
  return first(db, `SELECT * FROM erp_specialist_module_config WHERE module_code=? AND active=1`, [moduleCode]);
}


function matrixSpecificity(row,moduleCode,recordType,department){
  return (row.module_code===moduleCode?4:0)+(row.document_type===recordType?2:0)+(row.department===department?1:0);
}

export async function applicableApprovalMatrix(db,moduleCode,record){
  const amount=Math.abs(n(record.amount));
  const recordType=text(record.record_type)||'*';
  const department=text(record.department)||'*';
  const rows=await all(db,`SELECT * FROM erp_approval_matrices
    WHERE active=1 AND module_code IN (?,'*') AND document_type IN (?,'*') AND department IN (?,'*')
      AND amount_from<=? AND (amount_to IS NULL OR amount_to>=?)
    ORDER BY step_no,id`,[moduleCode,recordType,department,amount,amount]);
  if(!rows.length)return [];
  const scored=rows.map(row=>({...row,specificity:matrixSpecificity(row,moduleCode,recordType,department)}));
  const max=Math.max(...scored.map(row=>row.specificity));
  return scored.filter(row=>row.specificity===max).sort((a,b)=>n(a.step_no)-n(b.step_no)||n(a.id)-n(b.id));
}

export async function ensureWorkflowApprovals(db,moduleCode,record,userEmail){
  const existingCycle=await first(db,`SELECT COALESCE(MAX(cycle_no),0) cycle_no,
    SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) pending_count
    FROM erp_workflow_approvals WHERE record_id=?`,[record.id]);
  if(n(existingCycle?.pending_count)>0)return workflowApprovalState(db,record.id);
  if(n(existingCycle?.cycle_no)>0){
    const previous=await workflowApprovalState(db,record.id);
    if(previous.pending>0||previous.rejected===0)return previous;
  }
  const matrix=await applicableApprovalMatrix(db,moduleCode,record);
  if(!matrix.length)return {required:false,steps:[],pending:0,approved:0,rejected:0};
  const cycle=Math.max(1,n(existingCycle?.cycle_no)+1);
  for(const step of matrix){
    await run(db,`INSERT OR IGNORE INTO erp_workflow_approvals(
      module_code,record_id,record_no,matrix_id,cycle_no,step_no,required_role_code,assigned_user_id,
      action_code,status,requested_by) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?)`,[
      moduleCode,record.id,record.record_no,step.id,cycle,n(step.step_no),step.approver_role_code,
      step.approver_user_id||null,step.action_code||'APPROVE',userEmail,
    ]);
  }
  return workflowApprovalState(db,record.id);
}

export async function workflowApprovalState(db,recordId){
  const steps=await all(db,`SELECT a.*,u.email assigned_user_email,u.display_name assigned_user_name
    FROM erp_workflow_approvals a LEFT JOIN erp_users u ON u.id=a.assigned_user_id
    WHERE a.record_id=? ORDER BY cycle_no DESC,step_no,id`,[recordId]);
  const cycle=steps.length?Math.max(...steps.map(row=>n(row.cycle_no))):0;
  const current=steps.filter(row=>n(row.cycle_no)===cycle);
  return {required:current.length>0,cycle,steps:current,
    pending:current.filter(row=>row.status==='PENDING').length,
    approved:current.filter(row=>row.status==='APPROVED').length,
    rejected:current.filter(row=>row.status==='REJECTED').length};
}

export async function decideWorkflowApproval(db,moduleCode,record,user,decision='APPROVE',notes=''){
  let state=await ensureWorkflowApprovals(db,moduleCode,record,record.created_by||record.owner_email||user.email);
  if(!state.required)return {required:false,completed:true,state};
  const pending=state.steps.filter(row=>row.status==='PENDING').sort((a,b)=>n(a.step_no)-n(b.step_no)||n(a.id)-n(b.id))[0];
  if(!pending)return {required:true,completed:state.rejected===0,state};
  if(record.created_by===user.email)throw new Error('Segregation of duties prevents the record creator from approving the same record.');
  if(pending.assigned_user_id&&n(pending.assigned_user_id)!==n(user.id)&&user.role_code!=='ADMIN')throw new Error('This approval step is assigned to another user.');
  if(!pending.assigned_user_id&&pending.required_role_code!==user.role_code&&user.role_code!=='ADMIN'){
    throw new Error(`This approval step requires the ${pending.required_role_code} role.`);
  }
  const normalized=upper(decision);
  if(!['APPROVE','REJECT'].includes(normalized))throw new Error('Choose approve or reject.');
  await run(db,`UPDATE erp_workflow_approvals SET status=?,decided_by=?,decided_at=datetime('now'),decision_notes=?
    WHERE id=? AND status='PENDING'`,[normalized==='APPROVE'?'APPROVED':'REJECTED',user.email,text(notes),pending.id]);
  state=await workflowApprovalState(db,record.id);
  return {required:true,completed:state.pending===0&&state.rejected===0,rejected:state.rejected>0,decision:normalized,step:pending,state};
}

export async function assertWorkflowApprovalsComplete(db,recordId){
  const state=await workflowApprovalState(db,recordId);
  if(state.required&&(state.pending>0||state.rejected>0))throw new Error('Required approval steps are not complete.');
  return state;
}


export async function coreWorkflowApprovalState(db,sourceModule,sourceType,sourceId){
  const steps=await all(db,`SELECT a.*,u.email assigned_user_email,u.display_name assigned_user_name
    FROM erp_core_workflow_approvals a LEFT JOIN erp_users u ON u.id=a.assigned_user_id
    WHERE a.source_module=? AND a.source_type=? AND a.source_id=?
    ORDER BY cycle_no DESC,step_no,id`,[sourceModule,sourceType,sourceId]);
  const cycle=steps.length?Math.max(...steps.map(row=>n(row.cycle_no))):0;
  const current=steps.filter(row=>n(row.cycle_no)===cycle);
  return {required:current.length>0,cycle,steps:current,
    pending:current.filter(row=>row.status==='PENDING').length,
    approved:current.filter(row=>row.status==='APPROVED').length,
    rejected:current.filter(row=>row.status==='REJECTED').length};
}

export async function ensureCoreWorkflowApprovals(db,moduleCode,source,userEmail){
  const state=await coreWorkflowApprovalState(db,moduleCode,source.sourceType,source.sourceId);
  if(state.pending>0||(state.required&&state.rejected===0))return state;
  const matrixRecord={record_type:source.recordType||source.sourceType,department:source.department||'',amount:n(source.amount)};
  const matrix=await applicableApprovalMatrix(db,moduleCode,matrixRecord);
  if(!matrix.length)return {required:false,cycle:0,steps:[],pending:0,approved:0,rejected:0};
  const cycle=Math.max(1,n(state.cycle)+1);
  for(const step of matrix){
    await run(db,`INSERT OR IGNORE INTO erp_core_workflow_approvals(
      source_module,source_type,source_id,source_no,matrix_id,cycle_no,step_no,required_role_code,
      assigned_user_id,status,requested_by) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?)`,[
      moduleCode,source.sourceType,source.sourceId,source.sourceNo,step.id,cycle,n(step.step_no),
      step.approver_role_code,step.approver_user_id||null,userEmail,
    ]);
  }
  return coreWorkflowApprovalState(db,moduleCode,source.sourceType,source.sourceId);
}

export async function decideCoreWorkflowApproval(db,moduleCode,source,user,decision='APPROVE',notes=''){
  let state=await ensureCoreWorkflowApprovals(db,moduleCode,source,source.createdBy||user.email);
  if(!state.required)return {required:false,completed:true,state};
  const pending=state.steps.filter(row=>row.status==='PENDING').sort((a,b)=>n(a.step_no)-n(b.step_no)||n(a.id)-n(b.id))[0];
  if(!pending)return {required:true,completed:state.rejected===0,state};
  if(source.createdBy===user.email)throw new Error('Segregation of duties prevents the transaction creator from approving the same transaction.');
  if(pending.assigned_user_id&&n(pending.assigned_user_id)!==n(user.id)&&user.role_code!=='ADMIN')throw new Error('This approval step is assigned to another user.');
  if(!pending.assigned_user_id&&pending.required_role_code!==user.role_code&&user.role_code!=='ADMIN')throw new Error(`This approval step requires the ${pending.required_role_code} role.`);
  const normalized=upper(decision);
  if(!['APPROVE','REJECT'].includes(normalized))throw new Error('Choose approve or reject.');
  await run(db,`UPDATE erp_core_workflow_approvals SET status=?,decided_by=?,decided_at=datetime('now'),decision_notes=?
    WHERE id=? AND status='PENDING'`,[normalized==='APPROVE'?'APPROVED':'REJECTED',user.email,text(notes),pending.id]);
  state=await coreWorkflowApprovalState(db,moduleCode,source.sourceType,source.sourceId);
  return {required:true,completed:state.pending===0&&state.rejected===0,rejected:state.rejected>0,decision:normalized,step:pending,state};
}

async function upsertCrm(db, record, payload, userEmail) {
  let customer = null;
  if (text(record.entity_name)) customer = await ensurePartner(db, { name:record.entity_name,type:'CUSTOMER',sourceSystem:'CRM_PIPELINE',sourceKey:record.record_no });
  await run(db, `INSERT INTO erp_crm_pipeline_records(
    workspace_record_id,record_no,record_type,customer_id,customer_name,contact_person,contact_email,mobile_no,
    lead_source,sales_stage,probability_pct,expected_value,expected_close_date,next_action,next_action_date,
    owner_email,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET record_type=excluded.record_type,customer_id=excluded.customer_id,
    customer_name=excluded.customer_name,contact_person=excluded.contact_person,contact_email=excluded.contact_email,
    mobile_no=excluded.mobile_no,lead_source=excluded.lead_source,sales_stage=excluded.sales_stage,
    probability_pct=excluded.probability_pct,expected_value=excluded.expected_value,
    expected_close_date=excluded.expected_close_date,next_action=excluded.next_action,
    next_action_date=excluded.next_action_date,owner_email=excluded.owner_email,status=excluded.status,
    updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,record.record_no,record.record_type,customer?.id||null,record.entity_name||'',payload.contactPerson||'',payload.contactEmail||'',payload.mobileNo||'',
    payload.leadSource||'',payload.salesStage||'',n(payload.probabilityPct||payload.probability||0),n(record.amount||payload.expectedValue||0),
    payload.expectedCloseDate||'',record.description||payload.nextAction||'',payload.nextActionDate||'',record.owner_email,record.status,userEmail,userEmail,
  ]);
}

async function upsertManufacturing(db, moduleCode, record, payload, userEmail) {
  const totalCost=n(payload.totalUnitCost||payload.unitCost||record.amount||0);
  await run(db, `INSERT INTO erp_manufacturing_documents(
    workspace_record_id,module_code,document_no,document_type,product_code,bom_version,work_order_no,work_center,resource_code,
    planned_qty,good_qty,reject_qty,planned_start,planned_end,actual_start,actual_end,material_cost,labor_hours,labor_cost,
    overhead_cost,total_cost,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    product_code=excluded.product_code,bom_version=excluded.bom_version,work_order_no=excluded.work_order_no,
    work_center=excluded.work_center,resource_code=excluded.resource_code,planned_qty=excluded.planned_qty,
    good_qty=excluded.good_qty,reject_qty=excluded.reject_qty,planned_start=excluded.planned_start,
    planned_end=excluded.planned_end,actual_start=excluded.actual_start,actual_end=excluded.actual_end,
    material_cost=excluded.material_cost,labor_hours=excluded.labor_hours,labor_cost=excluded.labor_cost,
    overhead_cost=excluded.overhead_cost,total_cost=excluded.total_cost,status=excluded.status,
    updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.productCode||'',payload.bomVersion||'',payload.workOrderNo||record.record_no,
    payload.workCenter||'',payload.resourceCode||'',n(payload.plannedQty||payload.orderQty||payload.estimateQty),n(payload.goodQty),n(payload.rejectQty),
    payload.plannedStart||payload.scheduleStart||'',payload.plannedEnd||payload.scheduleEnd||'',payload.actualStart||'',payload.completionDate||payload.actualEnd||'',
    n(payload.materialCost),n(payload.laborHours||payload.durationHours),n(payload.laborCost),n(payload.overheadCost),totalCost,record.status,userEmail,userEmail,
  ]);
}

async function upsertQuality(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_quality_documents(
    workspace_record_id,module_code,document_no,document_type,plan_code,inspection_no,item_code,serial_no,lot_no,supplier_name,
    inspection_stage,sample_qty,accepted_qty,rejected_qty,disposition,risk_level,quality_score,inspection_date,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    plan_code=excluded.plan_code,inspection_no=excluded.inspection_no,item_code=excluded.item_code,serial_no=excluded.serial_no,
    lot_no=excluded.lot_no,supplier_name=excluded.supplier_name,inspection_stage=excluded.inspection_stage,
    sample_qty=excluded.sample_qty,accepted_qty=excluded.accepted_qty,rejected_qty=excluded.rejected_qty,
    disposition=excluded.disposition,risk_level=excluded.risk_level,quality_score=excluded.quality_score,
    inspection_date=excluded.inspection_date,status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.planCode||'',payload.inspectionNo||record.record_no,
    payload.itemCode||'',payload.serialNo||'',payload.lotNo||'',payload.supplier||record.entity_name||'',payload.inspectionStage||'',
    n(payload.sampleQty||payload.sampleSize),n(payload.acceptedQty),n(payload.rejectedQty),payload.disposition||'',payload.riskLevel||'',n(payload.score||payload.qualityScore),
    payload.inspectionDate||record.transaction_date,record.status,userEmail,userEmail,
  ]);
}

async function upsertProject(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_project_documents(
    workspace_record_id,module_code,document_no,document_type,project_code,project_name,customer_name,project_manager,sponsor,site_location,
    start_date,end_date,percent_complete,original_budget,revised_budget,committed_cost,actual_cost,contract_value,billed_amount,
    recognized_revenue,open_items,health,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    project_code=excluded.project_code,project_name=excluded.project_name,customer_name=excluded.customer_name,
    project_manager=excluded.project_manager,sponsor=excluded.sponsor,site_location=excluded.site_location,
    start_date=excluded.start_date,end_date=excluded.end_date,percent_complete=excluded.percent_complete,
    original_budget=excluded.original_budget,revised_budget=excluded.revised_budget,committed_cost=excluded.committed_cost,
    actual_cost=excluded.actual_cost,contract_value=excluded.contract_value,billed_amount=excluded.billed_amount,
    recognized_revenue=excluded.recognized_revenue,open_items=excluded.open_items,health=excluded.health,status=excluded.status,
    updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.projectCode||payload.sowNo||record.record_no,
    record.entity_name||record.description||'',payload.customer||payload.client||record.entity_name||'',payload.projectManager||'',payload.sponsor||'',payload.siteLocation||'',
    payload.startDate||record.transaction_date,payload.targetEndDate||payload.endDate||payload.dueDate||'',n(payload.percentComplete),n(payload.originalBudget),
    n(payload.revisedBudget||payload.budgetAmount),n(payload.committedCost),n(payload.actualCost||payload.finalCost),n(payload.contractValue||record.amount),
    n(payload.billableAmount||record.amount),n(payload.recognizedRevenue||payload.finalRevenue),n(payload.openItems),payload.health||'',record.status,userEmail,userEmail,
  ]);
}

async function upsertEam(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_eam_documents(
    workspace_record_id,module_code,document_no,document_type,equipment_code,serial_no,equipment_category,model,location_code,
    maintenance_plan,work_order_no,fault_code,priority,scheduled_start,scheduled_end,actual_start,actual_end,downtime_hours,
    meter_reading,estimated_cost,actual_cost,assigned_team,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    equipment_code=excluded.equipment_code,serial_no=excluded.serial_no,equipment_category=excluded.equipment_category,
    model=excluded.model,location_code=excluded.location_code,maintenance_plan=excluded.maintenance_plan,
    work_order_no=excluded.work_order_no,fault_code=excluded.fault_code,priority=excluded.priority,
    scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,actual_start=excluded.actual_start,
    actual_end=excluded.actual_end,downtime_hours=excluded.downtime_hours,meter_reading=excluded.meter_reading,
    estimated_cost=excluded.estimated_cost,actual_cost=excluded.actual_cost,assigned_team=excluded.assigned_team,
    status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.equipmentCode||payload.serialNo||'',payload.serialNo||'',payload.equipmentCategory||'',payload.model||'',
    payload.location||payload.currentLocation||'',payload.maintenancePlan||'',payload.workOrderNo||payload.requestNo||record.record_no,
    payload.faultCode||'',payload.priority||'',payload.scheduledStart||payload.reportedAt||payload.startDateTime||'',payload.scheduledEnd||payload.endDateTime||'',
    payload.actualStart||'',payload.actualEnd||'',n(payload.downtimeHours),n(payload.odometerKm||payload.meterOut||payload.meterIn),n(record.amount),n(payload.actualCost||record.amount),
    payload.assignedTeam||payload.technician||'',record.status,userEmail,userEmail,
  ]);
}

async function upsertFacility(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_facility_documents(
    workspace_record_id,module_code,document_no,document_type,site_code,site_name,customer_name,contract_no,assessment_type,
    risk_level,score,capacity,utilization_pct,contract_start,contract_end,service_level,contract_value,labor_amount,
    material_amount,percent_complete,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    site_code=excluded.site_code,site_name=excluded.site_name,customer_name=excluded.customer_name,
    contract_no=excluded.contract_no,assessment_type=excluded.assessment_type,risk_level=excluded.risk_level,
    score=excluded.score,capacity=excluded.capacity,utilization_pct=excluded.utilization_pct,
    contract_start=excluded.contract_start,contract_end=excluded.contract_end,service_level=excluded.service_level,
    contract_value=excluded.contract_value,labor_amount=excluded.labor_amount,material_amount=excluded.material_amount,
    percent_complete=excluded.percent_complete,status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.siteCode||'',payload.siteName||record.entity_name||'',payload.customer||record.entity_name||'',
    payload.contractNo||payload.quotationNo||record.record_no,payload.assessmentType||'',payload.riskLevel||'',n(payload.score),n(payload.capacity),n(payload.utilizationPct),
    payload.contractStart||payload.allocationStart||'',payload.contractEnd||payload.allocationEnd||'',payload.sla||'',n(record.amount||payload.contractValue),
    n(payload.laborAmount),n(payload.materialAmount),n(payload.percentComplete),record.status,userEmail,userEmail,
  ]);
}

async function upsertLogistics(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_logistics_documents(
    workspace_record_id,module_code,document_no,document_type,trip_no,warehouse_order_no,hub_code,vehicle_no,driver_name,carrier_name,
    route_text,origin_code,destination_code,pickup_at,delivery_at,distance_km,odometer_km,freight_amount,capacity,
    utilization_pct,severity,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    trip_no=excluded.trip_no,warehouse_order_no=excluded.warehouse_order_no,hub_code=excluded.hub_code,
    vehicle_no=excluded.vehicle_no,driver_name=excluded.driver_name,carrier_name=excluded.carrier_name,
    route_text=excluded.route_text,origin_code=excluded.origin_code,destination_code=excluded.destination_code,
    pickup_at=excluded.pickup_at,delivery_at=excluded.delivery_at,distance_km=excluded.distance_km,
    odometer_km=excluded.odometer_km,freight_amount=excluded.freight_amount,capacity=excluded.capacity,
    utilization_pct=excluded.utilization_pct,severity=excluded.severity,status=excluded.status,
    updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.tripNo||record.record_no,payload.warehouseOrderNo||'',payload.hubCode||'',
    payload.vehicleNo||'',payload.driver||payload.assignedDriver||'',payload.carrier||record.entity_name||'',payload.route||'',payload.originCode||'',payload.destinationCode||'',
    payload.pickupDateTime||'',payload.deliveryDateTime||'',n(payload.distanceKm),n(payload.odometerKm),n(payload.chargeAmount||record.amount),n(payload.capacity),
    n(payload.utilizationPct),payload.severity||'',record.status,userEmail,userEmail,
  ]);
}

async function upsertHcm(db, moduleCode, record, payload, userEmail) {
  const gross=n(payload.basicPay)+n(payload.allowances);
  const net=n(payload.netPay||Math.max(0,gross-n(payload.deductions)));
  await run(db, `INSERT INTO erp_hcm_documents(
    workspace_record_id,module_code,document_no,document_type,employee_no,employee_name,position_title,department_code,
    manager_name,employment_type,hire_date,separation_date,requisition_no,candidate_name,recruitment_stage,pay_period,
    basic_pay,allowances,deductions,net_pay,payment_date,rating,required_headcount,current_headcount,status,
    created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    employee_no=excluded.employee_no,employee_name=excluded.employee_name,position_title=excluded.position_title,
    department_code=excluded.department_code,manager_name=excluded.manager_name,employment_type=excluded.employment_type,
    hire_date=excluded.hire_date,separation_date=excluded.separation_date,requisition_no=excluded.requisition_no,
    candidate_name=excluded.candidate_name,recruitment_stage=excluded.recruitment_stage,pay_period=excluded.pay_period,
    basic_pay=excluded.basic_pay,allowances=excluded.allowances,deductions=excluded.deductions,net_pay=excluded.net_pay,
    payment_date=excluded.payment_date,rating=excluded.rating,required_headcount=excluded.required_headcount,
    current_headcount=excluded.current_headcount,status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.employeeNo||'',record.entity_name||'',payload.position||payload.roleTitle||'',
    payload.departmentCode||record.department||'',payload.manager||'',payload.employmentType||'',payload.hireDate||'',payload.separationDate||'',
    payload.requisitionNo||'',payload.candidateName||record.entity_name||'',payload.recruitmentStage||'',payload.payPeriod||'',n(payload.basicPay),n(payload.allowances),
    n(payload.deductions),net,payload.paymentDate||'',n(payload.rating),n(payload.requiredHeadcount),n(payload.currentHeadcount),record.status,userEmail,userEmail,
  ]);
}

async function upsertSrp(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_srp_documents(
    workspace_record_id,module_code,document_no,document_type,client_name,opportunity_no,proposal_no,contract_no,sow_no,
    project_code,employee_no,billing_period,billing_basis,probability_pct,estimated_cost,contract_value,budget_amount,
    forecast_amount,actual_amount,billable_amount,recognized_revenue,tax_amount,due_date,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    client_name=excluded.client_name,opportunity_no=excluded.opportunity_no,proposal_no=excluded.proposal_no,
    contract_no=excluded.contract_no,sow_no=excluded.sow_no,project_code=excluded.project_code,
    employee_no=excluded.employee_no,billing_period=excluded.billing_period,billing_basis=excluded.billing_basis,
    probability_pct=excluded.probability_pct,estimated_cost=excluded.estimated_cost,contract_value=excluded.contract_value,
    budget_amount=excluded.budget_amount,forecast_amount=excluded.forecast_amount,actual_amount=excluded.actual_amount,
    billable_amount=excluded.billable_amount,recognized_revenue=excluded.recognized_revenue,tax_amount=excluded.tax_amount,
    due_date=excluded.due_date,status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.client||record.entity_name||'',payload.opportunityNo||'',payload.proposalNo||record.record_no,
    payload.rateCardNo||payload.contractNo||'',payload.sowNo||'',payload.projectCode||payload.targetProject||'',payload.employeeNo||'',payload.billingPeriod||payload.budgetPeriod||'',
    payload.billingBasis||payload.rateBasis||'',n(payload.probabilityPct),n(payload.estimatedCost),n(payload.contractValue||record.amount),n(payload.budgetAmount),
    n(payload.forecastAmount),n(payload.actualAmount),n(payload.billableAmount||record.amount),n(payload.recognizedRevenue),n(payload.taxAmount),payload.dueDate||'',
    record.status,userEmail,userEmail,
  ]);
}

async function upsertFinanceSpecialist(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_finance_specialist_documents(
    workspace_record_id,module_code,document_no,document_type,reporting_entity,fiscal_period,fund_code,grantor,restriction_text,
    source_balance,consolidated_balance,available_balance,utilized_amount,start_date,expiry_date,status,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,document_type=excluded.document_type,
    reporting_entity=excluded.reporting_entity,fiscal_period=excluded.fiscal_period,fund_code=excluded.fund_code,
    grantor=excluded.grantor,restriction_text=excluded.restriction_text,source_balance=excluded.source_balance,
    consolidated_balance=excluded.consolidated_balance,available_balance=excluded.available_balance,
    utilized_amount=excluded.utilized_amount,start_date=excluded.start_date,expiry_date=excluded.expiry_date,
    status=excluded.status,updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.record_type,payload.reportingEntity||record.entity_name||'',payload.fiscalPeriod||'',payload.fundCode||'',
    payload.grantor||record.entity_name||'',payload.restriction||'',n(payload.sourceBalance),n(payload.consolidatedBalance),n(payload.availableBalance),
    n(record.amount||payload.utilizedAmount),payload.startDate||record.transaction_date,payload.expiryDate||'',record.status,userEmail,userEmail,
  ]);
}

async function upsertPlatform(db, moduleCode, record, payload, userEmail) {
  await run(db, `INSERT INTO erp_platform_integrations(
    workspace_record_id,module_code,integration_code,integration_name,integration_type,endpoint_reference,authentication_type,
    direction,schedule_expression,last_status,active,created_by,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?,datetime('now'))
    ON CONFLICT(workspace_record_id) DO UPDATE SET module_code=excluded.module_code,integration_name=excluded.integration_name,
    integration_type=excluded.integration_type,endpoint_reference=excluded.endpoint_reference,
    authentication_type=excluded.authentication_type,direction=excluded.direction,
    schedule_expression=excluded.schedule_expression,last_status=excluded.last_status,active=excluded.active,
    updated_by=excluded.updated_by,updated_at=datetime('now')`, [
    record.id,moduleCode,record.record_no,record.entity_name||record.record_type,record.record_type,
    payload.endpoint||payload.endpointReference||'',payload.authenticationType||'',payload.direction||'BIDIRECTIONAL',
    payload.scheduleExpression||'',record.status,record.status==='ACTIVE'?1:0,userEmail,userEmail,
  ]);
}

function referenceValues(record,payload) {
  const keys=['projectCode','sowNo','workOrderNo','serialNo','employeeNo','requisitionNo','contractNo','quotationNo','invoiceNo','customerCode','siteCode','hubCode','vehicleNo','opportunityNo'];
  const values=[];
  for(const key of keys){const v=text(payload[key]);if(v.length>=3)values.push(v);}
  if(text(record.entity_name).length>=3)values.push(text(record.entity_name));
  return [...new Set(values)].slice(0,12);
}

export async function refreshEnterpriseLinks(db,moduleCode,record,payload,userEmail){
  const module=workspaceModule(moduleCode);
  if(!module)return;
  const definition=definitionFor(module);
  const targets=[...new Set(definition.connections||[])];
  const refs=referenceValues(record,payload);
  if(!targets.length||!refs.length)return;
  for(const targetModule of targets){
    for(const ref of refs){
      const target=await first(db,`SELECT id,record_no,module_code FROM erp_module_records
        WHERE module_code=? AND id<>? AND (entity_name=? OR record_no=? OR payload_json LIKE ?)
        ORDER BY updated_at DESC,id DESC LIMIT 1`,[targetModule,record.id,ref,ref,`%${ref}%`]);
      if(!target)continue;
      await run(db,`INSERT OR IGNORE INTO erp_enterprise_record_links(
        source_module_code,source_record_id,source_record_no,target_module_code,target_record_id,target_record_no,
        link_type,shared_reference,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,[
        moduleCode,record.id,record.record_no,target.module_code,target.id,target.record_no,'BUSINESS_REFERENCE',ref,userEmail,
      ]);
      break;
    }
  }
}

export async function syncSpecialistRecord(db,moduleCode,record,payload,userEmail){
  const config=await specialistConfig(db,moduleCode);
  if(!config)return null;
  if(config.engine_code.startsWith('CORE_')){
    await refreshEnterpriseLinks(db,moduleCode,record,payload,userEmail);
    return {config,header:null};
  }
  if(config.domain_code==='CRM')await upsertCrm(db,record,payload,userEmail);
  else if(config.domain_code==='MANUFACTURING')await upsertManufacturing(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='QUALITY')await upsertQuality(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='PROJECTS')await upsertProject(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='EAM')await upsertEam(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='FACILITY')await upsertFacility(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='LOGISTICS')await upsertLogistics(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='HCM')await upsertHcm(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='SRP')await upsertSrp(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='FINANCE')await upsertFinanceSpecialist(db,moduleCode,record,payload,userEmail);
  else if(config.domain_code==='PLATFORM')await upsertPlatform(db,moduleCode,record,payload,userEmail);
  await refreshEnterpriseLinks(db,moduleCode,record,payload,userEmail);
  return {config};
}

async function headerFor(db,config,recordId){
  const mapping=DOMAIN_TABLES[config.domain_code];
  if(!mapping||config.engine_code.startsWith('CORE_'))return null;
  return first(db,`SELECT * FROM ${mapping.header} WHERE workspace_record_id=?`,[recordId]);
}

export async function specialistConnected(db,moduleCode,recordId){
  const config=await specialistConfig(db,moduleCode);
  if(!config)return null;
  const mapping=DOMAIN_TABLES[config.domain_code];
  const header=await headerFor(db,config,recordId);
  let lines=[];
  if(header&&mapping?.line&&mapping.fk){
    const orderColumn=config.domain_code==='LOGISTICS'?'stop_no':'line_no';
    lines=await all(db,`SELECT * FROM ${mapping.line} WHERE ${mapping.fk}=? ORDER BY ${orderColumn},id`,[header.id]);
  }
  const links=await all(db,`SELECT * FROM vw_erp_enterprise_document_flow
    WHERE (source_module_code=? AND source_record_id=?) OR (target_module_code=? AND target_record_id=?)
    ORDER BY created_at DESC,id DESC`,[moduleCode,recordId,moduleCode,recordId]);
  const approvals=await workflowApprovalState(db,recordId);
  return {config,header,lines:lines.map(row=>normalizedLine(config.domain_code,row)),lineSchema:schemaFor(config.domain_code),links,approvals};
}

function normalizedLine(domain,row){
  if(domain==='MANUFACTURING')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.item_code||row.operation_no||row.resource_code,description:row.description,quantity:row.qty_planned,actualQuantity:row.qty_actual,hours:row.hours,rate:row.unit_cost,amount:row.amount,status:row.status};
  if(domain==='QUALITY')return {...row,lineNo:row.line_no,lineType:'ATTRIBUTE',referenceCode:row.defect_code,description:row.characteristic,lowerLimit:row.lower_limit,upperLimit:row.upper_limit,measuredValue:row.measured_value,resultCode:row.result_code,correctiveAction:row.corrective_action,status:row.result_code};
  if(domain==='PROJECTS')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.reference_code,description:row.description,ownerEmail:row.owner_email,startDate:row.start_date,endDate:row.end_date,percentComplete:row.percent_complete,quantity:row.quantity,hours:row.hours,rate:row.rate,amount:row.amount,billable:!!row.billable,status:row.status};
  if(domain==='EAM')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.item_code,description:row.description,technician:row.technician,quantity:row.quantity,hours:row.hours,rate:row.unit_cost,amount:row.amount,resultCode:row.result_code,status:row.status};
  if(domain==='FACILITY')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.reference_code,description:row.description,resourceType:row.resource_type,quantity:row.quantity,hours:row.hours,rate:row.rate,amount:row.amount,startDate:row.start_date,endDate:row.end_date,status:row.status};
  if(domain==='LOGISTICS')return {...row,lineNo:row.stop_no,lineType:row.stop_type,referenceCode:row.reference_no||row.location_code,description:row.address,contactName:row.contact_name,quantity:row.quantity,plannedAt:row.planned_at,actualAt:row.actual_at,proofReference:row.proof_reference,status:row.status};
  if(domain==='HCM')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.component_code,description:row.description,workDate:row.work_date,hours:row.hours,quantity:row.quantity,rate:row.rate,earningAmount:row.earning_amount,deductionAmount:row.deduction_amount,employerAmount:row.employer_amount,taxable:!!row.taxable,statutory:!!row.statutory,amount:n(row.earning_amount)-n(row.deduction_amount),status:row.status};
  if(domain==='SRP')return {...row,lineNo:row.line_no,lineType:row.line_type,referenceCode:row.reference_code,description:row.description,employeeNo:row.employee_no,workDate:row.work_date,quantity:row.quantity,hours:row.hours,rate:row.rate,costAmount:row.cost_amount,billableAmount:row.billable_amount,taxAmount:row.tax_amount,billable:!!row.billable,amount:row.billable_amount,status:row.status};
  if(domain==='FINANCE')return {...row,lineNo:row.line_no,lineType:row.elimination_type||'BALANCE',referenceCode:row.account_code,description:row.description,entityCode:row.entity_code,accountCode:row.account_code,counterpartyCode:row.counterparty_code,debit:row.debit,credit:row.credit,amount:row.amount,status:row.status};
  return row;
}

function nextLineNo(lines){return (lines.reduce((m,row)=>Math.max(m,n(row.line_no||row.stop_no)),0)||0)+10;}

export async function addSpecialistLine(db,moduleCode,recordId,input,userEmail){
  const config=await specialistConfig(db,moduleCode);
  if(!config||!config.line_engine_code)throw new Error('This module does not use specialist detail lines.');
  const mapping=DOMAIN_TABLES[config.domain_code];
  const header=await headerFor(db,config,recordId);
  if(!header)throw new Error('Save the main record before adding operational detail lines.');
  const existing=await all(db,`SELECT * FROM ${mapping.line} WHERE ${mapping.fk}=?`,[header.id]);
  const lineNo=nextLineNo(existing);
  const description=text(input.description);
  if(description.length<2)throw new Error('Line description is required.');
  if(config.domain_code==='MANUFACTURING'){
    let item=null; if(text(input.referenceCode)) item=await ensureItem(db,{itemCode:input.referenceCode,itemName:description,category:'OTH',autoCreated:true,sourceSystem:'MANUFACTURING_LINE',sourceKey:`${header.document_no}:${lineNo}`});
    await run(db,`INSERT INTO erp_manufacturing_lines(document_id,line_no,line_type,item_id,item_code,description,operation_no,resource_code,
      qty_planned,qty_actual,uom,hours,unit_cost,amount,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'MATERIAL'),item?.id||null,text(input.referenceCode),description,
      upper(input.lineType)==='OPERATION'?text(input.referenceCode):'',text(input.resourceCode),n(input.quantity),n(input.actualQuantity),text(input.uom||'EA'),
      n(input.hours),n(input.rate),n(input.amount||n(input.quantity)*n(input.rate)),upper(input.status||'PLANNED'),userEmail]);
  }else if(config.domain_code==='QUALITY'){
    await run(db,`INSERT INTO erp_quality_results(quality_document_id,line_no,characteristic,test_method,lower_limit,upper_limit,
      measured_value,result_code,defect_code,corrective_action,inspector,inspected_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,description,text(input.testMethod),input.lowerLimit===''?null:n(input.lowerLimit),input.upperLimit===''?null:n(input.upperLimit),
      text(input.measuredValue),upper(input.resultCode||'PENDING'),text(input.referenceCode),text(input.correctiveAction),text(input.inspector||userEmail),
      input.resultCode&&upper(input.resultCode)!=='PENDING'?new Date().toISOString():null,userEmail]);
  }else if(config.domain_code==='PROJECTS'){
    await run(db,`INSERT INTO erp_project_lines(project_document_id,line_no,line_type,reference_code,description,owner_email,start_date,end_date,
      percent_complete,quantity,hours,rate,amount,billable,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'TASK'),text(input.referenceCode),description,text(input.ownerEmail),text(input.startDate),text(input.endDate),
      n(input.percentComplete),n(input.quantity),n(input.hours),n(input.rate),n(input.amount||n(input.quantity||input.hours)*n(input.rate)),input.billable?1:0,upper(input.status||'OPEN'),userEmail]);
  }else if(config.domain_code==='EAM'){
    let item=null; if(upper(input.lineType)==='MATERIAL'&&text(input.referenceCode)) item=await ensureItem(db,{itemCode:input.referenceCode,itemName:description,category:'SP',autoCreated:true,sourceSystem:'EAM_LINE',sourceKey:`${header.document_no}:${lineNo}`});
    await run(db,`INSERT INTO erp_eam_lines(eam_document_id,line_no,line_type,item_id,item_code,description,technician,quantity,hours,
      unit_cost,amount,result_code,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'TASK'),item?.id||null,text(input.referenceCode),description,text(input.technician),n(input.quantity),n(input.hours),
      n(input.rate),n(input.amount||n(input.quantity||input.hours)*n(input.rate)),upper(input.resultCode),upper(input.status||'OPEN'),userEmail]);
  }else if(config.domain_code==='FACILITY'){
    await run(db,`INSERT INTO erp_facility_lines(facility_document_id,line_no,line_type,reference_code,description,resource_type,quantity,hours,
      rate,amount,start_date,end_date,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'RESOURCE'),text(input.referenceCode),description,text(input.resourceType),n(input.quantity),n(input.hours),
      n(input.rate),n(input.amount||n(input.quantity||input.hours)*n(input.rate)),text(input.startDate),text(input.endDate),upper(input.status||'PLANNED'),userEmail]);
  }else if(config.domain_code==='LOGISTICS'){
    await run(db,`INSERT INTO erp_logistics_stops(logistics_document_id,stop_no,stop_type,location_code,address,planned_at,actual_at,
      reference_no,contact_name,quantity,proof_reference,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'DELIVERY'),text(input.locationCode||input.referenceCode),description,text(input.plannedAt),text(input.actualAt),
      text(input.referenceCode),text(input.contactName),n(input.quantity),text(input.proofReference),upper(input.status||'PLANNED'),userEmail]);
  }else if(config.domain_code==='HCM'){
    await run(db,`INSERT INTO erp_hcm_lines(hcm_document_id,line_no,line_type,component_code,description,quantity,rate,earning_amount,
      deduction_amount,employer_amount,taxable,statutory,project_code,work_date,hours,status,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'PAY_COMPONENT'),text(input.referenceCode),description,n(input.quantity),n(input.rate),n(input.earningAmount),
      n(input.deductionAmount),n(input.employerAmount),input.taxable===false?0:1,input.statutory?1:0,text(input.projectCode),text(input.workDate),n(input.hours),upper(input.status||'OPEN'),userEmail]);
    if(moduleCode==='hcm-payroll-benefits'){
      const totals=await first(db,`SELECT ROUND(COALESCE(SUM(earning_amount),0),2) earnings,
        ROUND(COALESCE(SUM(deduction_amount),0),2) deductions FROM erp_hcm_lines WHERE hcm_document_id=?`,[header.id]);
      await run(db,`UPDATE erp_hcm_documents SET allowances=?,deductions=?,net_pay=ROUND(basic_pay+?-?,2),updated_at=datetime('now') WHERE id=?`,[
        n(totals.earnings),n(totals.deductions),n(totals.earnings),n(totals.deductions),header.id]);
    }
  }else if(config.domain_code==='SRP'){
    await run(db,`INSERT INTO erp_srp_lines(srp_document_id,line_no,line_type,reference_code,description,employee_no,resource_role,
      work_date,quantity,hours,rate,cost_amount,billable_amount,tax_amount,billable,status,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,upper(input.lineType||'SERVICE'),text(input.referenceCode),description,text(input.employeeNo),text(input.resourceRole),text(input.workDate),
      n(input.quantity),n(input.hours),n(input.rate),n(input.costAmount),n(input.billableAmount||n(input.quantity||input.hours)*n(input.rate)),n(input.taxAmount),
      input.billable===false?0:1,upper(input.status||'OPEN'),userEmail]);
  }else if(config.domain_code==='FINANCE'){
    await run(db,`INSERT INTO erp_finance_specialist_lines(finance_document_id,line_no,entity_code,account_code,counterparty_code,
      description,debit,credit,amount,elimination_type,fund_code,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      header.id,lineNo,text(input.entityCode),text(input.accountCode||input.referenceCode),text(input.counterpartyCode),description,n(input.debit),n(input.credit),
      n(input.amount),text(input.eliminationType),text(input.fundCode),upper(input.status||'OPEN'),userEmail]);
  }else throw new Error('Line engine is not available for this domain.');
  return specialistConnected(db,moduleCode,recordId);
}

export async function deleteSpecialistLine(db,moduleCode,recordId,lineId,userEmail){
  const config=await specialistConfig(db,moduleCode);
  if(!config||!config.line_engine_code)throw new Error('This module has no specialist lines.');
  const mapping=DOMAIN_TABLES[config.domain_code];
  const header=await headerFor(db,config,recordId);
  if(!header)throw new Error('Specialist header not found.');
  const row=await first(db,`SELECT * FROM ${mapping.line} WHERE id=? AND ${mapping.fk}=?`,[lineId,header.id]);
  if(!row)throw new Error('Detail line not found.');
  if(['POSTED','COMPLETED','CLOSED','BILLED','ISSUED'].includes(upper(row.status)))throw new Error('Posted or completed detail lines cannot be deleted. Reverse the parent document instead.');
  await run(db,`DELETE FROM ${mapping.line} WHERE id=? AND ${mapping.fk}=?`,[lineId,header.id]);
  return {deleted:true,lineId,userEmail};
}

async function lineCount(db,config,recordId){
  const mapping=DOMAIN_TABLES[config.domain_code];
  const header=await headerFor(db,config,recordId);
  if(!header||!mapping?.line)return 0;
  return n((await first(db,`SELECT COUNT(*) count FROM ${mapping.line} WHERE ${mapping.fk}=?`,[header.id]))?.count);
}

export async function validateSpecialistAction(db,moduleCode,record,payload,action){
  const config=await specialistConfig(db,moduleCode);
  if(!config||config.engine_code.startsWith('CORE_'))return;
  const finalizing=['APPROVED','ACTIVE','COMPLETED','CLOSED','POSTED'].includes(action.to);
  if(finalizing&&config.requires_lines){
    const count=await lineCount(db,config,record.id);
    if(!count)throw new Error(`${record.record_no} requires at least one specialist detail line before ${action.label.toLowerCase()}.`);
  }
  if(config.domain_code==='MANUFACTURING'&&['COMPLETED','CLOSED'].includes(action.to)){
    if(/^mf-(work-orders|execution)$/.test(moduleCode)&&n(payload.goodQty)<=0)throw new Error('Enter a positive good quantity before completing the manufacturing document.');
  }
  if(config.domain_code==='QUALITY'&&['ACCEPTED','REJECTED','CLOSED'].includes(action.to)){
    const sample=n(payload.sampleQty||payload.sampleSize);
    if(sample>0&&n(payload.acceptedQty)+n(payload.rejectedQty)>sample)throw new Error('Accepted plus rejected quantity cannot exceed the inspected sample quantity.');
    const header=await headerFor(db,config,record.id);
    const pending=header?await first(db,`SELECT COUNT(*) count FROM erp_quality_results WHERE quality_document_id=? AND result_code='PENDING'`,[header.id]):null;
    if(n(pending?.count)>0)throw new Error('Complete every quality result before accepting, rejecting, or closing the inspection.');
  }
  if(moduleCode==='pm-closure'&&['COMPLETED','CLOSED'].includes(action.to)&&n(payload.openItems)>0)throw new Error('Project closure is blocked while open items remain.');
  if(moduleCode==='hcm-payroll-benefits'&&action.to==='POSTED'){
    const gross=n(payload.basicPay)+n(payload.allowances);
    if(gross<=0)throw new Error('Payroll gross earnings must be greater than zero.');
    if(n(payload.netPay)<0||n(payload.deductions)>gross)throw new Error('Payroll deductions cannot exceed gross earnings.');
  }
  if(moduleCode==='fa-consolidation-reporting'&&action.to==='POSTED'){
    const header=await headerFor(db,config,record.id);
    if(header){
      const totals=await first(db,`SELECT ROUND(COALESCE(SUM(debit),0),2) debit,ROUND(COALESCE(SUM(credit),0),2) credit
        FROM erp_finance_specialist_lines WHERE finance_document_id=?`,[header.id]);
      if(Math.abs(n(totals.debit)-n(totals.credit))>0.005)throw new Error('Consolidation and elimination lines must balance before posting.');
    }
  }
}

function shouldCaptureFinance(moduleCode,record,action){
  if(!['POSTED','COMPLETED','CLOSED','ACTIVE'].includes(action.to))return false;
  if(moduleCode==='pm-billing'||moduleCode==='hcm-payroll-benefits'||moduleCode==='srp-expense'||moduleCode==='srp-billing-revenue')return action.to==='POSTED';
  if(moduleCode==='mf-work-orders'||moduleCode==='mf-execution')return action.to==='COMPLETED';
  if(['sd-service-management','eam-online-maintenance','eam-work-management','fm-work-reporting','lm-fleet-management','hcm-development'].includes(moduleCode))return action.to==='CLOSED';
  if(moduleCode==='lm-contracting-billing')return action.to==='ACTIVE'&&['Freight Bill','Service Charge'].includes(record.record_type);
  if(moduleCode==='fa-grants-funds')return action.to==='ACTIVE'&&record.record_type==='Fund Utilization';
  if(moduleCode==='eam-equipment-rental')return action.to==='ACTIVE'&&record.record_type==='Rental Dispatch';
  return false;
}

function financePayload(config,moduleCode,record,payload){
  const amount=n(record.amount||payload.billableAmount||payload.chargeAmount||payload.actualCost||payload.totalUnitCost);
  const tax=n(payload.taxAmount);
  const base={amount,grossAmount:amount,taxAmount:tax,netAmount:Math.max(0,amount-tax),costAmount:amount,
    dueDate:payload.dueDate||'',businessLine:config.domain_code,projectCode:payload.projectCode||payload.sowNo||'',
    expenseAccountCode:config.domain_code==='LOGISTICS'?'6530':config.domain_code==='EAM'||config.domain_code==='FACILITY'?'6510':
      config.domain_code==='HCM'?'6540':config.domain_code==='PROJECTS'||config.domain_code==='SRP'?'6520':'6990'};
  if(config.finance_event_type==='PAYROLL_DETAILED'){
    const gross=n(payload.basicPay)+n(payload.allowances);
    return {...base,amount:gross,grossAmount:gross,taxAmount:n(payload.deductions),deductionAmount:n(payload.deductions),netAmount:n(payload.netPay||gross-n(payload.deductions))};
  }
  if(config.finance_event_type==='PROJECT_BILLING')return {...base,revenueAccountCode:'4040'};
  if(config.finance_event_type==='MANUFACTURING_OUTPUT'){
    const conversionCost=n(payload.materialCost)+n(payload.laborCost)+n(payload.overheadCost);
    return {...base,costAmount:n(payload.totalUnitCost||record.amount||conversionCost)};
  }
  return base;
}

export async function afterSpecialistAction(db,moduleCode,record,payload,action,userEmail){
  const config=await specialistConfig(db,moduleCode);
  if(!config)return null;
  await syncSpecialistRecord(db,moduleCode,record,payload,userEmail);
  if(!config.finance_event_type||!shouldCaptureFinance(moduleCode,record,action))return null;
  const event=await captureFinanceEvent(db,{
    eventKey:`SPECIALIST:${moduleCode}:${record.id}:${action.to}`,
    eventType:config.finance_event_type,
    sourceModule:record.module_code?.toUpperCase()||moduleCode.toUpperCase(),
    sourceType:record.record_type,
    sourceId:record.id,sourceNo:record.record_no,eventDate:record.transaction_date,
    entityCode:'E88',department:record.department||'',businessLine:config.domain_code,
    amount:n(record.amount),taxAmount:n(payload.taxAmount),description:`${record.record_type} ${record.record_no}`,
    payload:financePayload(config,moduleCode,record,payload),
  },userEmail);
  const mapping=DOMAIN_TABLES[config.domain_code];
  if(mapping?.header&&!config.engine_code.startsWith('CORE_'))await run(db,`UPDATE ${mapping.header} SET finance_event_id=?,updated_at=datetime('now') WHERE workspace_record_id=?`,[event.id,record.id]);
  return event;
}

export async function rolloutReadiness(db){
  const modules=await all(db,`SELECT * FROM vw_erp_rollout_module_readiness ORDER BY domain_code,module_code`);
  const domains=await all(db,`SELECT domain_code,COUNT(*) module_count,SUM(CASE WHEN rollout_level='CORE' THEN 1 ELSE 0 END) core_modules,
    SUM(CASE WHEN rollout_level='SPECIALIST' THEN 1 ELSE 0 END) specialist_modules,SUM(CASE WHEN rollout_level='PLATFORM' THEN 1 ELSE 0 END) platform_modules
    FROM erp_specialist_module_config WHERE active=1 GROUP BY domain_code ORDER BY domain_code`);
  const controls={
    moduleCount:n((await first(db,`SELECT COUNT(*) count FROM erp_specialist_module_config WHERE active=1`))?.count),
    approvalMatrices:n((await first(db,`SELECT COUNT(*) count FROM erp_approval_matrices WHERE active=1`))?.count),
    enterpriseLinks:n((await first(db,`SELECT COUNT(*) count FROM erp_enterprise_record_links WHERE status='ACTIVE'`))?.count),
    openValuationExceptions:n((await first(db,`SELECT COUNT(*) count FROM erp_inventory_valuation_exceptions WHERE status='OPEN'`))?.count),
    openSerialReconciliations:n((await first(db,`SELECT COUNT(*) count FROM erp_reconciliation_cases WHERE status='UNRECONCILED'`))?.count),
    financeErrors:n((await first(db,`SELECT COUNT(*) count FROM erp_finance_source_events WHERE status='ERROR'`))?.count),
  };
  return {modules,domains,controls};
}

export async function createIntegrationRun(db,integrationId,userEmail){
  const integration=await first(db,`SELECT * FROM erp_platform_integrations WHERE id=?`,[integrationId]);
  if(!integration)throw new Error('Integration configuration not found.');
  if(!integration.active)throw new Error('Activate the integration before starting a run.');
  const runNo=await nextCode(db,'INTEGRATION_RUN','INT-RUN',8);
  const result=await run(db,`INSERT INTO erp_platform_integration_runs(integration_id,run_no,initiated_by) VALUES(?,?,?)`,[integration.id,runNo,userEmail]);
  return first(db,`SELECT * FROM erp_platform_integration_runs WHERE id=?`,[result.meta.last_row_id]);
}


export async function reverseSpecialistRecord(db,moduleCode,record,userEmail,requestNo){
  const config=await specialistConfig(db,moduleCode);
  if(!config||config.engine_code.startsWith('CORE_'))return null;
  const mapping=DOMAIN_TABLES[config.domain_code];
  if(!mapping?.header)return null;
  const header=await first(db,`SELECT * FROM ${mapping.header} WHERE workspace_record_id=?`,[record.id]);
  if(!header?.finance_event_id)return null;
  const event=await first(db,`SELECT * FROM erp_finance_source_events WHERE id=?`,[header.finance_event_id]);
  if(!event)return null;
  if(event.journal_id){
    const journal=await first(db,`SELECT * FROM erp_journal_headers WHERE id=?`,[event.journal_id]);
    if(journal?.status==='POSTED')return reversePostedJournal(db,journal.id,userEmail,requestNo);
    if(journal&&!['REVERSED','VOIDED'].includes(journal.status)){
      await run(db,`UPDATE erp_journal_headers SET status='VOIDED',reversed_by=?,reversed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,[userEmail,journal.id]);
    }
  }
  await run(db,`UPDATE erp_finance_source_events SET status='REVERSED',processed_by=?,processed_at=datetime('now') WHERE id=?`,[userEmail,event.id]);
  return event;
}
