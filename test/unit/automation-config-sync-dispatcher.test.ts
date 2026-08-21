import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RepositoryError,
  createInMemoryBusinessRepository,
  type BusinessRepositoryPort,
} from '../../src/app/business-repository';
import { createAutomationConfigSyncDispatcher } from '../../src/modules/automation/application/automation-config-sync-dispatcher';
import { WorkerRuntimeError } from '../../src/modules/whatsapp/application/worker-runtime-service';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { FixedClock, SequenceIdGenerator } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000701';
const now = new Date('2026-08-21T12:00:00.000Z');

void test('dispatches the exact committed revision and applies only its matching claim', async () => {
  const repository = await createRepository();
  const committed = await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    null,
  );
  const updates: unknown[] = [];
  const dispatcher = createAutomationConfigSyncDispatcher({
    repository,
    worker: {
      applyConfig(input) {
        updates.push(input);
        return Promise.resolve({ ok: true });
      },
    },
    clock: new FixedClock(now),
    idGenerator: new SequenceIdGenerator('sync'),
  });

  const result = await dispatcher.dispatchOne();

  assert.equal(committed.config.revision, 1);
  assert.deepEqual(updates, [
    { tenantId, correlationId: 'sync-1', configVersion: committed.config.revision },
  ]);
  assert.equal(result?.status, 'APPLIED');
  assert.equal(
    (await repository.readAutomationConfigSync(tenantId, committed.config.revision))?.status,
    'APPLIED',
  );
});

void test('preserves canonical config and schedules retry when worker is unavailable', async () => {
  const repository = await createRepository();
  const committed = await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    null,
  );
  const dispatcher = createAutomationConfigSyncDispatcher({
    repository,
    worker: {
      applyConfig() {
        return Promise.reject(
          new WorkerRuntimeError('WA_RUNTIME_UNAVAILABLE', 'Worker runtime is unavailable', true),
        );
      },
    },
    clock: new FixedClock(now),
    idGenerator: new SequenceIdGenerator('retry'),
  });

  const failed = await dispatcher.dispatchOne();

  assert.equal(failed?.status, 'RETRYABLE_FAILURE');
  assert.equal(failed?.failureCode, 'WA_RUNTIME_UNAVAILABLE');
  assert.deepEqual(
    (await repository.loadConfig(tenantId))?.configuration,
    committed.config.configuration,
  );
});

void test('records rejection and timeout without rolling back canonical config', async () => {
  for (const [code, retryable, expectedStatus] of [
    ['WORKER_COMMAND_REJECTED', false, 'NON_RETRYABLE_FAILURE'],
    ['WORKER_COMMAND_TIMEOUT', true, 'RETRYABLE_FAILURE'],
  ] as const) {
    const repository = await createRepository();
    const committed = await repository.compareAndSaveConfigWithSync(
      { tenantId, configuration: { automation: { enabled: true } } },
      null,
    );
    const dispatcher = createAutomationConfigSyncDispatcher({
      repository,
      worker: {
        applyConfig() {
          return Promise.reject(new WorkerRuntimeError(code, 'Safe worker failure', retryable));
        },
      },
      clock: new FixedClock(now),
      idGenerator: new SequenceIdGenerator('failure'),
    });

    const failed = await dispatcher.dispatchOne();

    assert.equal(failed?.status, expectedStatus);
    assert.equal(failed?.failureCode, code);
    assert.deepEqual(
      (await repository.loadConfig(tenantId))?.configuration,
      committed.config.configuration,
    );
    await repository.stop();
  }
});

void test('recovers an expired claim and fences a stale acknowledgement', async () => {
  const repository = await createRepository();
  await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    null,
  );
  await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now: '2026-08-21T11:58:00.000Z',
    leaseUntil: '2026-08-21T11:59:00.000Z',
    claimToken: 'expired_claim',
  });
  const dispatcher = createAutomationConfigSyncDispatcher({
    repository,
    worker: { applyConfig: () => Promise.resolve({ ok: true }) },
    clock: new FixedClock(now),
    idGenerator: new SequenceIdGenerator('recovered'),
  });

  const applied = await dispatcher.dispatchOne();

  assert.equal(applied?.status, 'APPLIED');
  assert.equal(applied?.attempts, 2);
  await assert.rejects(
    repository.markAutomationConfigSyncApplied({
      tenantId,
      configRevision: 1,
      claimToken: 'expired_claim',
    }),
    { code: 'AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT' },
  );
});

void test('does not relabel a successful worker ACK when applied persistence fails', async () => {
  const repository = await createRepository();
  await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    null,
  );
  let failureWrites = 0;
  const failingRepository: BusinessRepositoryPort = {
    ...repository,
    markAutomationConfigSyncApplied() {
      return Promise.reject(new RepositoryError('DATABASE_UNAVAILABLE'));
    },
    recordAutomationConfigSyncFailure(input) {
      failureWrites += 1;
      return repository.recordAutomationConfigSyncFailure(input);
    },
  };
  const dispatcher = createAutomationConfigSyncDispatcher({
    repository: failingRepository,
    worker: { applyConfig: () => Promise.resolve({ ok: true }) },
    clock: new FixedClock(now),
    idGenerator: new SequenceIdGenerator('ack'),
  });

  await assert.rejects(dispatcher.dispatchOne(), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(failureWrites, 0);
});

async function createRepository() {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_dispatch' });
  return repository;
}
