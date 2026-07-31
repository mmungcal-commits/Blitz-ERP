import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_PROFILES } from '../src/lib/module-definitions.js';
import {
  syncSpecialistRecord, specialistConnected, addSpecialistLine,
  rolloutReadiness, specialistSchemaForDomain, ensureWorkflowApprovals, decideWorkflowApproval,
  applicableApprovalMatrix, workflowApprovalState, decideCoreWorkflowApproval, coreWorkflowApprovalState,
} from '../src/lib/specialist-engine.js';
import { eventLines } from '../src/lib/finance.js';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));

class D1Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args.map(value=>typeof value==='bigint'?Number(value):value);return this;}
  first(){return this.db.prepare(this.sql).get(...this.args)??null;}
  all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
  run(){const result=this.db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)}};}
}
class D1Adapter {
  constructor(db){this.db=db;}
  prepare(sql){return new D1Statement(this.db,sql);}
  async batch(statements){return statements.map(statement=>statement.run());}
}

function buildDatabase(){
  const db=new DatabaseSync(':memory:');
  const pre=['schema.sql','schema2.sql','schema4.sql','schema7.sql','alter_users.sql','data.sql',
    'migrations/0008_connected_erp.sql','migrations/0010_procurement_sales_controls.sql','migrations/0011_finance_planning_registers.sql'];
  const post=['migrations/0012_ramco_enterprise.sql','migrations/0013_atlas_receiving_workbench.sql',
    'migrations/0014_application_auth.sql','migrations/0015_user_access_station_connections.sql',
    'migrations/0016_clean_module_workspace.sql','migrations/0017_inbound_logistics_control.sql',
    'migrations/0018_sales_distribution_custody.sql','migrations/0019_connected_finance_engine.sql',
    'migrations/0020_operational_submodules_and_posting_rules.sql','migrations/0021_rollout_specialist_engines.sql',
  'migrations/0022_inventory_class_r2_rollout.sql'];
  for(const rel of pre)db.exec(readFileSync(join(ROOT,rel),'utf8'));
  for(const rel of post)db.exec(readFileSync(join(ROOT,rel),'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

function makeRecord(sqlite,moduleCode,index,payload={}){
  const recordNo=`R13-${String(index).padStart(3,'0')}`;
  const result=sqlite.prepare(`INSERT INTO erp_module_records(
    record_no,module_code,category_code,record_type,transaction_date,entity_name,department,description,
    amount,status,owner_email,payload_json,created_by,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      recordNo,moduleCode,'ROLLOUT','Rollout Test','2026-07-31','E88 Test Entity','Operations',
      `Specialist rollout test for ${moduleCode}`,1120,'DRAFT','tester@nrdev.ph',JSON.stringify(payload),
      'tester@nrdev.ph','tester@nrdev.ph');
  return sqlite.prepare('SELECT * FROM erp_module_records WHERE id=?').get(Number(result.lastInsertRowid));
}

function assertBalanced(type,payload){
  const lines=eventLines(type,payload);
  assert.ok(lines.length>=2,`${type} must create at least two journal lines`);
  const debit=lines.reduce((sum,line)=>sum+Number(line.debit||0),0);
  const credit=lines.reduce((sum,line)=>sum+Number(line.credit||0),0);
  assert.ok(Math.abs(debit-credit)<0.005,`${type} is not balanced: ${debit} vs ${credit}`);
}

test('all 83 enterprise modules are mapped to rollout engines',()=>{
  const sqlite=buildDatabase();
  try{
    const configured=sqlite.prepare('SELECT module_code FROM erp_specialist_module_config WHERE active=1').all().map(row=>row.module_code).sort();
    const defined=Object.keys(MODULE_PROFILES).sort();
    assert.equal(configured.length,83);
    assert.deepEqual(configured,defined);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM vw_erp_rollout_module_readiness').get().count,83);
  }finally{sqlite.close();}
});

test('specialist headers and detail engines execute for every operational domain',async()=>{
  const sqlite=buildDatabase();
  const d1=new D1Adapter(sqlite);
  const cases=[
    ['sd-crm','CRM',{contactPerson:'Customer Contact',salesStage:'QUALIFIED',probabilityPct:60}],
    ['mf-work-orders','MANUFACTURING',{productCode:'MC-R280',plannedQty:2,goodQty:1,materialCost:800,laborCost:100,overheadCost:50}],
    ['qm-administration','QUALITY',{itemCode:'MC-R280',sampleQty:1,acceptedQty:1,inspectionStage:'FINAL'}],
    ['pm-definition','PROJECTS',{projectCode:'PRJ-R13',projectManager:'Project Manager',originalBudget:5000}],
    ['eam-work-management','EAM',{equipmentCode:'EQ-R13',workOrderNo:'WO-R13',actualCost:1120}],
    ['fm-assessment','FACILITY',{siteCode:'SITE-R13',assessmentType:'COMPLIANCE',riskLevel:'LOW'}],
    ['lm-transport','LOGISTICS',{tripNo:'TRIP-R13',vehicleNo:'VEH-R13',originCode:'WH-A',destinationCode:'CUSTOMER'}],
    ['hcm-payroll-benefits','HCM',{employeeNo:'EMP-R13',payPeriod:'2026-07',basicPay:1000,allowances:120,deductions:20,netPay:1100}],
    ['srp-billing-revenue','SRP',{projectCode:'PRJ-R13',billingPeriod:'2026-07',billableAmount:1120,taxAmount:120}],
    ['fa-consolidation-reporting','FINANCE',{reportingEntity:'E88_VENTURES',fiscalPeriod:'2026-07',sourceBalance:1120,consolidatedBalance:1120}],
    ['addon-device-integration','PLATFORM',{endpointReference:'device://r13',authenticationType:'API_KEY',direction:'INBOUND'}],
  ];
  try{
    let index=1;
    for(const [moduleCode,domain,payload] of cases){
      const record=makeRecord(sqlite,moduleCode,index++,payload);
      await syncSpecialistRecord(d1,moduleCode,record,payload,'tester@nrdev.ph');
      let connected=await specialistConnected(d1,moduleCode,record.id);
      assert.equal(connected.config.domain_code,domain);
      assert.ok(connected.header,`${moduleCode} did not create a specialist header`);
      if(connected.config.line_engine_code){
        const line={lineType:domain==='LOGISTICS'?'DELIVERY':'TASK',referenceCode:`REF-${index}`,
          description:`${domain} specialist line`,quantity:1,actualQuantity:1,hours:1,rate:100,amount:100,
          earningAmount:100,deductionAmount:10,billableAmount:112,taxAmount:12,debit:100,credit:100,
          resultCode:domain==='QUALITY'?'PASS':'OPEN',status:'OPEN'};
        connected=await addSpecialistLine(d1,moduleCode,record.id,line,'tester@nrdev.ph');
        assert.equal(connected.lines.length,1,`${moduleCode} line engine did not persist its detail`);
        assert.ok(connected.lineSchema.length>0,`${moduleCode} has no line schema`);
      }
    }
    const readiness=await rolloutReadiness(d1);
    assert.equal(readiness.controls.moduleCount,83);
    assert.ok(readiness.domains.length>=10);
  }finally{sqlite.close();}
});



test('amount-based approval matrix enforces role authority and segregation of duties',async()=>{
  const sqlite=buildDatabase();
  const d1=new D1Adapter(sqlite);
  try{
    const payload={employeeNo:'EMP-APR',payPeriod:'2026-07',basicPay:1000,allowances:0,deductions:100,netPay:900};
    const record=makeRecord(sqlite,'hcm-payroll-benefits',90,payload);
    await syncSpecialistRecord(d1,'hcm-payroll-benefits',record,payload,'tester@nrdev.ph');
    const matrix=await applicableApprovalMatrix(d1,'hcm-payroll-benefits',record);
    assert.equal(matrix.length,1);
    assert.equal(matrix[0].approver_role_code,'SCM_MANAGER');
    let state=await ensureWorkflowApprovals(d1,'hcm-payroll-benefits',record,'tester@nrdev.ph');
    assert.equal(state.pending,1);
    await assert.rejects(
      decideWorkflowApproval(d1,'hcm-payroll-benefits',record,{id:900,email:'tester@nrdev.ph',role_code:'SCM_MANAGER'}),
      /Segregation of duties/,
    );
    const decision=await decideWorkflowApproval(d1,'hcm-payroll-benefits',record,{id:901,email:'manager@nrdev.ph',role_code:'SCM_MANAGER'});
    assert.equal(decision.completed,true);
    state=await workflowApprovalState(d1,record.id);
    assert.equal(state.approved,1);
    assert.equal(state.pending,0);

    const medium={...record,id:record.id+1000,record_no:'R13-MEDIUM',amount:500000};
    assert.equal((await applicableApprovalMatrix(d1,'pm-billing',medium))[0].approver_role_code,'FINANCE');
    const large={...record,id:record.id+2000,record_no:'R13-LARGE',amount:2000000};
    assert.equal((await applicableApprovalMatrix(d1,'pm-billing',large))[0].approver_role_code,'ADMIN');

    const source={sourceType:'PURCHASE_ORDER',sourceId:991,sourceNo:'PO-R13-991',recordType:'Purchase Order',department:'Supply Chain',amount:500000,createdBy:'buyer@nrdev.ph'};
    await assert.rejects(
      decideCoreWorkflowApproval(d1,'ip-sourcing-purchasing',source,{id:902,email:'buyer@nrdev.ph',role_code:'FINANCE'}),
      /Segregation of duties/,
    );
    const coreDecision=await decideCoreWorkflowApproval(d1,'ip-sourcing-purchasing',source,{id:903,email:'finance@nrdev.ph',role_code:'FINANCE'});
    assert.equal(coreDecision.completed,true);
    const coreState=await coreWorkflowApprovalState(d1,'ip-sourcing-purchasing','PURCHASE_ORDER',991);
    assert.equal(coreState.approved,1);
  }finally{sqlite.close();}
});
test('specialist domains expose line schemas and new finance events remain balanced',()=>{
  for(const domain of ['MANUFACTURING','QUALITY','PROJECTS','EAM','FACILITY','LOGISTICS','HCM','SRP','FINANCE']){
    assert.ok(specialistSchemaForDomain(domain).length>0,`${domain} must expose a specialist line schema`);
  }
  assertBalanced('PROJECT_BILLING',{grossAmount:1120,netAmount:1000,taxAmount:120});
  assertBalanced('REVENUE_RECOGNITION',{grossAmount:1120,netAmount:1000,taxAmount:120});
  assertBalanced('EXPENSE_REIMBURSEMENT',{grossAmount:1120,netAmount:1000,taxAmount:120});
  assertBalanced('MANUFACTURING_MATERIAL_ISSUE',{costAmount:1000});
  assertBalanced('MANUFACTURING_OUTPUT',{costAmount:1000});
  assertBalanced('MAINTENANCE_COST',{grossAmount:1120,netAmount:1000,taxAmount:120,costAmount:1120});
  assertBalanced('TRANSPORT_BILL',{grossAmount:1120,netAmount:1000,taxAmount:120});
  assertBalanced('EMPLOYEE_DEVELOPMENT_COST',{grossAmount:1120,netAmount:1000,taxAmount:120});
  assertBalanced('FUND_UTILIZATION',{grossAmount:1000});
  assertBalanced('PAYROLL_DETAILED',{grossAmount:1000,deductionAmount:100,netAmount:900});
  assertBalanced('PROJECT_COST',{grossAmount:1120,netAmount:1000,taxAmount:120});
});
