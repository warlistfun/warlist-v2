import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAutomationConfigMutationService,
  type AutomationConfigMutation,
} from '../../src/modules/automation/application/automation-config-mutation-service';
import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';

const tenantId = '00000000-0000-4000-8000-000000000101';

void test('commits one field-scoped automation policy mutation with a pending exact-revision sync', async () => {
  const fixture = await createFixture();
  const result = await fixture.service.mutate({
    expectedRevision: 1,
    mutation: { field: 'keyword', value: 'welcome' },
  });

  assert.deepEqual(result, {
    revision: 2,
    policy: {
      enabled: true,
      targetGroupId: 'group_example_one',
      adminIds: ['admin_example_one'],
      keyword: 'welcome',
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.policy), true);
  assert.equal(Object.isFrozen(result.policy.adminIds), true);
  const saved = await fixture.repository.loadConfig(tenantId);
  assert.deepEqual(
    {
      tenantId: saved?.tenantId,
      configuration: saved?.configuration,
      schemaVersion: saved?.schemaVersion,
      revision: saved?.revision,
      createdAt: saved?.createdAt,
    },
    {
      tenantId,
      configuration: {
        unrelated: { preserved: true },
        automation: result.policy,
      },
      schemaVersion: 1,
      revision: 2,
      createdAt: fixture.createdAt,
    },
  );
  assert.deepEqual(await fixture.repository.readAutomationConfigSync(tenantId, 2), {
    tenantId,
    configRevision: 2,
    status: 'PENDING',
    attempts: 0,
    claimToken: null,
    leaseUntil: null,
    failureCode: null,
    nextAttemptAt: null,
  });
  assert.deepEqual(fixture.lookups, [{ tenantId, groupId: 'group_example_one' }]);
});

void test('preserves OPS status and time window while mutating one scoped field', async () => {
  const fixture = await createFixture({ extendedPolicy: true });

  const result = await fixture.service.mutate({
    expectedRevision: 1,
    mutation: { field: 'keyword', value: 'welcome' },
  });

  assert.deepEqual(result.policy, {
    enabled: true,
    opsStatus: 'active',
    timeWindow: { enabled: true, startMinute: 540, endMinute: 1020 },
    targetGroupId: 'group_example_one',
    adminIds: ['admin_example_one'],
    keyword: 'welcome',
  });
});

void test('rejects a stale mutation without propagation or silent field overwrite', async () => {
  const fixture = await createFixture();
  await fixture.service.mutate({
    expectedRevision: 1,
    mutation: { field: 'enabled', value: false },
  });

  await assert.rejects(
    fixture.service.mutate({
      expectedRevision: 1,
      mutation: { field: 'keyword', value: 'stale_keyword' },
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CONFIG_VERSION_CONFLICT' &&
      error.message === 'Configuration version conflict',
  );
  assert.deepEqual(fixture.lookups, [{ tenantId, groupId: 'group_example_one' }]);
  assert.deepEqual((await fixture.repository.loadConfig(tenantId))?.configuration, {
    unrelated: { preserved: true },
    automation: {
      enabled: false,
      targetGroupId: 'group_example_one',
      adminIds: ['admin_example_one'],
      keyword: 'hello',
    },
  });
});

void test('rejects a missing tenant group before persistence', async () => {
  const fixture = await createFixture({ group: null });

  await assert.rejects(
    fixture.service.mutate({
      expectedRevision: 1,
      mutation: { field: 'keyword', value: 'welcome' },
    }),
    { message: 'Invalid automation configuration' },
  );
  assert.deepEqual(fixture.lookups, [{ tenantId, groupId: 'group_example_one' }]);
  assert.deepEqual(
    (await fixture.repository.loadConfig(tenantId))?.configuration,
    initialConfiguration,
  );
});

void test('rejects when any configured admin is absent from current group membership', async () => {
  const fixture = await createFixture({ group: { adminIds: ['admin_example_one'] } });

  await assert.rejects(
    fixture.service.mutate({
      expectedRevision: 1,
      mutation: { field: 'adminIds', value: ['admin_example_one', 'admin_example_other'] },
    }),
    { message: 'Invalid automation configuration' },
  );
  assert.deepEqual(fixture.lookups, [{ tenantId, groupId: 'group_example_one' }]);
  assert.deepEqual(
    (await fixture.repository.loadConfig(tenantId))?.configuration,
    initialConfiguration,
  );
});

void test('rejects malformed mutations without revealing values or invoking dependencies', async () => {
  const fixture = await createFixture();
  const marker = 'synthetic-customer-content';

  for (const mutation of [
    { field: 'keyword', value: marker, extra: true },
    { field: 'unknown', value: 'group_example_one' },
    { field: 'enabled', value: 'true' },
    { field: 'adminIds', value: [] },
  ]) {
    await assert.rejects(
      fixture.service.mutate({
        expectedRevision: 1,
        mutation: mutation as AutomationConfigMutation,
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Invalid automation configuration mutation' &&
        !error.message.includes(marker),
    );
  }
  assert.deepEqual(fixture.lookups, []);
  assert.deepEqual(
    (await fixture.repository.loadConfig(tenantId))?.configuration,
    initialConfiguration,
  );
});

const initialConfiguration = Object.freeze({
  unrelated: Object.freeze({ preserved: true }),
  automation: Object.freeze({
    enabled: true,
    targetGroupId: 'group_example_one',
    adminIds: Object.freeze(['admin_example_one']),
    keyword: 'hello',
  }),
});

async function createFixture(
  options: Readonly<{
    group?: Readonly<{ adminIds: readonly string[] }> | null;
    extendedPolicy?: boolean;
  }> = {},
) {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_one' });
  const configuration = options.extendedPolicy
    ? {
        ...initialConfiguration,
        automation: {
          ...initialConfiguration.automation,
          opsStatus: 'active',
          timeWindow: { enabled: true, startMinute: 540, endMinute: 1020 },
        },
      }
    : initialConfiguration;
  const created = await repository.compareAndSaveConfig({ tenantId, configuration }, null);
  const lookups: Array<Readonly<{ tenantId: string; groupId: string }>> = [];
  const service = createAutomationConfigMutationService({
    repository,
    trustedTenant: { tenantId },
    groupDirectory: {
      loadGroup(input) {
        lookups.push(input);
        return Promise.resolve(
          options.group === undefined
            ? Object.freeze({ adminIds: Object.freeze(['admin_example_one']) })
            : options.group,
        );
      },
    },
  });
  return {
    service,
    repository,
    lookups,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}
