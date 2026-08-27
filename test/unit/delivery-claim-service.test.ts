import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { RepositoryError } from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createDeliverySettlementPort } from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres, type DisposablePostgres } from '../support/disposable-postgres';
import { NoopLogger, NoopMetrics } from '../support/test-adapters';

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
  revision: 1,
};

void test('claims a prepared delivery for the exact current UUID tenant worker', async (t) => {
  const fixture = await createFixture(t);
  const claim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });

  assert.deepEqual(claim, {
    operation: {
      ...(await fixture.repository.loadDelivery(tenantId, operationId)),
      status: 'CLAIMED',
      claimOwner: 'claim_owner_one',
      claimFence: 1,
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
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    claimService(second, {
      ownerId: 'claim_owner_two',
      attemptId: attemptTwoId,
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

void test('uses database time for live claims, recovery, and one-winner reclaim', async (t) => {
  const fixture = await createFixture(t);
  const firstInput = {
    tenantId,
    operationId,
    attemptId: attemptOneId,
    claimOwner: 'claim_owner_database_time_one',
    now: '2099-08-22T07:00:00.000Z',
    leaseUntil: '2099-08-22T07:01:00.000Z',
    workerGeneration: 3,
    childId: 'child_example_3',
  };
  const first = await fixture.repository.claimDelivery(firstInput);
  const futureSkewedInput = {
    ...firstInput,
    attemptId: attemptTwoId,
    claimOwner: 'claim_owner_database_time_two',
    now: '2199-08-22T07:00:00.000Z',
    leaseUntil: '2199-08-22T07:01:00.000Z',
  };

  await assert.rejects(fixture.repository.claimDelivery(futureSkewedInput), {
    code: 'DELIVERY_CLAIM_CONFLICT',
  });
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, operationId))?.claimOwner,
    first.operation.claimOwner,
  );
  assert.equal(await fixture.repository.loadDeliveryAttempt(tenantId, attemptTwoId), undefined);

  const control = new Client(fixture.database.config);
  await control.connect();
  await control.query(
    `UPDATE delivery_operations
     SET claim_lease_until = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, operationId],
  );
  await control.end();
  const secondRepository = createRepository(fixture.database.config, fixture.authorization);
  await secondRepository.start();
  const contenders = [
    {
      ...futureSkewedInput,
      now: '1900-01-01T00:00:00.000Z',
      leaseUntil: '1900-01-01T00:01:00.000Z',
    },
    {
      ...futureSkewedInput,
      attemptId: '00000000-0000-4000-8000-000000000811',
      claimOwner: 'claim_owner_database_time_three',
      now: '1900-01-01T00:00:00.000Z',
      leaseUntil: '1900-01-01T00:01:00.000Z',
    },
  ];
  const reclaimed = await Promise.allSettled([
    fixture.repository.claimDelivery(contenders[0]!),
    secondRepository.claimDelivery(contenders[1]!),
  ]);
  assert.equal(reclaimed.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(reclaimed.filter((result) => result.status === 'rejected').length, 1);
  await secondRepository.stop();

  const recoveryOperationId = '00000000-0000-4000-8000-000000000812';
  const recoveryAttemptId = '00000000-0000-4000-8000-000000000813';
  await fixture.repository.prepareDelivery({
    id: recoveryOperationId,
    tenantId,
    operationKey: 'automation:database_time_recovery',
  });
  const recoveryClaim = await fixture.repository.claimDelivery({
    ...firstInput,
    operationId: recoveryOperationId,
    attemptId: recoveryAttemptId,
    claimOwner: 'claim_owner_database_time_recovery',
  });
  const recoveryAuthority = {
    operationId: recoveryOperationId,
    attemptId: recoveryAttemptId,
    claimFence: recoveryClaim.operation.claimFence,
    claimOwner: recoveryClaim.operation.claimOwner!,
    leaseUntil: recoveryClaim.operation.leaseUntil!,
    workerGeneration: 3,
    childId: 'child_example_3',
  };
  await fixture.repository.beginDelivery({ tenantId, ...recoveryAuthority });
  await assert.rejects(
    fixture.repository.claimDelivery({
      ...futureSkewedInput,
      operationId: recoveryOperationId,
      attemptId: '00000000-0000-4000-8000-000000000814',
    }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, recoveryOperationId))?.status,
    'SENDING',
  );
});

void test('requires the exact live claim owner and lease before send admission', async (t) => {
  const fixture = await createFixture(t);
  const claim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_authority',
    attemptId: attemptOneId,
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });
  const authority = {
    operationId,
    attemptId: attemptOneId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: 3,
    childId: 'child_example_3',
  };

  for (const stale of [
    { claimOwner: 'claim_owner_stale' },
    { leaseUntil: new Date(Date.parse(authority.leaseUntil) + 1_000).toISOString() },
  ]) {
    await assert.rejects(fixture.repository.beginDelivery({ tenantId, ...authority, ...stale }), {
      code: 'DELIVERY_CLAIM_CONFLICT',
    });
  }
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'CLAIMED');
  await expireLease(fixture.database.config, operationId);
  await assert.rejects(fixture.repository.beginDelivery({ tenantId, ...authority }), {
    code: 'DELIVERY_CLAIM_CONFLICT',
  });
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'CLAIMED');
});

void test('reclaims an expired lease with a higher fence and a new attempt', async (t) => {
  const fixture = await createFixture(t);
  const first = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });
  await expireLease(fixture.database.config, operationId);
  const second = await claimService(fixture.repository, {
    ownerId: 'claim_owner_two',
    attemptId: attemptTwoId,
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

void test('durably settles only the exact claimed operation, attempt, fence, and worker authority', async (t) => {
  const fixture = await createFixture(t);
  const claim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_one',
    attemptId: attemptOneId,
  }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' });

  const authority = {
    operationId,
    attemptId: attemptOneId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: 3,
    childId: 'child_example_3',
  };
  const begun = await fixture.repository.beginDelivery({ tenantId, ...authority });
  assert.equal(begun.operation.status, 'SENDING');

  const settled = await fixture.repository.settleDelivery({
    tenantId,
    ...authority,
    outcome: 'SENT',
    providerMessageId: 'provider_message_example_1',
  });

  assert.equal(settled.operation.status, 'SENT');
  assert.equal(settled.attempt.status, 'SENT');
  assert.equal(settled.attempt.providerMessageId, 'provider_message_example_1');
  const crashOperationId = '00000000-0000-4000-8000-000000000808';
  await fixture.repository.prepareDelivery({
    id: crashOperationId,
    tenantId,
    operationKey: 'automation:message_example_crash_boundary',
  });
  const crashClaim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_crash',
    attemptId: '00000000-0000-4000-8000-000000000809',
  }).claim({ operationId: crashOperationId, workerGeneration: 3, childId: 'child_example_3' });
  const crashAuthority = {
    operationId: crashOperationId,
    attemptId: crashClaim.attempt.id,
    claimFence: crashClaim.operation.claimFence,
    claimOwner: crashClaim.operation.claimOwner!,
    leaseUntil: crashClaim.operation.leaseUntil!,
    workerGeneration: 3,
    childId: 'child_example_3',
  };
  await fixture.repository.beginDelivery({ tenantId, ...crashAuthority });
  await expireLease(fixture.database.config, crashOperationId);
  await assert.rejects(
    fixture.repository.settleDelivery({
      tenantId,
      ...crashAuthority,
      outcome: 'AMBIGUOUS',
      providerMessageId: null,
    }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, crashOperationId))?.status,
    'SENDING',
  );
  const recovered = await claimService(fixture.repository, {
    ownerId: 'claim_owner_recovery',
    attemptId: '00000000-0000-4000-8000-000000000810',
  }).claim({ operationId: crashOperationId, workerGeneration: 3, childId: 'child_example_3' });
  assert.equal(recovered.operation.status, 'AMBIGUOUS');
  assert.equal(recovered.attempt.status, 'AMBIGUOUS');
  assert.equal(recovered.attempt.id, crashAuthority.attemptId);
  assert.equal(
    await fixture.repository.loadDeliveryAttempt(tenantId, '00000000-0000-4000-8000-000000000810'),
    undefined,
  );

  const settle = createDeliverySettlementPort({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  await assert.rejects(
    settle({
      operationId,
      attemptId: attemptOneId,
      claimFence: claim.operation.claimFence + 1,
      claimOwner: claim.operation.claimOwner!,
      leaseUntil: claim.operation.leaseUntil!,
      workerGeneration: 3,
      childId: 'child_example_3',
      outcome: 'AMBIGUOUS',
    }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );

  const nextOperationId = '00000000-0000-4000-8000-000000000806';
  const nextAttemptId = '00000000-0000-4000-8000-000000000807';
  await fixture.repository.prepareDelivery({
    id: nextOperationId,
    tenantId,
    operationKey: 'automation:message_example_stale_settlement',
  });
  const nextClaim = await claimService(fixture.repository, {
    ownerId: 'claim_owner_two',
    attemptId: nextAttemptId,
  }).claim({ operationId: nextOperationId, workerGeneration: 3, childId: 'child_example_3' });
  await fixture.workerRepository.compareAndSave(
    { ...currentWorker, state: 'STOPPED', childId: null, revision: 2 },
    currentWorker,
  );
  await assert.rejects(
    settle({
      operationId: nextOperationId,
      attemptId: nextAttemptId,
      claimFence: nextClaim.operation.claimFence,
      claimOwner: nextClaim.operation.claimOwner!,
      leaseUntil: nextClaim.operation.leaseUntil!,
      workerGeneration: 3,
      childId: 'child_example_3',
      outcome: 'AMBIGUOUS',
    }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
});

void test('denies stale, quarantined, and unauthorized worker claimants without writing an attempt', async (t) => {
  const fixture = await createFixture(t);
  const claims = [
    claimService(fixture.repository, {
      ownerId: 'claim_owner_stale',
      attemptId: attemptOneId,
    }).claim({ operationId, workerGeneration: 2, childId: 'child_example_3' }),
    claimService(fixture.repository, {
      ownerId: 'claim_owner_wrong_child',
      attemptId: attemptTwoId,
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_stale' }),
  ];
  for (const claim of claims) {
    await assert.rejects(claim, { code: 'DELIVERY_CLAIM_CONFLICT' });
  }

  await fixture.workerRepository.compareAndSave(
    { ...currentWorker, state: 'STOPPED', childId: null, revision: 2 },
    currentWorker,
  );
  await assert.rejects(
    claimService(fixture.repository, {
      ownerId: 'claim_owner_stopped',
      attemptId: attemptOneId,
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_3' }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  const stoppedWorker = {
    ...currentWorker,
    state: 'STOPPED' as const,
    childId: null,
    revision: 2,
  };
  const restartedWorker = { ...currentWorker, revision: 3 };
  await fixture.workerRepository.compareAndSave(restartedWorker, stoppedWorker);
  await fixture.workerRepository.compareAndSave(
    { ...restartedWorker, quarantined: true, revision: 4 },
    restartedWorker,
  );
  await assert.rejects(
    claimService(fixture.repository, {
      ownerId: 'claim_owner_quarantined',
      attemptId: attemptOneId,
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
      idGenerator: { generate: () => attemptTwoId },
    }).claim({ operationId, workerGeneration: 3, childId: 'child_example_other' }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  await assert.rejects(
    createDeliveryClaimService({
      repository: fixture.repository,
      trustedTenant: { tenantId: deniedTenantId },
      ownerId: 'claim_owner_denied',
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
  input: Readonly<{ ownerId: string; attemptId: string }>,
) {
  return createDeliveryClaimService({
    repository,
    trustedTenant: { tenantId },
    ownerId: input.ownerId,
    idGenerator: { generate: () => input.attemptId },
  });
}

async function expireLease(
  config: DisposablePostgres['config'],
  targetOperationId: string,
): Promise<void> {
  const client = new Client(config);
  await client.connect();
  try {
    await client.query(
      `UPDATE delivery_operations
       SET claim_lease_until = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, targetOperationId],
    );
  } finally {
    await client.end();
  }
}
