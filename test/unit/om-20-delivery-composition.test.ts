import assert from 'node:assert/strict';
import test from 'node:test';

import { createOm20DeliveryComposition } from '../../src/modules/delivery/application/om-20-delivery-composition';

const tenantId = '00000000-0000-4000-8000-000000000200';
const operationId = '00000000-0000-4000-8000-000000000201';
const attemptId = '00000000-0000-4000-8000-000000000202';
const groupId = `group:${'a'.repeat(64)}`;
const adminId = `sender:${'b'.repeat(64)}`;
const worker = { workerGeneration: 3, childId: 'child_om_20' } as const;

void test('routes only an authorized correlated OPS confirmation before trigger evaluation', async () => {
  for (const [expected, message] of [
    ['CONFIRMED', { groupId, senderId: adminId, text: 'OPS ops_example_om_20 sudah selesai' }],
    [
      'WRONG_GROUP',
      {
        groupId: `group:${'c'.repeat(64)}`,
        senderId: adminId,
        text: 'OPS ops_example_om_20 sudah selesai',
      },
    ],
    [
      'SENDER_NOT_ADMIN',
      {
        groupId,
        senderId: `sender:${'d'.repeat(64)}`,
        text: 'OPS ops_example_om_20 sudah selesai',
      },
    ],
  ] as const) {
    const calls: string[] = [];
    const composition = createOm20DeliveryComposition({
      trustedTenant: { tenantId },
      repository: {
        loadTenant: () =>
          Promise.resolve({
            id: tenantId,
            publicOpsId: 'ops_example_om_20',
            status: 'ACTIVE',
          }),
        loadConfig: () =>
          Promise.resolve({
            revision: 4,
            configuration: {
              automation: {
                enabled: true,
                targetGroupId: groupId,
                adminIds: [adminId],
                keyword: 'list',
              },
            },
          }),
        loadDelivery: () =>
          Promise.resolve({
            id: operationId,
            tenantId,
            operationKey: 'automation:message_trigger_om_20',
            status: 'SENT',
            claimOwner: 'claim_owner_om_20',
            claimFence: 1,
            leaseUntil: '2030-01-02T02:00:00.000Z',
            workerGeneration: worker.workerGeneration,
            childId: worker.childId,
            scheduledStartAt: '2030-01-02T01:30:00.000Z',
          }),
      },
      decision: {
        decide: ({ message: inbound }) => {
          calls.push('decide');
          return Promise.resolve({
            revision: 4,
            decision: {
              code: inbound.groupId !== groupId ? 'WRONG_GROUP' : 'SENDER_NOT_ADMIN',
            },
          });
        },
      },
      delivery: {
        send: () => {
          calls.push('send');
          return Promise.reject(new Error('confirmation must not create a delivery'));
        },
      },
      admission: {
        admit: (input: unknown) => {
          calls.push('admit');
          assert.deepEqual(input, {
            tenantId,
            confirmationMessageId: 'message_confirmation_om_20',
            publicOpsId: 'ops_example_om_20',
            ...worker,
          });
          return Promise.resolve({
            outcome: 'CONFIRMED' as const,
            tenantId,
            operationId,
            attemptId,
            confirmationMessageId: 'message_confirmation_om_20',
            confirmedAt: '2030-01-02T01:45:00.000Z',
          });
        },
      },
      confirmation: {
        confirm: (authority: unknown) => {
          calls.push('confirm');
          assert.deepEqual(authority, {
            operationId,
            attemptId,
            claimFence: 1,
            claimOwner: 'claim_owner_om_20',
            leaseUntil: '2030-01-02T02:00:00.000Z',
            ...worker,
          });
          return Promise.resolve({
            operation: {
              id: operationId,
              status: 'CONFIRMED',
              scheduledStartAt: '2030-01-02T01:30:00.000Z',
            },
            confirmedAt: '2030-01-02T01:45:00.000Z',
          });
        },
      },
    });

    const result = await composition.handle({
      tenantId,
      messageId: 'message_confirmation_om_20',
      correlationId: 'correlation_confirmation_om_20',
      ...worker,
      message,
    });

    assert.equal(result.code, expected);
    assert.deepEqual(calls, expected === 'CONFIRMED' ? ['admit', 'confirm'] : ['decide']);
  }
});
