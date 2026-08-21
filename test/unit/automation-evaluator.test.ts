import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAutomation } from '../../src/modules/automation/application/automation-evaluator';

const policy = {
  enabled: true,
  targetGroupId: 'group_example_one',
  adminIds: ['admin_example_one'],
  keyword: 'hello',
} as const;

const message = {
  groupId: 'group_example_one',
  senderId: 'admin_example_one',
  text: 'Hello from a synthetic message',
} as const;

void test('accepts a matching synthetic automation message with a frozen explicit decision', () => {
  const decision = evaluateAutomation(message, policy);

  assert.deepEqual(decision, { code: 'ACCEPTED' });
  assert.equal(Object.isFrozen(decision), true);
});

void test('returns one deterministic rejection code at the first failing gate', () => {
  const cases = [
    [{ ...policy, enabled: false }, { code: 'BOT_DISABLED' }],
    [{ ...policy, targetGroupId: 'group_example_other' }, { code: 'TARGET_GROUP_MISMATCH' }],
    [{ ...policy, adminIds: ['admin_example_other'] }, { code: 'TRIGGER_NOT_ADMIN' }],
    [{ ...policy, keyword: 'other' }, { code: 'KEYWORD_NOT_MATCHED' }],
    [{ ...policy, enabled: false, targetGroupId: 'group_example_other' }, { code: 'BOT_DISABLED' }],
  ] as const;

  for (const [candidatePolicy, expected] of cases) {
    assert.deepEqual(evaluateAutomation(message, candidatePolicy), expected);
  }
});

void test('rejects malformed synthetic messages and policies without echoing input', () => {
  const marker = 'customer-content-must-not-leak';
  const accessorMessage: Record<string, unknown> = {};
  Object.defineProperties(accessorMessage, {
    groupId: { enumerable: true, value: message.groupId },
    senderId: { enumerable: true, value: message.senderId },
    text: {
      enumerable: true,
      get(): never {
        throw new Error(marker);
      },
    },
  });
  const hiddenExtraMessage = { ...message };
  Object.defineProperty(hiddenExtraMessage, 'rawPayload', { value: marker });
  const inheritedMessage = { ...message };
  Object.setPrototypeOf(inheritedMessage, { rawPayload: marker });
  const accessorAdmins = ['admin_example_one'];
  Object.defineProperty(accessorAdmins, '0', {
    enumerable: true,
    get(): never {
      throw new Error(marker);
    },
  });
  const inheritedAdmins = ['admin_example_one'];
  Object.setPrototypeOf(inheritedAdmins, { includes: () => true });

  for (const [candidateMessage, candidatePolicy] of [
    [{ ...message, text: marker, rawPayload: marker }, policy],
    [accessorMessage, policy],
    [hiddenExtraMessage, policy],
    [inheritedMessage, policy],
    [message, { ...policy, adminIds: accessorAdmins }],
    [message, { ...policy, adminIds: inheritedAdmins }],
    [message, { ...policy, adminIds: [] }],
    [message, { ...policy, keyword: '  ' }],
  ]) {
    assert.throws(
      () => evaluateAutomation(candidateMessage, candidatePolicy),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Invalid automation evaluation input' &&
        !error.message.includes(marker),
    );
  }
});
