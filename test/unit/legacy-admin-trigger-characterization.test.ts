import assert from 'node:assert/strict';
import test from 'node:test';

import { decideLegacyAdminTrigger } from '../../src/modules/automation/application/legacy-admin-trigger-characterization';

const policy = Object.freeze({
  globalKeywords: Object.freeze(['global_trigger']),
  adminTriggers: Object.freeze([
    Object.freeze({ senderId: 'admin_example_one', trigger: 'admin_trigger' }),
  ]),
});

void test('uses the configured sender-specific trigger instead of the global fallback', () => {
  const input = Object.freeze({ senderId: 'admin_example_one', text: 'global_trigger only' });
  const decision = decideLegacyAdminTrigger(input, policy);

  assert.deepEqual(decision, { code: 'TRIGGER_NOT_MATCHED' });
  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(input, { senderId: 'admin_example_one', text: 'global_trigger only' });
  assert.deepEqual(policy, {
    globalKeywords: ['global_trigger'],
    adminTriggers: [{ senderId: 'admin_example_one', trigger: 'admin_trigger' }],
  });
});

void test('uses the global keyword fallback when no sender-specific trigger applies', () => {
  const decision = decideLegacyAdminTrigger(
    Object.freeze({ senderId: 'admin_example_two', text: 'GLOBAL_TRIGGER' }),
    policy,
  );

  assert.deepEqual(decision, { code: 'TRIGGER_MATCHED' });
});

void test('normalizes case and invisible characters before the deterministic decision', () => {
  const decision = decideLegacyAdminTrigger(
    Object.freeze({ senderId: 'ADMIN_EXAMPLE_ONE', text: '\u200bADMIN_TRIGGER\u200b' }),
    policy,
  );

  assert.deepEqual(decision, { code: 'TRIGGER_MATCHED' });
});

void test('rejects malformed synthetic input with a stable error', () => {
  assert.throws(
    () => decideLegacyAdminTrigger({ senderId: 'admin_example_one', text: '' }, policy),
    { message: 'Invalid legacy admin-trigger characterization input' },
  );
});

void test('rejects accessor-backed synthetic input without evaluating it', () => {
  const input: Record<string, unknown> = { senderId: 'admin_example_one' };
  Object.defineProperty(input, 'text', {
    enumerable: true,
    get(): never {
      throw new Error('must-not-read');
    },
  });

  assert.throws(() => decideLegacyAdminTrigger(input, policy), {
    message: 'Invalid legacy admin-trigger characterization input',
  });
});
