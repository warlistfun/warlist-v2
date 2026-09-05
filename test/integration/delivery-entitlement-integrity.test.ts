import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { RepositoryError } from '../../src/app/business-repository';
import {
  createClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createDeliveryConfirmationAdmissionService } from '../../src/modules/delivery/application/delivery-confirmation-admission-service';
import { createDeliveryConfirmationService } from '../../src/modules/delivery/application/delivery-confirmation-service';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { FixedClock, NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000b01';
const worker = {
  tenantId,
  state: 'RUNNING' as const,
  generation: 4,
  childId: 'child_example_matrix',
  quarantined: false,
  revision: 1,
};

void test('adversarial matrix allows one synthetic sender call and never replays ambiguous delivery', async (t) => {
  const fixture = await createFixture(t);
  const operationId = '00000000-0000-4000-8000-000000000b02';
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:matrix_race',
  });

  let sends = 0;
  const contenders = [
    '00000000-0000-4000-8000-000000000b03',
    '00000000-0000-4000-8000-000000000b04',
  ].map((attemptId, index) =>
    createClaimGatedDeliverySender({
      claim: (input) =>
        createDeliveryClaimService({
          repository: index === 0 ? fixture.repository : fixture.secondRepository,
          trustedTenant: { tenantId },
          ownerId: `claim_owner_matrix_${index + 1}`,
          idGenerator: { generate: () => attemptId },
        }).claim(input),
      begin: createDeliveryBeginPort({
        repository: index === 0 ? fixture.repository : fixture.secondRepository,
        trustedTenant: { tenantId },
      }),
      settle: createDeliverySettlementPort({
        repository: index === 0 ? fixture.repository : fixture.secondRepository,
        trustedTenant: { tenantId },
      }),
      sender: () => {
        sends += 1;
        return Promise.resolve({ providerMessageId: 'provider_message_matrix_race' });
      },
    }),
  );

  const results = await Promise.allSettled(
    contenders.map((contender) =>
      contender.send({ operationId, workerGeneration: worker.generation, childId: worker.childId }),
    ),
  );
  assert.equal(sends, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

  const ambiguousWorker = await fixture.provisionTenant(
    '00000000-0000-4000-8000-000000000b30',
    'ops_example_phase6_matrix_ambiguous',
  );
  const ambiguousOperationId = '00000000-0000-4000-8000-000000000b05';
  await fixture.repository.prepareDelivery({
    id: ambiguousOperationId,
    tenantId: ambiguousWorker.tenantId,
    operationKey: 'automation:matrix_crash',
  });
  const crashSender = createClaimGatedDeliverySender({
    claim: (input) =>
      createDeliveryClaimService({
        repository: fixture.repository,
        trustedTenant: { tenantId: ambiguousWorker.tenantId },
        ownerId: 'claim_owner_matrix_crash',
        idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b06' },
      }).claim(input),
    begin: createDeliveryBeginPort({
      repository: fixture.repository,
      trustedTenant: { tenantId: ambiguousWorker.tenantId },
    }),
    settle: createDeliverySettlementPort({
      repository: fixture.repository,
      trustedTenant: { tenantId: ambiguousWorker.tenantId },
    }),
    sender: () => {
      sends += 1;
      return Promise.reject(new Error('synthetic crash after send admission'));
    },
  });
  await assert.rejects(
    crashSender.send({
      operationId: ambiguousOperationId,
      workerGeneration: ambiguousWorker.generation,
      childId: ambiguousWorker.childId,
    }),
  );
  assert.equal(
    (await fixture.repository.loadDelivery(ambiguousWorker.tenantId, ambiguousOperationId))?.status,
    'AMBIGUOUS',
  );
  const ambiguousReplay = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: ambiguousWorker.tenantId },
    ownerId: 'claim_owner_matrix_replay',
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b07' },
  }).claim({
    operationId: ambiguousOperationId,
    workerGeneration: ambiguousWorker.generation,
    childId: ambiguousWorker.childId,
  });
  assert.equal(ambiguousReplay.operation.status, 'AMBIGUOUS');
  assert.equal(ambiguousReplay.attempt.status, 'AMBIGUOUS');
  assert.equal(ambiguousReplay.attempt.id, '00000000-0000-4000-8000-000000000b06');
  assert.equal(
    await fixture.repository.loadDeliveryAttempt(
      ambiguousWorker.tenantId,
      '00000000-0000-4000-8000-000000000b07',
    ),
    undefined,
  );
  assert.equal(sends, 2);

  const staleClaimWorker = await fixture.provisionTenant(
    '00000000-0000-4000-8000-000000000b31',
    'ops_example_phase6_matrix_stale_claim',
  );
  await fixture.repository.prepareDelivery({
    id: '00000000-0000-4000-8000-000000000b11',
    tenantId: staleClaimWorker.tenantId,
    operationKey: 'automation:matrix_stale_claim',
  });
  const staleClaim = createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: staleClaimWorker.tenantId },
    ownerId: 'claim_owner_matrix_stale',
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b12' },
  });
  for (const stale of [
    { workerGeneration: staleClaimWorker.generation + 1, childId: staleClaimWorker.childId },
    { workerGeneration: staleClaimWorker.generation, childId: 'child_example_matrix_stale' },
  ]) {
    await assert.rejects(
      staleClaim.claim({
        operationId: '00000000-0000-4000-8000-000000000b11',
        ...stale,
      }),
      { code: 'DELIVERY_CLAIM_CONFLICT' },
    );
  }

  const staleSendWorker = await fixture.provisionTenant(
    '00000000-0000-4000-8000-000000000b32',
    'ops_example_phase6_matrix_stale_send',
  );
  const staleOperationId = '00000000-0000-4000-8000-000000000b13';
  const staleAttemptId = '00000000-0000-4000-8000-000000000b14';
  await fixture.repository.prepareDelivery({
    id: staleOperationId,
    tenantId: staleSendWorker.tenantId,
    operationKey: 'automation:matrix_stale_send',
  });
  const staleAuthority = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: staleSendWorker.tenantId },
    ownerId: 'claim_owner_matrix_stale_send',
    idGenerator: { generate: () => staleAttemptId },
  }).claim({
    operationId: staleOperationId,
    workerGeneration: staleSendWorker.generation,
    childId: staleSendWorker.childId,
  });
  const staleSend = {
    operationId: staleOperationId,
    attemptId: staleAttemptId,
    claimFence: staleAuthority.operation.claimFence,
    claimOwner: staleAuthority.operation.claimOwner!,
    leaseUntil: staleAuthority.operation.leaseUntil!,
    workerGeneration: staleSendWorker.generation,
    childId: staleSendWorker.childId,
  };
  for (const stale of [
    { childId: 'child_example_matrix_stale' },
    { workerGeneration: staleSendWorker.generation + 1 },
    { claimFence: staleSend.claimFence + 1 },
    { claimOwner: 'claim_owner_matrix_stale' },
    { leaseUntil: new Date(Date.parse(staleSend.leaseUntil) + 1_000).toISOString() },
  ]) {
    await assert.rejects(
      fixture.repository.beginDelivery({
        tenantId: staleSendWorker.tenantId,
        ...staleSend,
        ...stale,
      }),
      { code: 'DELIVERY_CLAIM_CONFLICT' },
    );
  }
  await fixture.repository.beginDelivery({ tenantId: staleSendWorker.tenantId, ...staleSend });
  for (const stale of [
    { childId: 'child_example_matrix_stale' },
    { workerGeneration: staleSendWorker.generation + 1 },
    { claimFence: staleSend.claimFence + 1 },
    { claimOwner: 'claim_owner_matrix_stale' },
    { leaseUntil: new Date(Date.parse(staleSend.leaseUntil) + 1_000).toISOString() },
  ]) {
    await assert.rejects(
      fixture.repository.settleDelivery({
        tenantId: staleSendWorker.tenantId,
        ...staleSend,
        ...stale,
        outcome: 'AMBIGUOUS',
        providerMessageId: null,
      }),
      { code: 'DELIVERY_CLAIM_CONFLICT' },
    );
  }
});

void test('serializes distinct active delivery preparation per tenant', async (t) => {
  const fixture = await createFixture(t);
  const tenantLock = new Client(fixture.database.config);
  const observer = new Client(fixture.database.config);
  await Promise.all([tenantLock.connect(), observer.connect()]);
  try {
    await tenantLock.query('BEGIN');
    await tenantLock.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    const first = fixture.repository.prepareDelivery({
      id: '00000000-0000-4000-8000-000000000b40',
      tenantId,
      operationKey: 'automation:concurrent_first',
    });
    void first.catch(() => undefined);
    await waitForLockWait(observer, 'INSERT INTO delivery_operations');
    const second = fixture.secondRepository.prepareDelivery({
      id: '00000000-0000-4000-8000-000000000b41',
      tenantId,
      operationKey: 'automation:concurrent_second',
    });
    void second.catch(() => undefined);
    await waitForLockWait(observer, 'INSERT INTO delivery_operations', 2);
    await tenantLock.query('COMMIT');
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  } finally {
    await tenantLock.query('ROLLBACK').catch(() => undefined);
    await Promise.all([tenantLock.end(), observer.end()]);
  }
});

void test('reclaim samples PostgreSQL time after waiting for operation serialization', async (t) => {
  const fixture = await createFixture(t);
  const operationId = '00000000-0000-4000-8000-000000000b20';
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:reclaim_after_lock_wait',
  });
  const first = await fixture.repository.claimDelivery({
    tenantId,
    operationId,
    attemptId: '00000000-0000-4000-8000-000000000b21',
    claimOwner: 'claim_owner_before_lock_wait',
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
  const operationLock = new Client(fixture.database.config);
  const observer = new Client(fixture.database.config);
  let reclaim: Promise<unknown> | undefined;
  await Promise.all([operationLock.connect(), observer.connect()]);
  try {
    await operationLock.query('BEGIN');
    await operationLock.query(
      'SELECT id FROM delivery_operations WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenantId, operationId],
    );
    const pending = fixture.secondRepository.claimDelivery({
      tenantId,
      operationId,
      attemptId: '00000000-0000-4000-8000-000000000b22',
      claimOwner: 'claim_owner_after_lock_wait',
      workerGeneration: worker.generation,
      childId: worker.childId,
    });
    reclaim = pending;
    void pending.catch(() => undefined);
    const queryStartedAt = await waitForLockWait(observer, 'locked_operation AS MATERIALIZED');
    const expired = await operationLock.query<{ claim_lease_until: Date }>(
      `UPDATE delivery_operations
       SET claim_lease_until = date_trunc('milliseconds', $3::timestamptz + interval '1 millisecond')
       WHERE tenant_id = $1 AND id = $2
       RETURNING claim_lease_until`,
      [tenantId, operationId, queryStartedAt],
    );
    assert.equal(expired.rowCount, 1);
    const expiredBeforeUnlock = await observer.query<{ expired: boolean }>(
      'SELECT clock_timestamp() >= $1::timestamptz AS expired',
      [expired.rows[0]?.claim_lease_until],
    );
    assert.equal(expiredBeforeUnlock.rows[0]?.expired, true);
    await operationLock.query('COMMIT');

    const claimed = await pending;
    assert.equal(claimed.operation.claimFence, first.operation.claimFence + 1);
    assert.equal(claimed.operation.claimOwner, 'claim_owner_after_lock_wait');
    assert.equal(claimed.attempt.id, '00000000-0000-4000-8000-000000000b22');
  } finally {
    await operationLock.query('ROLLBACK').catch(() => undefined);
    if (reclaim) await Promise.allSettled([reclaim]);
    await Promise.all([
      operationLock.end().catch(() => undefined),
      observer.end().catch(() => undefined),
    ]);
  }
});

void test('ownership loss wins before blocked send admission and prevents sender invocation', async (t) => {
  const fixture = await createFixture(t);
  const operationId = '00000000-0000-4000-8000-000000000b15';
  const attemptId = '00000000-0000-4000-8000-000000000b16';
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:ownership_loss_send',
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_ownership_loss_send',
    idGenerator: { generate: () => attemptId },
  }).claim({ operationId, workerGeneration: worker.generation, childId: worker.childId });

  let sends = 0;
  const sender = createClaimGatedDeliverySender({
    claim: () => Promise.resolve(claim),
    begin: createDeliveryBeginPort({ repository: fixture.repository, trustedTenant: { tenantId } }),
    settle: createDeliverySettlementPort({
      repository: fixture.repository,
      trustedTenant: { tenantId },
    }),
    sender: () => {
      sends += 1;
      return Promise.resolve({ providerMessageId: 'provider_message_ownership_loss_send' });
    },
  });
  const { admission } = await blockAdmissionBehindOwnershipLoss(
    fixture,
    operationId,
    'locked_claim AS MATERIALIZED',
    () =>
      sender.send({
        operationId,
        workerGeneration: worker.generation,
        childId: worker.childId,
      }),
  );

  await assert.rejects(admission, { code: 'DELIVERY_CLAIM_CONFLICT' });
  assert.equal(sends, 0);
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'CLAIMED');
  assert.equal(
    (await fixture.repository.loadDeliveryAttempt(tenantId, attemptId))?.status,
    'PREPARED',
  );
});

void test('ownership loss wins before blocked confirmation and prevents debit', async (t) => {
  const fixture = await createFixture(t);
  const operationId = '00000000-0000-4000-8000-000000000b17';
  const attemptId = '00000000-0000-4000-8000-000000000b18';
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:ownership_loss_confirmation',
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_ownership_loss_confirmation',
    idGenerator: { generate: () => attemptId },
  }).claim({ operationId, workerGeneration: worker.generation, childId: worker.childId });
  const authority = {
    operationId,
    attemptId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: worker.generation,
    childId: worker.childId,
  };
  await fixture.repository.beginDelivery({ tenantId, ...authority });
  await fixture.repository.settleDelivery({
    tenantId,
    ...authority,
    outcome: 'SENT',
    providerMessageId: 'provider_message_ownership_loss_confirmation',
  });
  await admitConfirmation(fixture, 'inbound_confirmation_ownership_loss');
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-02T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b19' },
  });
  const { admission } = await blockAdmissionBehindOwnershipLoss(
    fixture,
    operationId,
    'locked_confirmation AS MATERIALIZED',
    () => confirmation.confirm(authority),
  );

  await assert.rejects(admission, { code: 'DELIVERY_CLAIM_CONFLICT' });
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENT');
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
});

void test('adversarial matrix fences stale authority and makes confirmation replay debit once', async (t) => {
  const fixture = await createFixture(t);
  const operationId = '00000000-0000-4000-8000-000000000b08';
  const attemptId = '00000000-0000-4000-8000-000000000b09';
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:matrix_confirm',
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_matrix_confirm',
    idGenerator: { generate: () => attemptId },
  }).claim({ operationId, workerGeneration: worker.generation, childId: worker.childId });
  const authority = {
    operationId,
    attemptId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: worker.generation,
    childId: worker.childId,
  };
  await fixture.repository.beginDelivery({ tenantId, ...authority });
  await fixture.repository.settleDelivery({
    tenantId,
    ...authority,
    outcome: 'SENT',
    providerMessageId: 'provider_message_matrix_confirm',
  });
  await admitConfirmation(fixture, 'inbound_confirmation_matrix');
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-01T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b10' },
  });
  const first = await confirmation.confirm(authority);
  const replay = await confirmation.confirm(authority);
  assert.deepEqual(replay, first);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);

  for (const stale of [
    { ...authority, claimFence: authority.claimFence + 1 },
    { ...authority, claimOwner: 'claim_owner_matrix_stale' },
    { ...authority, workerGeneration: authority.workerGeneration + 1 },
    { ...authority, childId: 'child_example_matrix_stale' },
  ]) {
    await assert.rejects(
      confirmation.confirm(stale),
      (error: unknown) =>
        error instanceof RepositoryError && error.code === 'DELIVERY_CLAIM_CONFLICT',
    );
  }
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
});

async function admitConfirmation(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  confirmationMessageId: string,
): Promise<void> {
  await createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  }).admit({
    tenantId,
    confirmationMessageId,
    publicOpsId: 'ops_example_phase6_matrix',
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
}

async function blockAdmissionBehindOwnershipLoss<T>(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  operationId: string,
  queryMarker: string,
  admit: () => Promise<T>,
): Promise<Readonly<{ admission: Promise<T> }>> {
  const operationLock = new Client(fixture.database.config);
  const ownershipTransition = new Client(fixture.database.config);
  const observer = new Client(fixture.database.config);
  let admission: Promise<T> | undefined;
  await Promise.all([operationLock.connect(), ownershipTransition.connect(), observer.connect()]);
  try {
    await operationLock.query('BEGIN');
    await operationLock.query(
      'SELECT id FROM delivery_operations WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenantId, operationId],
    );
    await ownershipTransition.query('BEGIN');
    await createPostgresWorkerLifecycleStateRepository({
      client: ownershipTransition,
      authorization: fixture.authorization,
    }).compareAndSave(
      { ...worker, state: 'STOPPED', childId: null, revision: worker.revision + 1 },
      worker,
    );

    admission = admit();
    void admission.catch(() => undefined);
    await waitForLockWait(observer, queryMarker);
    await ownershipTransition.query('COMMIT');
    const stopped = await observer.query<{ state: string; revision: string }>(
      `SELECT state, revision::text AS revision
       FROM tenant_worker_ownerships WHERE tenant_id = $1`,
      [tenantId],
    );
    assert.deepEqual(stopped.rows[0], { state: 'STOPPED', revision: '2' });
    await operationLock.query('COMMIT');
    await Promise.allSettled([admission]);
    return Object.freeze({ admission });
  } finally {
    await Promise.all([
      ownershipTransition.query('ROLLBACK').catch(() => undefined),
      operationLock.query('ROLLBACK').catch(() => undefined),
    ]);
    if (admission) await Promise.allSettled([admission]);
    await Promise.all([
      operationLock.end().catch(() => undefined),
      ownershipTransition.end().catch(() => undefined),
      observer.end().catch(() => undefined),
    ]);
  }
}

async function waitForLockWait(
  client: Client,
  queryMarker: string,
  minimumWaiters = 1,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ query_start: Date }>(
      `SELECT query_start
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND position($1 in query) > 0`,
      [queryMarker],
    );
    const queryStartedAt = result.rows[0]?.query_start.toISOString();
    if (queryStartedAt && result.rows.length >= minimumWaiters) return queryStartedAt;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const activity = await client.query<{
    application_name: string;
    state: string;
    wait_event_type: string | null;
    query: string;
  }>(
    `SELECT application_name, state, wait_event_type, query
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
     ORDER BY pid`,
  );
  throw new Error(
    `admission query did not reach a PostgreSQL lock wait: ${queryMarker}; ${JSON.stringify(activity.rows)}`,
  );
}

async function createFixture(t: test.TestContext) {
  const database = await createDisposablePostgres(t, 'warlist-pg16-phase6-matrix-');
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const createRepository = () =>
    createPostgresBusinessRepository({
      config: database.config,
      authorization,
      logger: new NoopLogger(),
      metrics: new NoopMetrics(),
    });
  const repository = createRepository();
  const secondRepository = createRepository();
  await repository.start();
  await secondRepository.start();
  t.after(() => repository.stop());
  t.after(() => secondRepository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_phase6_matrix' });
  const client = new Client(database.config);
  await client.connect();
  t.after(() => client.end());
  await createPostgresWorkerLifecycleStateRepository({ client, authorization }).compareAndSave(
    worker,
    null,
  );
  const provisionTenant = async (id: string, publicOpsId: string) => {
    const tenantWorker = { ...worker, tenantId: id };
    authorization.allowed.add(id);
    await repository.createTenant({ id, publicOpsId });
    await createPostgresWorkerLifecycleStateRepository({ client, authorization }).compareAndSave(
      tenantWorker,
      null,
    );
    return tenantWorker;
  };
  return { repository, secondRepository, database, authorization, provisionTenant };
}
