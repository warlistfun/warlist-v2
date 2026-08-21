import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import { simulateCommittedAutomation } from '../../src/modules/automation/application/active-automation-slice';
import { createAutomationConfigMutationService } from '../../src/modules/automation/application/automation-config-mutation-service';
import { MutableTenantAuthorization } from '../support/business-repository-contract';

const tenantId = '00000000-0000-4000-8000-000000000201';

void test('simulates one committed global-keyword active slice through normalized V2 boundaries', async () => {
  const fixture = await createFixture();
  const committed = await fixture.service.mutate({
    expectedRevision: 1,
    mutation: { field: 'keyword', value: 'global_keyword' },
  });
  const accepted = simulateCommittedAutomation(committed, {
    groupId: ' GROUP_EXAMPLE_ONE ',
    senderId: ' ADMIN_EXAMPLE_ONE ',
    text: ' global_keyword today ',
  });
  const rejected = simulateCommittedAutomation(committed, {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'other text',
  });

  assert.deepEqual(accepted, {
    revision: 2,
    policy: committed.policy,
    decision: { code: 'ACCEPTED' },
  });
  assert.deepEqual(rejected, {
    revision: 2,
    policy: committed.policy,
    decision: { code: 'KEYWORD_NOT_MATCHED' },
  });
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.isFrozen(accepted.policy), true);
  assert.equal(Object.isFrozen(accepted.decision), true);
  assert.strictEqual(accepted.policy, committed.policy);
  assert.strictEqual(rejected.policy, committed.policy);
  assert.deepEqual(fixture.propagated, []);
});

void test('keeps committed policy and deterministic closed decision unchanged across repeated synthetic runs', async () => {
  const fixture = await createFixture();
  const committed = await fixture.service.mutate({
    expectedRevision: 1,
    mutation: { field: 'keyword', value: 'global_keyword' },
  });
  const input = Object.freeze({
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'global_keyword',
  });

  const first = simulateCommittedAutomation(committed, input);
  const second = simulateCommittedAutomation(committed, input);

  assert.deepEqual(first, second);
  assert.deepEqual(committed, {
    revision: 2,
    policy: {
      enabled: true,
      targetGroupId: 'group_example_one',
      adminIds: ['admin_example_one'],
      keyword: 'global_keyword',
    },
  });
  assert.deepEqual(input, {
    groupId: 'group_example_one',
    senderId: 'admin_example_one',
    text: 'global_keyword',
  });
});

async function createFixture() {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_two' });
  await repository.compareAndSaveConfig(
    {
      tenantId,
      configuration: {
        automation: {
          enabled: true,
          targetGroupId: 'group_example_one',
          adminIds: ['admin_example_one'],
          keyword: 'initial_keyword',
        },
      },
    },
    null,
  );
  return {
    propagated: [],
    service: createAutomationConfigMutationService({
      repository,
      trustedTenant: { tenantId },
      validateGroupAdmins: () => true,
    }),
  };
}
