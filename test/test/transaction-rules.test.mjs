import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTransactionPurpose, classifyInventoryTreatment, treatmentRequiresValuation,
  inventoryAccountForCategory, fixedAssetAccountsForCategory,
} from '../src/lib/transaction-rules.js';
import { eventLines } from '../src/lib/finance.js';

const totals = lines => ({
  debit: Math.round(lines.reduce((s,x)=>s+Number(x.debit||0),0)*100)/100,
  credit: Math.round(lines.reduce((s,x)=>s+Number(x.credit||0),0)*100)/100,
});

test('operational purpose aliases normalize consistently', () => {
  assert.equal(normalizeTransactionPurpose('sale to client'),'SALE');
  assert.equal(normalizeTransactionPurpose('test/demo'),'DEMO');
  assert.equal(normalizeTransactionPurpose('employee assignment'),'EMPLOYEE_USE');
  assert.equal(normalizeTransactionPurpose('BSS deployment'),'PROJECT_DEPLOYMENT');
  assert.equal(normalizeTransactionPurpose('stock transfer'),'INVENTORY_TRANSFER');
});

test('sale issues inventory and requires valuation', () => {
  const t=classifyInventoryTreatment({purpose:'SALE',category:'MC'});
  assert.equal(t.targetStatus,'SOLD');
  assert.equal(t.financeEventType,'SALE_COGS');
  assert.equal(t.ownership,'CUSTOMER');
  assert.equal(treatmentRequiresValuation(t),true);
});

test('lease deployment capitalizes durable units and returns them later', () => {
  const t=classifyInventoryTreatment({purpose:'LEASE',category:'MC'});
  assert.equal(t.inventoryEffect,'CAPITALIZE');
  assert.equal(t.financeEventType,'CAPITALIZATION');
  assert.equal(t.returnRequired,true);
});

test('demo and inventory transfer preserve ownership without GL effect', () => {
  const demo=classifyInventoryTreatment({purpose:'DEMO',category:'MC'});
  const transfer=classifyInventoryTreatment({purpose:'TRANSFER',category:'BAT'});
  assert.equal(demo.financialEffect,'NONE');
  assert.equal(demo.returnRequired,true);
  assert.equal(transfer.inventoryEffect,'TRANSFER');
  assert.equal(transfer.financialEffect,'NONE');
});

test('consumables and warranty issues use expense treatment', () => {
  const internal=classifyInventoryTreatment({purpose:'INTERNAL_USE',category:'SP',serialized:false});
  const warranty=classifyInventoryTreatment({purpose:'REPLACEMENT',category:'SP',serialized:false});
  assert.equal(internal.financeEventType,'INVENTORY_CONSUMPTION');
  assert.equal(warranty.financeEventType,'WARRANTY_ISSUE');
  assert.equal(treatmentRequiresValuation(internal),true);
});

test('category accounts distinguish batteries/BSS and fixed assets', () => {
  assert.equal(inventoryAccountForCategory('BAT'),'1220');
  assert.equal(inventoryAccountForCategory('MC'),'1200');
  assert.equal(fixedAssetAccountsForCategory('BSS').assetAccountCode,'1320');
  assert.equal(fixedAssetAccountsForCategory('MC').usefulLifeMonths,36);
});

test('finance event lines are balanced for core operational postings', () => {
  const scenarios=[
    ['GOODS_RECEIPT',{netAmount:1000,inventoryAccountCode:'1200'}],
    ['LANDED_COST',{capitalizableAmount:250,inventoryAccountCode:'1200'}],
    ['SUPPLIER_BILL',{grossAmount:1120,netAmount:1000,taxAmount:120,withholdingAmount:20,debitAccountCode:'2050'}],
    ['CUSTOMER_INVOICE',{grossAmount:1120,netAmount:1000,taxAmount:120}],
    ['SALE_COGS',{costAmount:650,inventoryAccountCode:'1200'}],
    ['SALES_RETURN_INVENTORY',{costAmount:650,inventoryAccountCode:'1200'}],
    ['CAPITALIZATION',{costAmount:650,assetAccountCode:'1310',inventoryAccountCode:'1200'}],
    ['INVENTORY_CONSUMPTION',{costAmount:50,inventoryAccountCode:'1200'}],
    ['WARRANTY_ISSUE',{costAmount:50,inventoryAccountCode:'1200'}],
    ['INVENTORY_VALUATION_ADJUSTMENT',{costAmount:20,adjustmentDirection:'INCREASE'}],
    ['ASSET_RETIREMENT',{originalCost:1000,accumulatedDepreciation:600,netBookValue:400}],
  ];
  for(const [type,payload] of scenarios){
    const lines=eventLines(type,payload);
    assert.ok(lines.length>=2,`${type} must have at least two lines`);
    assert.deepEqual(totals(lines),{debit:totals(lines).credit,credit:totals(lines).credit},`${type} must balance`);
  }
});

test('landed cost allocation accrues capitalizable cost without capitalizing VAT', () => {
  const lines=eventLines('LANDED_COST',{capitalizableAmount:1000,taxAmount:120,inventoryAccountCode:'1220'});
  assert.deepEqual(lines.map(x=>[x.accountCode,x.debit,x.credit]),[
    ['1220',1000,0],['2060',0,1000],
  ]);
});
