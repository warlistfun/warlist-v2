import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import { createActiveAutomationDecisionService } from '../../src/modules/automation/application/active-automation-decision-service';
import { MutableTenantAuthorization } from '../support/business-repository-contract';

const tenantId = '00000000-0000-4000-8000-000000000801';

void test('loads canonical config and decides a normalized active inbound slice before send', async () => {
  const repository = await createRepository(true);
  const observed: unknown[] = [];
  const service = createActiveAutomationDecisionService({
    repository,
    trustedTenant: { tenantId },
    state: {
      load(input) {
        observed.push(input);
        return Promise.resolve({
          hasEntitlement: false,
          duplicateMessage: false,
          deliveryExists: false,
        });
      },
    },
  });

  const result = await service.decide(
    {
      messageId: `message:${'a'.repeat(64)}`,
      message: {
        groupId: ' GROUP_EXAMPLE_ONE ',
        senderId: ' ADMIN_EXAMPLE_ONE ',
        text: ' Hello from active V2 ',
      },
    },
    600,
  );

  assert.deepEqual(result, { revision: 1, decision: { code: 'NO_ENTITLEMENT' } });
  assert.deepEqual(observed, [
    {
      tenantId,
      messageId: `message:${'a'.repeat(64)}`,
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'Hello from active V2',
      },
    },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.decision), true);
});

void test('persists accepted scheduled metadata once without reparsing replay text', async () => {
  const repository = await createRepository(true);
  const service = createActiveAutomationDecisionService({
    repository,
    trustedTenant: { tenantId },
    state: {
      async load({ messageId }) {
        const delivery = await repository.loadDeliveryByOperationKey(
          tenantId,
          `automation:${messageId}`,
        );
        return {
          hasEntitlement: true,
          duplicateMessage: false,
          deliveryExists: delivery !== undefined,
          delivery,
        };
      },
    },
  });
  const messageId = `message:${'c'.repeat(64)}`;
  const first = await service.decide(
    {
      messageId,
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'hello 29 Februari 2032 PUKUL 08.30',
      },
    },
    600,
  );
  const replay = await service.decide(
    {
      messageId,
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'hello 1 Januari 2033 PUKUL 10:00',
      },
    },
    600,
  );

  assert.deepEqual(first.decision, { code: 'ACCEPTED' });
  assert.deepEqual(replay.decision, { code: 'DELIVERY_ALREADY_EXISTS' });
  assert.equal(replay.operation?.id, first.operation?.id);
  assert.equal(replay.operation?.scheduledStartAt, '2032-02-29T01:30:00.000Z');
});

void test('accepts malformed and missing schedules with null metadata', async () => {
  const repository = await createRepository(true);
  const service = createActiveAutomationDecisionService({
    repository,
    trustedTenant: { tenantId },
    state: {
      load() {
        return Promise.resolve({
          hasEntitlement: true,
          duplicateMessage: false,
          deliveryExists: false,
        });
      },
    },
  });
  for (const [suffix, text] of [
    ['d', 'hello without a schedule'],
    ['e', 'hello 32 Januari 2032 PUKUL 08:30'],
  ]) {
    const messageId = `message:${suffix!.repeat(64)}`;
    assert.deepEqual(
      (
        await service.decide(
          {
            messageId,
            message: { groupId: 'group_example_one', senderId: 'admin_example_one', text },
          },
          600,
        )
      ).decision,
      { code: 'ACCEPTED' },
    );
    assert.equal(
      (await repository.loadDeliveryByOperationKey(tenantId, `automation:${messageId}`))
        ?.scheduledStartAt,
      null,
    );
  }
});

void test('stops at an earlier evaluator gate without loading delivery state', async () => {
  const repository = await createRepository(false);
  let stateReads = 0;
  const service = createActiveAutomationDecisionService({
    repository,
    trustedTenant: { tenantId },
    state: {
      load() {
        stateReads += 1;
        return Promise.resolve({
          hasEntitlement: true,
          duplicateMessage: false,
          deliveryExists: false,
        });
      },
    },
  });

  assert.deepEqual(
    await service.decide(
      {
        messageId: `message:${'b'.repeat(64)}`,
        message: {
          groupId: 'group_example_one',
          senderId: 'admin_example_one',
          text: 'hello',
        },
      },
      600,
    ),
    { revision: 1, decision: { code: 'BOT_DISABLED' } },
  );
  assert.equal(stateReads, 0);
});

async function createRepository(enabled: boolean) {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_active' });
  await repository.compareAndSaveConfig(
    {
      tenantId,
      configuration: {
        automation: {
          enabled,
          opsStatus: 'active',
          timeWindow: { enabled: true, startMinute: 540, endMinute: 1020 },
          targetGroupId: 'group_example_one',
          adminIds: ['admin_example_one'],
          keyword: 'hello',
        },
      },
    },
    null,
  );
  return repository;
}
