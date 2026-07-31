import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_PROFILE_COUNT, definitionFor } from '../src/lib/module-definitions.js';
import { WORKSPACE_MODULES } from '../src/lib/workspace.js';

test('every enterprise module has a specific functional definition', () => {
  assert.equal(WORKSPACE_MODULES.length, 83);
  assert.equal(MODULE_PROFILE_COUNT, WORKSPACE_MODULES.length);
  for (const module of WORKSPACE_MODULES) {
    const definition = definitionFor(module);
    assert.equal(definition.code, module.code);
    assert.ok(definition.noun);
    assert.ok(definition.plural);
    assert.ok(definition.recordTypes.length > 0);
    assert.ok(definition.fields.length >= 5);
    assert.ok(definition.workflow.stages.length >= 3);
    assert.ok(definition.reports.length >= 3);
    assert.ok(definition.quickActions.length >= 2);
  }
});

test('posted ledger reversal is defined but must be approval-gated by the route', () => {
  const billing = definitionFor(WORKSPACE_MODULES.find(module => module.code === 'srp-billing-revenue'));
  assert.ok(billing.workflow.actions.some(action => action.code === 'REVERSE'));
});

test('lease contracts collect commercial terms and connect actual units', () => {
  const lease = definitionFor(WORKSPACE_MODULES.find(module => module.code === 'sd-lease-contract-management'));
  const fields = new Set(lease.fields.map(field => field.key));
  for (const key of [
    'businessChannel','serviceProvider','clientName','contractTermMonths','lockInMonths',
    'contractStartDate','contractEndDate','dailyLeaseRate','latePenalty','billingBasis',
    'paymentChannel','providerAuthorizedRep','clientAuthorizedRep',
  ]) assert.ok(fields.has(key), `missing ${key}`);
});
