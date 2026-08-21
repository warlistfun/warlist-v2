import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';

const tenantId = '00000000-0000-4000-8000-000000000701';
const now = '2026-08-21T12:00:00.000Z';
const leaseUntil = '2026-08-21T12:01:00.000Z';

void test('claims one committed config sync and accepts only its matching acknowledgement', async () => {
  const repository = await createRepository('ops_example_outbox');
  const committed = await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { automation: { enabled: true } } },
    null,
  );
  assert.equal(committed.config.revision, 1);

  const [claimed] = await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now,
    leaseUntil,
    claimToken: 'claim_example_one',
  });
  assert.deepEqual(claimed, {
    tenantId,
    configRevision: 1,
    status: 'IN_FLIGHT',
    attempts: 1,
    claimToken: 'claim_example_one',
    leaseUntil,
    failureCode: null,
    nextAttemptAt: null,
  });

  await assert.rejects(
    repository.markAutomationConfigSyncApplied({
      tenantId,
      configRevision: 1,
      claimToken: 'claim_stale',
    }),
    { code: 'AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT' },
  );
  assert.deepEqual(await repository.readAutomationConfigSync(tenantId, 1), claimed);

  const applied = await repository.markAutomationConfigSyncApplied({
    tenantId,
    configRevision: 1,
    claimToken: 'claim_example_one',
  });
  assert.deepEqual(applied, { ...claimed, status: 'APPLIED', claimToken: null, leaseUntil: null });
});

void test('retryable failure becomes due after its backoff while non-retryable failure remains terminal', async () => {
  const repository = await createRepository('ops_example_outbox_failure');
  await repository.compareAndSaveConfigWithSync({ tenantId, configuration: { version: 1 } }, null);
  await repository.compareAndSaveConfigWithSync({ tenantId, configuration: { version: 2 } }, 1);
  const claimed = await repository.claimDueAutomationConfigSyncs({
    limit: 2,
    now,
    leaseUntil,
    claimToken: 'claim_retry',
  });
  assert.equal(claimed.length, 2);
  const retryable = await repository.recordAutomationConfigSyncFailure({
    tenantId,
    configRevision: 1,
    claimToken: 'claim_retry',
    retryable: true,
    failureCode: 'WA_RUNTIME_UNAVAILABLE',
    nextAttemptAt: '2026-08-21T12:02:00.000Z',
  });
  assert.deepEqual(retryable, {
    ...claimed[0],
    status: 'RETRYABLE_FAILURE',
    claimToken: null,
    leaseUntil: null,
    failureCode: 'WA_RUNTIME_UNAVAILABLE',
    nextAttemptAt: '2026-08-21T12:02:00.000Z',
  });
  const terminal = await repository.recordAutomationConfigSyncFailure({
    tenantId,
    configRevision: 2,
    claimToken: 'claim_retry',
    retryable: false,
    failureCode: 'WORKER_COMMAND_REJECTED',
    nextAttemptAt: null,
  });
  assert.equal(terminal.status, 'NON_RETRYABLE_FAILURE');
  assert.deepEqual(
    await repository.claimDueAutomationConfigSyncs({
      limit: 10,
      now: '2026-08-21T12:02:00.000Z',
      leaseUntil: '2026-08-21T12:03:00.000Z',
      claimToken: 'claim_later',
    }),
    [
      {
        ...retryable,
        status: 'IN_FLIGHT',
        attempts: 2,
        claimToken: 'claim_later',
        leaseUntil: '2026-08-21T12:03:00.000Z',
        failureCode: null,
        nextAttemptAt: null,
      },
    ],
  );
});

async function createRepository(publicOpsId: string) {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();
  await repository.createTenant({ id: tenantId, publicOpsId });
  return repository;
}
