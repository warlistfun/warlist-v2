import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAutomation } from '../../src/modules/automation/application/automation-evaluator';

const policy = {
  enabled: true,
  opsStatus: 'active',
  timeWindow: { enabled: true, startMinute: 540, endMinute: 1020 },
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
  const decision = evaluateAutomation(message, policy, 600);

  assert.deepEqual(decision, { code: 'ACCEPTED' });
  assert.equal(Object.isFrozen(decision), true);
});

void test('returns one deterministic rejection code at the first failing gate', () => {
  const cases = [
    [{ ...policy, enabled: false }, { code: 'BOT_DISABLED' }],
    [{ ...policy, opsStatus: 'inactive' }, { code: 'OPS_STATUS_INACTIVE' }],
    [
      { ...policy, timeWindow: { enabled: true, startMinute: 601, endMinute: 700 } },
      { code: 'OUTSIDE_SCHEDULE' },
    ],
    [{ ...policy, targetGroupId: 'group_example_other' }, { code: 'WRONG_GROUP' }],
    [{ ...policy, adminIds: ['admin_example_other'] }, { code: 'SENDER_NOT_ADMIN' }],
    [{ ...policy, keyword: 'other' }, { code: 'KEYWORD_NOT_MATCHED' }],
    [{ ...policy, enabled: false, opsStatus: 'inactive' }, { code: 'BOT_DISABLED' }],
  ] as const;

  for (const [candidatePolicy, expected] of cases) {
    assert.deepEqual(evaluateAutomation(message, candidatePolicy, 600), expected);
  }
});

void test('uses inclusive normal and overnight time windows from injected minute-of-day', () => {
  for (const [timeWindow, currentMinute, expected] of [
    [{ enabled: true, startMinute: 540, endMinute: 1020 }, 540, 'ACCEPTED'],
    [{ enabled: true, startMinute: 540, endMinute: 1020 }, 1020, 'ACCEPTED'],
    [{ enabled: true, startMinute: 1320, endMinute: 360 }, 1320, 'ACCEPTED'],
    [{ enabled: true, startMinute: 1320, endMinute: 360 }, 360, 'ACCEPTED'],
    [{ enabled: true, startMinute: 1320, endMinute: 360 }, 720, 'OUTSIDE_SCHEDULE'],
    [{ enabled: false, startMinute: 540, endMinute: 1020 }, 0, 'ACCEPTED'],
  ] as const) {
    assert.deepEqual(evaluateAutomation(message, { ...policy, timeWindow }, currentMinute), {
      code: expected,
    });
  }
});

void test('rejects unavailable entitlement, duplicate inbound, and existing delivery in order', () => {
  for (const [state, expected] of [
    [{ hasEntitlement: false, duplicateMessage: true, deliveryExists: true }, 'NO_ENTITLEMENT'],
    [{ hasEntitlement: true, duplicateMessage: true, deliveryExists: true }, 'DUPLICATE_MESSAGE'],
    [
      { hasEntitlement: true, duplicateMessage: false, deliveryExists: true },
      'DELIVERY_ALREADY_EXISTS',
    ],
    [{ hasEntitlement: true, duplicateMessage: false, deliveryExists: false }, 'ACCEPTED'],
  ] as const) {
    assert.deepEqual(evaluateAutomation(message, policy, 600, state), { code: expected });
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
