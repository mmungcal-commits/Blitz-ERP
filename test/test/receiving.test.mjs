import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpectedOpen, receivingAssetControl } from '../src/lib/receiving.js';

test('expected serial lifecycle closes matched and substituted records', () => {
  assert.equal(isExpectedOpen('EXPECTED'), true);
  assert.equal(isExpectedOpen('EXPECTED_EXCEPTION'), true);
  assert.equal(isExpectedOpen('RECEIVED'), false);
  assert.equal(isExpectedOpen('SUBSTITUTED'), false);
  assert.equal(isExpectedOpen('SHORT_CLOSED'), false);
});

test('only exact receiving matches are released as available', () => {
  assert.deepEqual(receivingAssetControl('MATCHED'), { status:'AVAILABLE', reconciliation:'CLEAR' });
  assert.deepEqual(receivingAssetControl('SERIAL_SUBSTITUTED'), { status:'QUARANTINE', reconciliation:'UNRECONCILED' });
  assert.deepEqual(receivingAssetControl('OVER_RECEIPT'), { status:'QUARANTINE', reconciliation:'UNRECONCILED' });
});
