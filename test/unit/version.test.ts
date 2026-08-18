import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationVersion } from '../../src/shared/version.js';

void test('application version identifies the initial foundation', () => {
  assert.equal(applicationVersion, '0.0.0');
});
