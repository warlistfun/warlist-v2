import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAutomation } from '../../src/modules/automation/application/automation-evaluator';
import { normalizeSyntheticInboundMessage } from '../../src/modules/automation/application/inbound-message-normalizer';

void test('normalizes one synthetic inbound message into a frozen canonical evaluator input', () => {
  const input = {
    groupId: ' GROUP_Example_One ',
    senderId: ' ADMIN_Example_One ',
    text: '  Cafe\u0301\r\nSecond\rThird\u2028Fourth\u2029Fifth LINE  ',
  };
  const original = { ...input };

  const normalized = normalizeSyntheticInboundMessage(input);

  assert.deepEqual(normalized, {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'Café\nSecond\nThird\nFourth\nFifth LINE',
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.deepEqual(input, original);
  assert.deepEqual(
    evaluateAutomation(normalized, {
      enabled: true,
      targetGroupId: 'group_example_one',
      adminIds: ['admin_example_one'],
      keyword: 'café',
    }),
    { code: 'ACCEPTED' },
  );
});

void test('rejects unsafe synthetic input with one stable error without reading or echoing it', () => {
  const marker = 'customer-content-must-not-leak';
  const accessor = { groupId: 'group_example_one', senderId: 'admin_example_one' };
  Object.defineProperty(accessor, 'text', {
    enumerable: true,
    get(): never {
      throw new Error(marker);
    },
  });
  const hiddenExtra = {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'hello',
  };
  Object.defineProperty(hiddenExtra, 'rawPayload', { value: marker });
  const symbolExtra = {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'hello',
    [Symbol('rawPayload')]: marker,
  };
  const inherited = {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'hello',
  };
  Object.setPrototypeOf(inherited, { rawPayload: marker });

  for (const candidate of [
    null,
    {
      groupId: 'group_example_one',
      senderId: 'admin_example_one',
      text: 'hello',
      rawPayload: marker,
    },
    accessor,
    hiddenExtra,
    symbolExtra,
    inherited,
    { groupId: 'bad id', senderId: 'admin_example_one', text: 'hello' },
    { groupId: 'a'.repeat(161), senderId: 'admin_example_one', text: 'hello' },
    { groupId: 'group_example_one', senderId: 'admin_example_one', text: 'hello\u0000world' },
    { groupId: 'group_example_one', senderId: 'admin_example_one', text: 'x'.repeat(4_097) },
    { groupId: 'group_example_one', senderId: 'admin_example_one', text: '   ' },
  ]) {
    assert.throws(
      () => normalizeSyntheticInboundMessage(candidate),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Invalid synthetic inbound message' &&
        !error.message.includes(marker),
    );
  }
});
