import assert from 'node:assert/strict';
import test from 'node:test';

import { createClaimGatedDeliverySender } from '../../src/modules/delivery/application/claim-gated-delivery-sender';

const input = {
  operationId: '00000000-0000-4000-8000-000000000901',
  workerGeneration: 7,
  childId: 'child_example_7',
} as const;

function claimResult() {
  return {
    operation: {
      id: input.operationId,
      tenantId: '00000000-0000-4000-8000-000000000900',
      operationKey: 'automation:message_example_1',
      status: 'CLAIMED' as const,
      claimOwner: 'claim_owner_example',
      claimFence: 3,
      leaseUntil: '2030-08-22T07:01:00.000Z',
      workerGeneration: input.workerGeneration,
      childId: input.childId,
      schemaVersion: 1,
      revision: 2,
      createdAt: '2030-08-22T07:00:00.000Z',
      updatedAt: '2030-08-22T07:00:00.000Z',
    },
    attempt: {
      id: '00000000-0000-4000-8000-000000000902',
      tenantId: '00000000-0000-4000-8000-000000000900',
      operationId: input.operationId,
      attemptNumber: 1,
      status: 'PREPARED' as const,
      claimFence: 3,
      providerMessageId: null,
      schemaVersion: 1,
      revision: 1,
      createdAt: '2030-08-22T07:00:00.000Z',
      updatedAt: '2030-08-22T07:00:00.000Z',
    },
  };
}

void test('durably begins the exact returned claim before invoking sender and settles sent', async () => {
  const calls: string[] = [];
  const coordinator = createClaimGatedDeliverySender({
    claim: () => Promise.resolve(claimResult()),
    begin: (authority) => {
      calls.push(`begin:${authority.attemptId}:${authority.claimFence}`);
      return Promise.resolve();
    },
    sender: (authority) => {
      calls.push(`send:${authority.attemptId}:${authority.claimFence}`);
      return Promise.resolve({ providerMessageId: 'provider_message_example_1' });
    },
    settle: (authority) => {
      calls.push(`settle:${authority.outcome}:${authority.attemptId}:${authority.claimFence}`);
      return Promise.resolve();
    },
  });

  await coordinator.send(input);
  assert.deepEqual(calls, [
    'begin:00000000-0000-4000-8000-000000000902:3',
    'send:00000000-0000-4000-8000-000000000902:3',
    'settle:SENT:00000000-0000-4000-8000-000000000902:3',
  ]);
});

void test('does not invoke sender when durable begin rejects the authority', async () => {
  let sends = 0;
  const coordinator = createClaimGatedDeliverySender({
    claim: () => Promise.resolve(claimResult()),
    begin: () =>
      Promise.reject(
        Object.assign(new Error('Delivery claim conflict'), { code: 'DELIVERY_CLAIM_CONFLICT' }),
      ),
    sender: () => {
      sends++;
      return Promise.resolve({ providerMessageId: 'provider_message_example_1' });
    },
    settle: () => Promise.resolve(),
  });

  await assert.rejects(coordinator.send(input), { code: 'DELIVERY_CLAIM_CONFLICT' });
  assert.equal(sends, 0);
});

void test('settles a rejected sender as ambiguous without retrying', async () => {
  const outcomes: string[] = [];
  const coordinator = createClaimGatedDeliverySender({
    claim: () => Promise.resolve(claimResult()),
    begin: () => Promise.resolve(),
    sender: () => Promise.reject(new Error('synthetic transport failure')),
    settle: (authority) => {
      outcomes.push(authority.outcome);
      return Promise.resolve();
    },
  });

  await assert.rejects(coordinator.send(input), { message: 'synthetic transport failure' });
  assert.deepEqual(outcomes, ['AMBIGUOUS']);
});
