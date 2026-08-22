import assert from 'node:assert/strict';
import test from 'node:test';

import {
  businessDateInWib,
  shouldConsumeDailyEntitlement,
} from '../../src/modules/entitlements/application/daily-entitlement-rule';

void test('uses UTC+7 calendar dates at the WIB midnight boundary', () => {
  assert.equal(businessDateInWib('2030-01-01T16:59:59.999Z'), '2030-01-01');
  assert.equal(businessDateInWib('2030-01-01T17:00:00.000Z'), '2030-01-02');
});

void test('consumes at most one confirmed delivery entitlement per WIB date', () => {
  assert.equal(shouldConsumeDailyEntitlement([], '2030-01-02'), true);
  assert.equal(shouldConsumeDailyEntitlement(['2030-01-02'], '2030-01-02'), false);
  assert.equal(shouldConsumeDailyEntitlement(['2030-01-01'], '2030-01-02'), true);
});
