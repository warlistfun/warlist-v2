import assert from 'node:assert/strict';
import type test from 'node:test';

import {
  RepositoryError,
  type BusinessRepositoryPort,
  type TenantAuthorizationPort,
} from '../../src/app/business-repository';

const tenantOne = '00000000-0000-4000-8000-000000000101';
const tenantTwo = '00000000-0000-4000-8000-000000000102';
const tenantDenied = '00000000-0000-4000-8000-000000000103';

export class MutableTenantAuthorization implements TenantAuthorizationPort {
  readonly allowed = new Set<string>();

  assertAuthorized(tenantId: string): void {
    if (!this.allowed.has(tenantId)) {
      throw new RepositoryError('TENANT_ACCESS_DENIED');
    }
  }
}

export async function verifyBusinessRepositoryContract(
  t: test.TestContext,
  repository: BusinessRepositoryPort,
  authorization: MutableTenantAuthorization,
): Promise<void> {
  await repository.start();
  t.after(() => repository.stop());

  await t.test(
    'creates and loads immutable tenant records without crossing authorization',
    async () => {
      authorization.allowed.add(tenantOne);
      authorization.allowed.add(tenantTwo);

      const created = await repository.createTenant({
        id: tenantOne,
        publicOpsId: 'ops_example_contract_one',
      });
      assert.deepEqual(
        {
          id: created.id,
          publicOpsId: created.publicOpsId,
          status: created.status,
          schemaVersion: created.schemaVersion,
          revision: created.revision,
        },
        {
          id: tenantOne,
          publicOpsId: 'ops_example_contract_one',
          status: 'ACTIVE',
          schemaVersion: 1,
          revision: 1,
        },
      );
      assert.equal(Object.isFrozen(created), true);

      const loaded = await repository.loadTenant(tenantOne);
      assert.deepEqual(loaded, created);
      assert.notEqual(loaded, created);
      assert.equal(Object.isFrozen(loaded), true);

      await assert.rejects(
        repository.createTenant({ id: tenantTwo, publicOpsId: created.publicOpsId }),
        (error: unknown) => hasRepositoryCode(error, 'TENANT_ALREADY_EXISTS'),
      );
      await repository.createTenant({ id: tenantTwo, publicOpsId: 'ops_example_contract_two' });
      await assert.rejects(
        repository.createTenant({ id: tenantDenied, publicOpsId: 'ops_example_denied' }),
        (error: unknown) => hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
      );
      authorization.allowed.add(tenantDenied);
      assert.equal(await repository.loadTenant(tenantDenied), undefined);
      authorization.allowed.delete(tenantDenied);
    },
  );

  await t.test(
    'compares config revisions and preserves detached opaque state on conflict',
    async () => {
      const configuration = {
        enabled: false,
        nested: { keyword: 'example_keyword' },
        rules: ['first'],
      };
      const created = await repository.compareAndSaveConfig(
        { tenantId: tenantOne, configuration },
        null,
      );
      configuration.enabled = true;
      configuration.nested.keyword = 'mutated';
      configuration.rules.push('mutated');

      assert.equal(created.revision, 1);
      assert.equal(Object.isFrozen(created), true);
      assert.equal(Object.isFrozen(created.configuration), true);
      assert.equal(Object.isFrozen(created.configuration.nested), true);
      assert.equal(Object.isFrozen(created.configuration.rules), true);
      assert.deepEqual(created.configuration, {
        enabled: false,
        nested: { keyword: 'example_keyword' },
        rules: ['first'],
      });

      const updated = await repository.compareAndSaveConfig(
        { tenantId: tenantOne, configuration: { enabled: true } },
        1,
      );
      assert.equal(updated.revision, 2);
      await assert.rejects(
        repository.compareAndSaveConfig(
          { tenantId: tenantOne, configuration: { enabled: false } },
          1,
        ),
        (error: unknown) => hasRepositoryCode(error, 'CONFIG_VERSION_CONFLICT'),
      );
      assert.deepEqual((await repository.loadConfig(tenantOne))?.configuration, { enabled: true });

      await assert.rejects(repository.loadConfig(tenantDenied), (error: unknown) =>
        hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
      );
      await assert.rejects(
        repository.compareAndSaveConfig({ tenantId: tenantOne, configuration: [] as never }, 2),
        (error: unknown) => hasRepositoryCode(error, 'INVALID_REPOSITORY_INPUT'),
      );
    },
  );

  await t.test(
    'prepares deterministic deliveries without duplicate or cross-tenant access',
    async () => {
      const prepared = await repository.prepareDelivery({
        id: '00000000-0000-4000-8000-000000000201',
        tenantId: tenantOne,
        operationKey: 'automation:message_example_1',
      });
      assert.deepEqual(
        {
          id: prepared.id,
          tenantId: prepared.tenantId,
          operationKey: prepared.operationKey,
          status: prepared.status,
          schemaVersion: prepared.schemaVersion,
          revision: prepared.revision,
        },
        {
          id: '00000000-0000-4000-8000-000000000201',
          tenantId: tenantOne,
          operationKey: 'automation:message_example_1',
          status: 'PREPARED',
          schemaVersion: 1,
          revision: 1,
        },
      );
      assert.equal(Object.isFrozen(prepared), true);
      assert.deepEqual(await repository.loadDelivery(tenantOne, prepared.id), prepared);
      assert.deepEqual(
        await repository.loadDeliveryByOperationKey(tenantOne, prepared.operationKey),
        prepared,
      );

      const replay = await repository.prepareDelivery({
        ...prepared,
        id: '00000000-0000-4000-8000-000000000202',
      });
      assert.deepEqual(replay, prepared);
      await assert.rejects(
        repository.prepareDelivery({ ...prepared, operationKey: 'automation:message_example_2' }),
        (error: unknown) => hasRepositoryCode(error, 'DELIVERY_ALREADY_EXISTS'),
      );
      const attempt = await repository.createDeliveryAttempt({
        id: '00000000-0000-4000-8000-000000000204',
        tenantId: tenantOne,
        operationId: prepared.id,
        attemptNumber: 1,
      });
      assert.equal(attempt.status, 'PREPARED');
      assert.equal(Object.isFrozen(attempt), true);
      assert.deepEqual(await repository.loadDeliveryAttempt(tenantOne, attempt.id), attempt);
      await assert.rejects(
        repository.createDeliveryAttempt({
          ...attempt,
          id: '00000000-0000-4000-8000-000000000205',
        }),
        (error: unknown) => hasRepositoryCode(error, 'DELIVERY_ALREADY_EXISTS'),
      );
      await assert.rejects(
        repository.loadDeliveryAttempt(tenantDenied, attempt.id),
        (error: unknown) => hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
      );
      await assert.rejects(repository.loadDelivery(tenantDenied, prepared.id), (error: unknown) =>
        hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
      );
      await assert.rejects(
        repository.loadDeliveryByOperationKey(tenantDenied, prepared.operationKey),
        (error: unknown) => hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
      );
      assert.equal(
        await repository.loadDelivery(tenantTwo, '00000000-0000-4000-8000-000000000201'),
        undefined,
      );
      assert.equal(
        await repository.loadDeliveryByOperationKey(tenantTwo, prepared.operationKey),
        undefined,
      );
    },
  );

  await t.test('appends and reads a bounded frozen tenant audit trail', async () => {
    const first = await repository.appendAuditEvent({
      id: '00000000-0000-4000-8000-000000000301',
      tenantId: tenantOne,
      correlationId: 'correlation_example_1',
      actorType: 'SYSTEM',
      actorId: 'worker_example_1',
      action: 'CONFIG_CREATED',
      targetType: 'AUTOMATION_CONFIG',
      targetId: 'config_example_1',
    });
    const second = await repository.appendAuditEvent({
      id: '00000000-0000-4000-8000-000000000302',
      tenantId: tenantOne,
      correlationId: 'correlation_example_2',
      actorType: 'SYSTEM',
      actorId: null,
      action: 'DELIVERY_PREPARED',
      targetType: 'DELIVERY_OPERATION',
      targetId: null,
    });
    await repository.appendAuditEvent({
      id: '00000000-0000-4000-8000-000000000303',
      tenantId: tenantTwo,
      correlationId: 'correlation_example_other',
      actorType: 'SYSTEM',
      actorId: null,
      action: 'TENANT_CREATED',
      targetType: 'TENANT',
      targetId: null,
    });

    const events = await repository.readAuditEvents(tenantOne, 2);
    assert.equal(Object.isFrozen(events), true);
    assert.deepEqual(new Set(events.map(({ id }) => id)), new Set([first.id, second.id]));
    assert.equal(
      events.every((event) => Object.isFrozen(event)),
      true,
    );
    assert.equal(
      events.every(({ tenantId }) => tenantId === tenantOne),
      true,
    );

    await assert.rejects(repository.readAuditEvents(tenantOne, 101), (error: unknown) =>
      hasRepositoryCode(error, 'INVALID_REPOSITORY_INPUT'),
    );
    await assert.rejects(repository.readAuditEvents(tenantDenied, 1), (error: unknown) =>
      hasRepositoryCode(error, 'TENANT_ACCESS_DENIED'),
    );
  });
}

function hasRepositoryCode(error: unknown, code: RepositoryError['code']): boolean {
  return error instanceof RepositoryError && error.code === code;
}
