import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInventoryCategory, isDurableCategory, inventoryClassLabel,
  inventoryAccountForCategory, cogsAccountForCategory, classifyInventoryTreatment
} from '../src/lib/transaction-rules.js';

test('inventory category normalizes synonyms to canonical class codes', () => {
  assert.equal(normalizeInventoryCategory('battery'), 'BAT');
  assert.equal(normalizeInventoryCategory('Lockers'), 'BSS');
  assert.equal(normalizeInventoryCategory('Motorcycle'), 'MC');
  assert.equal(normalizeInventoryCategory('spare parts'), 'SP');
  assert.equal(normalizeInventoryCategory('charger'), 'CHG');
  assert.equal(normalizeInventoryCategory(''), 'OTH');
});

test('durable categories are motorcycle, battery, locker and charger', () => {
  assert.equal(isDurableCategory('MC'), true);
  assert.equal(isDurableCategory('BAT'), true);
  assert.equal(isDurableCategory('CHG'), true);
  assert.equal(isDurableCategory('SP'), false);
});

test('class labels and GL accounts are separated per class', () => {
  assert.equal(inventoryClassLabel('BAT'), 'Batteries');
  assert.equal(inventoryAccountForCategory('MC'), '1200');
  assert.equal(inventoryAccountForCategory('BAT'), '1220');
  assert.equal(inventoryAccountForCategory('BSS'), '1225');
  assert.equal(cogsAccountForCategory('MC'), '5000');
});

test('classifyInventoryTreatment resolves a treatment without throwing', () => {
  assert.doesNotThrow(() => classifyInventoryTreatment({ purpose: 'SALE', category: 'MC', serialized: true }));
  assert.doesNotThrow(() => classifyInventoryTreatment({ purpose: 'LEASE_DEPLOYMENT', category: 'BAT', serialized: true }));
});
