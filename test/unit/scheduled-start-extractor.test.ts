import assert from 'node:assert/strict';
import test from 'node:test';

import { extractScheduledStartAt } from '../../src/modules/automation/application/scheduled-start-extractor';

void test('extracts valid Indonesian calendar dates and PUKUL or JAM time in WIB', () => {
  assert.equal(
    extractScheduledStartAt('LIST\u200B 12 Januari 2030 PUKUL 08:30\n1. trailing list item'),
    '2030-01-12T01:30:00.000Z',
  );
  assert.equal(extractScheduledStartAt('12 februari 2030 pukul 08.30'), '2030-02-12T01:30:00.000Z');
  assert.equal(extractScheduledStartAt('12 MARET 2030 JAM 00:00'), '2030-03-11T17:00:00.000Z');
  assert.equal(
    extractScheduledStartAt('12\u202c Januari 2030 PUKUL 08:30'),
    '2030-01-12T01:30:00.000Z',
  );
});

void test('ignores missing and malformed schedule metadata', () => {
  for (const text of [
    'LIST hari ini',
    '32 Januari 2030 PUKUL 08:30',
    '12 Januari 2030 PUKUL 24:00',
    '12 Januari 2030 PUKUL 08:60',
    '12 January 2030 PUKUL 08:30',
    '12 Januari 2030 jam 08',
    'LIST hari ini\n1. 12 Januari 2030 PUKUL 08:30',
  ]) {
    assert.equal(extractScheduledStartAt(text), null);
  }
});
