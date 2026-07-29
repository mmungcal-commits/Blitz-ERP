import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryCode, normalizeSerial, normalizeKey, normalizeText } from '../src/lib/codes.js';

test('categoryCode classifies E88 operational inventory', () => {
  assert.equal(categoryCode('Motorcycle D400'), 'MC');
  assert.equal(categoryCode('Battery pack'), 'BAT');
  assert.equal(categoryCode('Battery swapping station locker'), 'BSS');
  assert.equal(categoryCode('Spaceport'), 'BSS');
  assert.equal(categoryCode('Spare parts dashboard'), 'SP');
  assert.equal(categoryCode('Charger 72V'), 'CHG');
  assert.equal(categoryCode('Helmet'), 'OTH');
});

test('normalizeSerial makes serial comparison deterministic', () => {
  assert.equal(normalizeSerial(' ab 12–34 '), 'AB12-34');
  assert.equal(normalizeSerial('BAT  0001'), 'BAT0001');
});

test('normalizers remove visual and whitespace differences', () => {
  assert.equal(normalizeText('  E88   Ventures  '), 'E88 Ventures');
  assert.equal(normalizeKey('Battery-Pack / 72V'), 'BATTERY PACK 72V');
});
