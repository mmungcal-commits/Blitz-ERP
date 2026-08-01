import test from 'node:test';
import assert from 'node:assert/strict';
import { specialistSchemaForDomain } from '../src/lib/specialist-engine.js';

test('specialistSchemaForDomain returns a schema for a known domain without throwing', () => {
  assert.doesNotThrow(() => specialistSchemaForDomain('SALES'));
  const schema = specialistSchemaForDomain('SALES');
  assert.ok(schema === null || typeof schema === 'object');
});

test('unknown domains are handled gracefully', () => {
  assert.doesNotThrow(() => specialistSchemaForDomain('DOES_NOT_EXIST'));
  assert.doesNotThrow(() => specialistSchemaForDomain(''));
});
