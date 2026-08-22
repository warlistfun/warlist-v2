import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { RepositoryError } from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { FixedClock, NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000801';
const otherTenantId = '00000000-0000-4000-8000-000000000898';
const deniedTenantId = '00000000-0000-4000-8000-000000000899';
const operationId = '00000000-0000-4000-8000-000000000802';
const attemptOneId = '00000000-0000-4000-8000-000000000803';
const attemptTwoId = '00000000-0000-4000-8000-000000000804';
const currentWorker = {
  tenantId,
  state: 'RUNNING' as const,
  generation: 3,
  childId: 'child_example_3',
  quarantined: false,
};

void test('claims a prepared delivery for the exact current UUID tenant worker', async (t) => {
  const fixture = await createFixture(t);
  const claim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
    now: '2030-08-22T07:00:00.000Z',
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });

  assert.deepEqual(claim, {
    operation: {
      ...(await fixture.repository.loadDelivery(tenantId, operationId)),
      status: 'CLAIMED',
      claimOwner: 'claim_owner_one',
      claimFence: 1,
      leaseUntil: '2030-08-22T07:01:00.000Z',
      workerGeneration: 3,
      childId: 'child_example_3',
    },
    attempt: await fixture.repository.loadDeliveryAttempt(tenantId, attemptOneId),
  });
  assert.equal(claim.attempt.attemptNumber, claim.operation.claimFence);
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(Object.isFrozen(claim.operation), true);
  assert.equal(Object.isFrozen(claim.attempt), true);
});

void test('allows exactly one winner across independent PostgreSQL claim contenders', async (t) => {
  const fixture = await createFixture(t);
  const second = createRepository(fixture.database.config, fixture.authorization);
  await second.start();
  t.after(() => second.stop());

  const claims = await Promise.allSettled([
    claimService(fixture.repository, {
      ownerId: 'claim_owner_one',
      attemptId: attemptOneId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    claimService(second, {
      ownerId: 'claim_owner_two',
      attemptId: attemptTwoId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
  ]);

  const winners = claims.filter((claim) => claim.status === 'fulfilled');
  const losers = claims.filter((claim) => claim.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(
    losers[0]?.status === 'rejected' &&
      losers[0].reason instanceof RepositoryError &&
      losers[0].reason.code,
    'DELIVERY_CLAIM_CONFLICT',
  );
  assert.equal(
    [
      await fixture.repository.loadDeliveryAttempt(tenantId, attemptOneId),
      await fixture.repository.loadDeliveryAttempt(tenantId, attemptTwoId),
    ].filter(Boolean).length,
    1,
  );
  await second.stop();
});

void test('reclaims an expired lease with a higher fence and a new attempt', async (t) => {
  const fixture = await createFixture(t);
  const first = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
    now: '2030-08-22T07:00:00.000Z',
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });
  const second = await claimService(fixture.repository, {
    ownerId: 'claim_owner_two',
    attemptId: attemptTwoId,
    now: '2030-08-22T07:01:00.000Z',
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });

  assert.equal(first.operation.claimFence, 1);
  assert.equal(first.attempt.attemptNumber, 1);
  assert.equal(second.operation.claimFence, 2);
  assert.equal(second.attempt.attemptNumber, 2);
  assert.equal(second.operation.claimOwner, 'claim_owner_two');
  assert.notEqual(first.operation.claimFence, second.operation.claimFence);
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.claimFence, 2);
});

void test('preserves a pre-existing attempt while fencing the claim attempt separately', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.createDeliveryAttempt({
    id: '00000000-0000-4000-8000-000000000805',
    tenantId,
    operationId,
    attemptNumber: 1,
  });

  const claim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
    now: '2030-08-22T07:00:00.000Z',
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });

  assert.equal(claim.operation.claimFence, 1);
  assert.equal(claim.attempt.attemptNumber, 2);
  assert.equal(claim.attempt.claimFence, 1);
  assert.equal(
    (await fixture.repository.loadDeliveryAttempt(tenantId, '00000000-0000-4000-8000-000000000805'))
      ?.claimFence,
    null,
  );
});

void test('denies stale, quarantined, and unauthorized worker claimants without writing an attempt', async (t) => {
  const fixture = await createFixture(t);
  const claims = [
    claimService(fixture.repository, {
      ownerId: 'claim_owner_stale',
      attemptId: attemptOneId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 2, childId: 'child_example_3' }),
    claimService(fixture.repository, {
      ownerId: 'claim_owner_wrong_child',
      attemptId: attemptTwoId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_stale' }),
  ];
  for (const claim of claims) {
    await assert.rejects(claim, { code: 'DELIVERY_CLAIM_CONFLICT' });
  }

  await fixture.workerRepository.compareAndSave(
    { ...currentWorker, state: 'STOPPED', childId: null },
    3,
  );
  await assert.rejects(
    claimService(fixture.repository, {
      ownerId: 'claim_owner_stopped',
      attemptId: attemptOneId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  await fixture.workerRepository.compareAndSave(currentWorker, 3);
  await fixture.workerRepository.compareAndSave({ ...currentWorker, quarantined: true }, 3);
  await assert.rejects(
    claimService(fixture.repository, {
      ownerId: 'claim_owner_quarantined',
      attemptId: attemptOneId,
      now: '2030-08-22T07:00:00.000Z',
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );

  fixture.authorization.allowed.add(otherTenantId);
  await fixture.repository.createTenant({
    id: otherTenantId,
    publicOpsId: 'ops_example_claim_other',
  });
  await fixture.workerRepository.compareAndSave(
    {
      ...currentWorker,
      tenantId: otherTenantId,
      childId: 'child_example_other',
    },
    null,
  );
  await assert.rejects(
    createDeliveryClaimService({
      repository: fixture.repository,
      trustedTenant: { tenantId: otherTenantId },
      ownerId: 'claim_owner_other',
      clock: new FixedClock(new Date('2030-08-22T07:00:00.000Z')),
      idGenerator: { generate: () => attemptTwoId },
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_other' }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  await assert.rejects(
    createDeliveryClaimService({
      repository: fixture.repository,
      trustedTenant: { tenantId: deniedTenantId },
      ownerId: 'claim_owner_denied',
      clock: new FixedClock(new Date('2030-08-22T07:00:00.000Z')),
      idGenerator: { generate: () => attemptTwoId },
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    { code: 'TENANT_ACCESS_DENIED' },
  );

  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'PREPARED');
  assert.equal(await fixture.repository.loadDeliveryAttempt(tenantId, attemptOneId), undefined);
  assert.equal(await fixture.repository.loadDeliveryAttempt(tenantId, attemptTwoId), undefined);
});

async function createFixture(t: test.TestContext) {
  const database = await createDisposablePostgres(t);
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createRepository(database.config, authorization);
  await repository.start();
  t.after(() => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_claim' });
  await repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:message_example_claim',
  });
  const workerClient = new Client(database.config);
  await workerClient.connect();
  t.after(() => workerClient.end());
  const workerRepository = createPostgresWorkerLifecycleStateRepository({
    client: workerClient,
    authorization,
  });
  await workerRepository.compareAndSave(currentWorker, null);
  return { database, authorization, repository, workerRepository };
}

function createRepository(
  config: Parameters<typeof createPostgresBusinessRepository>[0]['config'],
  authorization: MutableTenantAuthorization,
) {
  return createPostgresBusinessRepository({
    config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
}

function claimService(
  repository: ReturnType<typeof createPostgresBusinessRepository>,
  input: Readonly<{ ownerId: string; attemptId: string; now: string }>,
) {
  return createDeliveryClaimService({
    repository,
    trustedTenant: { tenantId },
    ownerId: input.ownerId,
    clock: new FixedClock(new Date(input.now)),
    idGenerator: { generate: () => input.attemptId },
  });
}
