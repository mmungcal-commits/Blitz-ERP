/*
 * The client asked for two things about the words on screen: no long dashes,
 * and no instructional notes. Both are the kind of thing that creeps back one
 * helpful sentence at a time, so they are held by a test rather than by memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_FILES = ['public/foundation.js', 'public/viz.js', 'public/index.html',
  'public/approve.html', 'public/foundation.css'];

test('no long dashes anywhere in the front end', () => {
  for (const file of UI_FILES) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    // The literal characters, and the escapes that render as them.
    for (const [needle, name] of [['—','em dash'], ['–','en dash'],
                                  ['\\u2014','escaped em dash'], ['\\u2013','escaped en dash'],
                                  ['&mdash;','&mdash;'], ['&ndash;','&ndash;']]) {
      // codes.js normalises dashes out of scanned serials, so a dash inside a
      // character class is the one legitimate use. It does not live in these files.
      assert.equal(text.includes(needle), false, `${file} still contains an ${name}`);
    }
  }
});

/*
 * Phrases that teach rather than state. Each one was removed on request; this
 * list is what stops them coming back in the next screen someone writes.
 */
const BANNED = [
  'Units become available once Finance posts the count',
  'these numbers start filling in',
  'The scope is fixed for the whole session',
  'Approvals are intentionally blocked in this scope',
  'Each approver gets the next link automatically',
  'Print the Goods Receipt Note now, or reprint it',
  'Point the camera at the unit QR code',
  'Motorcycles then flow to the Pre-release checklist',
  'Serialized parts become unusable',
  'At least 12 characters with uppercase',
  'Try again in a few seconds',
  'persist for your presentation',
  'Open a report to view it and export to Excel',
  'Check only the modules this user is permitted',
  'Administrators always retain access',
  'still requires an independent approver',
  'you do not need to send anything',
  'Backup link, in case they cannot find the email',
  'Create a count plan for one warehouse',
  'Review and approve the generated variance report',
  'Posting makes the entry final',
  'A part picked here leaves inventory immediately',
  'two or more enable the 360 spin',
  'A liquidation only opens once',
  'Detail lines are validated before approval',
  'Links appear automatically when related',
  'Sold is shown for reference only',
  'Earlier approvers must sign first',
  'A delivery lands here automatically once you approve',
  'you do NOT need a requisition',
];

test('no instructional notes on any module screen', () => {
  const found = [];
  for (const file of UI_FILES) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const phrase of BANNED) if (text.includes(phrase)) found.push(`${file}: ${phrase}`);
  }
  assert.deepEqual(found, [], 'instructional copy is back:\n' + found.join('\n'));
});
