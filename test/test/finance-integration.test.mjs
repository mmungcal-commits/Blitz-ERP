import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approveJournal, captureFinanceEvent, createSubledgerDocument, ensureAccountingPeriod,
  postJournal, postSubledgerDocument, registerPendingFixedAsset, reversePostedJournal,
} from '../src/lib/finance.js';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));

class D1Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args.map(value=>typeof value==='bigint'?Number(value):value);return this;}
  first(){return this.db.prepare(this.sql).get(...this.args)??null;}
  all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
  run(){const result=this.db.prepare(this.sql).run(...this.args);return {
    success:true,meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)},
  };}
}
class D1Adapter {
  constructor(db){this.db=db;}
  prepare(sql){return new D1Statement(this.db,sql);}
  async batch(statements){return statements.map(statement=>statement.run());}
}

function buildDatabase(){
  const db=new DatabaseSync(':memory:');
  const pre=[
    'schema.sql','schema2.sql','schema4.sql','schema7.sql','alter_users.sql','data.sql',
    'migrations/0008_connected_erp.sql','migrations/0010_procurement_sales_controls.sql',
    'migrations/0011_finance_planning_registers.sql',
  ];
  const post=[
    'migrations/0012_ramco_enterprise.sql','migrations/0013_atlas_receiving_workbench.sql',
    'migrations/0014_application_auth.sql','migrations/0015_user_access_station_connections.sql',
    'migrations/0016_clean_module_workspace.sql','migrations/0017_inbound_logistics_control.sql',
    'migrations/0018_sales_distribution_custody.sql','migrations/0019_connected_finance_engine.sql',
    'migrations/0020_operational_submodules_and_posting_rules.sql',
    'migrations/0021_rollout_specialist_engines.sql',
  'migrations/0022_inventory_class_r2_rollout.sql',
  ];
  for(const rel of pre)db.exec(readFileSync(join(ROOT,rel),'utf8'));
  const openingDir=join(ROOT,'migrations/opening');
  for(const name of readdirSync(openingDir).filter(name=>name.endsWith('_opening_data.sql')).sort()){
    db.exec(readFileSync(join(openingDir,name),'utf8'));
  }
  for(const rel of post)db.exec(readFileSync(join(ROOT,rel),'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

async function approveAndPost(d1,journalId,approver='approver@nrdev.ph',poster='poster@nrdev.ph'){
  await approveJournal(d1,journalId,approver);
  return postJournal(d1,journalId,poster);
}

test('full finance lifecycle posts and reverses connected records', async()=>{
  const sqlite=buildDatabase();
  const d1=new D1Adapter(sqlite);
  try{
    const partner=sqlite.prepare(`SELECT id FROM erp_partners ORDER BY id LIMIT 1`).get();
    assert.ok(partner?.id);

    const bill=await createSubledgerDocument(d1,{
      entityCode:'E88',documentType:'SUPPLIER_BILL',partnerId:partner.id,
      documentDate:'2026-07-31',dueDate:'2026-08-30',grossAmount:1120,netAmount:1000,
      taxAmount:120,withholdingAmount:20,sourceType:'TEST',sourceNo:'BILL-TEST-001',
    },'requester@nrdev.ph');
    const submittedBill=await postSubledgerDocument(d1,bill.id,{accountCode:'2050'},'requester@nrdev.ph');
    assert.equal(submittedBill.status,'SUBMITTED');
    await approveAndPost(d1,submittedBill.journal_id);
    assert.equal(sqlite.prepare(`SELECT status FROM erp_subledger_documents WHERE id=?`).get(bill.id).status,'POSTED');
    const billBalance=sqlite.prepare(`SELECT ROUND(SUM(base_debit-base_credit),2) balance
      FROM erp_journal_lines WHERE journal_id=?`).get(submittedBill.journal_id).balance;
    assert.equal(Number(billBalance),0);

    const unvalued=sqlite.prepare(`SELECT * FROM erp_assets a WHERE a.unit_cost=0
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id) LIMIT 1`).get();
    assert.ok(unvalued?.id);
    const exception=sqlite.prepare(`INSERT INTO erp_inventory_valuation_exceptions(
      asset_id,item_id,serial_no,item_code,exception_type,exception_message,status,proposed_unit_cost,
      current_unit_cost,requested_by) VALUES(?,?,?,?,? ,?,'PENDING_POSTING',?,?,?) RETURNING id`).get(
      unvalued.id,unvalued.item_id,unvalued.serial_no,unvalued.item_code,'MISSING_UNIT_COST',
      'Integration valuation',1000,0,'requester@nrdev.ph');
    const valuation=await captureFinanceEvent(d1,{
      eventKey:`TEST_VALUATION:${exception.id}`,eventType:'INVENTORY_VALUATION_ADJUSTMENT',
      sourceModule:'INVENTORY',sourceType:'VALUATION_EXCEPTION',sourceId:exception.id,
      sourceNo:unvalued.serial_no,eventDate:'2026-07-31',amount:1000,
      payload:{costAmount:1000,adjustmentDirection:'INCREASE',category:unvalued.category,
        assetId:unvalued.id,itemId:unvalued.item_id,serialNo:unvalued.serial_no},
    },'requester@nrdev.ph');
    sqlite.prepare(`UPDATE erp_inventory_valuation_exceptions SET finance_event_id=?,journal_id=? WHERE id=?`)
      .run(valuation.id,valuation.journal_id,exception.id);
    await approveAndPost(d1,valuation.journal_id);
    assert.equal(Number(sqlite.prepare(`SELECT unit_cost FROM erp_assets WHERE id=?`).get(unvalued.id).unit_cost),1000);
    await reversePostedJournal(d1,valuation.journal_id,'reversal.approver@nrdev.ph','CR-VAL-001');
    assert.equal(Number(sqlite.prepare(`SELECT unit_cost FROM erp_assets WHERE id=?`).get(unvalued.id).unit_cost),0);
    assert.equal(sqlite.prepare(`SELECT status FROM erp_inventory_valuation_exceptions WHERE id=?`).get(exception.id).status,'REVERSED');

    const inventoryAsset=sqlite.prepare(`SELECT * FROM erp_assets a WHERE a.unit_cost>0
      AND a.current_status NOT IN ('SOLD','WRITTEN_OFF')
      AND NOT EXISTS(SELECT 1 FROM erp_fixed_asset_books f WHERE f.asset_id=a.id) LIMIT 1`).get();
    assert.ok(inventoryAsset?.id);
    const cap=await captureFinanceEvent(d1,{
      eventKey:`TEST_CAPITALIZATION:${inventoryAsset.id}`,eventType:'CAPITALIZATION',
      sourceModule:'FIXED_ASSETS',sourceType:'ASSET',sourceId:inventoryAsset.id,
      sourceNo:inventoryAsset.asset_no,eventDate:'2026-07-31',amount:inventoryAsset.unit_cost,
      payload:{costAmount:inventoryAsset.unit_cost,category:inventoryAsset.category,assetId:inventoryAsset.id,
        itemId:inventoryAsset.item_id,serialNo:inventoryAsset.serial_no,
        inventoryAccountCode:['BAT','BSS'].includes(inventoryAsset.category)?'1220':'1200',
        assetAccountCode:inventoryAsset.category==='BSS'?'1320':'1310'},
    },'requester@nrdev.ph');
    const book=await registerPendingFixedAsset(d1,{
      assetId:inventoryAsset.id,entityCode:'E88',assetClass:'TEST_ASSET',capitalizationDate:'2026-07-31',
      acquisitionCost:inventoryAsset.unit_cost,usefulLifeMonths:36,assetAccountCode:'1310',
      accumulatedDepreciationAccountCode:'1390',depreciationExpenseAccountCode:'6800',
      capitalizationEventId:cap.id,capitalizationJournalId:cap.journal_id,
    },'requester@nrdev.ph');
    assert.equal(book.status,'PENDING_APPROVAL');
    await approveAndPost(d1,cap.journal_id);
    assert.equal(sqlite.prepare(`SELECT status FROM erp_fixed_asset_books WHERE id=?`).get(book.id).status,'ACTIVE');
    assert.equal(sqlite.prepare(`SELECT capitalization_status FROM erp_assets WHERE id=?`).get(inventoryAsset.id).capitalization_status,'CAPITALIZED');
    await reversePostedJournal(d1,cap.journal_id,'reversal.approver@nrdev.ph','CR-CAP-001');
    assert.equal(sqlite.prepare(`SELECT status FROM erp_fixed_asset_books WHERE id=?`).get(book.id).status,'REVERSED');
    assert.equal(sqlite.prepare(`SELECT capitalization_status FROM erp_assets WHERE id=?`).get(inventoryAsset.id).capitalization_status,'INVENTORY');

    const activeBook=sqlite.prepare(`SELECT f.*,e.entity_code FROM erp_fixed_asset_books f
      JOIN erp_legal_entities e ON e.id=f.entity_id WHERE f.status='ACTIVE' LIMIT 1`).get();
    assert.ok(activeBook?.id);
    const period=await ensureAccountingPeriod(d1,activeBook.entity_id,'2026-07-31');
    const depRun=sqlite.prepare(`INSERT INTO erp_depreciation_runs(
      run_no,entity_id,period_id,run_date,total_depreciation,status,created_by,approved_by)
      VALUES('DEP-TEST-001',?,?,?,100,'APPROVED','preparer@nrdev.ph','approver@nrdev.ph') RETURNING id`)
      .get(activeBook.entity_id,period.id,'2026-07-31');
    sqlite.prepare(`INSERT INTO erp_depreciation_lines(
      depreciation_run_id,fixed_asset_book_id,asset_id,depreciation_amount,accumulated_after,net_book_value_after)
      VALUES(?,?,?,?,?,?)`).run(depRun.id,activeBook.id,activeBook.asset_id,100,
      Number(activeBook.accumulated_depreciation)+100,Number(activeBook.net_book_value)-100);
    const dep=await captureFinanceEvent(d1,{
      eventKey:`TEST_DEPRECIATION:${depRun.id}`,eventType:'DEPRECIATION',sourceModule:'FINANCE',
      sourceType:'DEPRECIATION_RUN',sourceId:depRun.id,sourceNo:'DEP-TEST-001',eventDate:'2026-07-31',
      amount:100,payload:{grossAmount:100},
    },'preparer@nrdev.ph');
    await approveAndPost(d1,dep.journal_id,'approver@nrdev.ph','poster@nrdev.ph');
    sqlite.prepare(`UPDATE erp_fixed_asset_books SET accumulated_depreciation=accumulated_depreciation+100,
      net_book_value=net_book_value-100,last_depreciation_date='2026-07-31' WHERE id=?`).run(activeBook.id);
    sqlite.prepare(`UPDATE erp_depreciation_runs SET status='POSTED',journal_id=? WHERE id=?`).run(dep.journal_id,depRun.id);
    const afterDep=sqlite.prepare(`SELECT accumulated_depreciation FROM erp_fixed_asset_books WHERE id=?`).get(activeBook.id);
    assert.equal(Number(afterDep.accumulated_depreciation),Number(activeBook.accumulated_depreciation)+100);
    await reversePostedJournal(d1,dep.journal_id,'reversal.approver@nrdev.ph','CR-DEP-001');
    const reversedDep=sqlite.prepare(`SELECT accumulated_depreciation FROM erp_fixed_asset_books WHERE id=?`).get(activeBook.id);
    assert.equal(Number(reversedDep.accumulated_depreciation),Number(activeBook.accumulated_depreciation));
    assert.equal(sqlite.prepare(`SELECT status FROM erp_depreciation_runs WHERE id=?`).get(depRun.id).status,'REVERSED');
  } finally { sqlite.close(); }
});
