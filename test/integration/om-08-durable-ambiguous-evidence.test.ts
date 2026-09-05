import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import type { DeliveryClaimRecord } from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
  type AcceptedDeliverySend,
  type DeliveryAmbiguousCompletion,
  type DeliverySentCompletion,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createDisposablePostgres, type DisposablePostgres } from '../support/disposable-postgres';

const workerGeneration = 8;
const providerRejectionWorker = {
  tenantId: uuid(180),
  publicOpsId: 'ops_om_08_provider_rejection',
  workerGeneration,
  childId: 'child_om_08_provider_rejection',
} satisfies TenantAuthority;
const providerTimeoutWorker = {
  tenantId: uuid(200),
  publicOpsId: 'ops_om_08_provider_timeout',
  workerGeneration,
  childId: 'child_om_08_provider_timeout',
} satisfies TenantAuthority;
const settlementUncertaintyWorker = {
  tenantId: uuid(201),
  publicOpsId: 'ops_om_08_settlement_uncertainty',
  workerGeneration,
  childId: 'child_om_08_settlement_uncertainty',
} satisfies TenantAuthority;
const crashRecoveryWorker = {
  tenantId: uuid(202),
  publicOpsId: 'ops_om_08_crash_recovery',
  workerGeneration,
  childId: 'child_om_08_crash_recovery',
} satisfies TenantAuthority;
const staleWorker = {
  tenantId: uuid(203),
  publicOpsId: 'ops_om_08_stale_worker',
  workerGeneration,
  childId: 'child_om_08_stale_worker',
} satisfies TenantAuthority;
const restartReplayWorker = {
  tenantId: uuid(204),
  publicOpsId: 'ops_om_08_restart_replay',
  workerGeneration,
  childId: 'child_om_08_restart_replay',
} satisfies TenantAuthority;

void test('provider rejection, timeout, and settlement uncertainty persist exact ambiguous evidence', async (t) => {
  const fixture = await createFixture(t, [
    providerRejectionWorker,
    providerTimeoutWorker,
    settlementUncertaintyWorker,
    crashRecoveryWorker,
    staleWorker,
  ]);

  const rejected = await prepare(fixture, providerRejectionWorker, 181, 182, 'provider_rejection');
  const rejectedResult = await createSender(fixture, rejected, {
    sender: () => Promise.reject(new Error('synthetic provider outcome unknown')),
  }).send(input(rejected));
  await assertAmbiguous(fixture.repository, rejectedResult, rejected, null);

  const timedOut = await prepare(fixture, providerTimeoutWorker, 183, 184, 'provider_timeout');
  const timeoutScheduler = new ManualScheduler();
  const timeoutCompletion = createSender(fixture, timedOut, {
    sender: () => new Promise<Readonly<{ providerMessageId: string }>>(() => undefined),
    scheduler: timeoutScheduler,
  }).send(input(timedOut));
  await timeoutScheduler.scheduled;
  timeoutScheduler.fire();
  const timeoutResult = await timeoutCompletion;
  await assertAmbiguous(fixture.repository, timeoutResult, timedOut, null);

  const unsettled = await prepare(
    fixture,
    settlementUncertaintyWorker,
    185,
    186,
    'sent_settlement_unknown',
  );
  const settle = createDeliverySettlementPort({
    repository: fixture.repository,
    trustedTenant: { tenantId: unsettled.tenantId },
  });
  const unsettledResult = await createSender(fixture, unsettled, {
    sender: () => Promise.resolve({ providerMessageId: 'provider_message_om_08_known' }),
    settle: (authority) =>
      authority.outcome === 'SENT'
        ? Promise.reject(new Error('synthetic sent settlement outcome unknown'))
        : settle(authority),
  }).send(input(unsettled));
  await assertAmbiguous(
    fixture.repository,
    unsettledResult,
    unsettled,
    'provider_message_om_08_known',
  );

  const crashed = await prepare(fixture, crashRecoveryWorker, 187, 188, 'crash_recovery');
  await fixture.repository.beginDelivery(crashed);
  await expireLease(fixture.postgres, crashed.tenantId, crashed.operationId);
  const recovered = await recover(fixture, crashed, crashed.operationId, 189);
  const recoveredAuthority = { ...crashed, leaseUntil: recovered.operation.leaseUntil! };
  assert.equal(recovered.operation.status, 'AMBIGUOUS');
  assert.equal(recovered.attempt.id, crashed.attemptId);
  await assertAmbiguous(fixture.repository, completionFrom(recovered), recoveredAuthority, null);
  assert.equal(
    await fixture.repository.loadDeliveryAttempt(crashed.tenantId, uuid(189)),
    undefined,
  );

  const stale = await prepare(fixture, staleWorker, 190, 191, 'stale_worker_race');
  await fixture.repository.beginDelivery(stale);
  await expireLease(fixture.postgres, stale.tenantId, stale.operationId);
  const replacementWorker = {
    tenantId: stale.tenantId,
    workerGeneration: 9,
    childId: 'child_om_08_restart',
  } satisfies WorkerAuthority;
  await replaceWorker(fixture.postgres, replacementWorker);
  await assert.rejects(recover(fixture, stale, stale.operationId, 192), {
    code: 'DELIVERY_CLAIM_CONFLICT',
  });
  assert.equal(
    (await fixture.repository.loadDeliveryAttempt(stale.tenantId, stale.attemptId))?.status,
    'PREPARED',
  );
  const currentWorkerRecovery = await recover(fixture, replacementWorker, stale.operationId, 193);
  const currentWorkerAuthority = {
    ...stale,
    leaseUntil: currentWorkerRecovery.operation.leaseUntil!,
  };
  assert.equal(currentWorkerRecovery.operation.status, 'AMBIGUOUS');
  assert.equal(currentWorkerRecovery.attempt.id, stale.attemptId);
  await assertAmbiguous(
    fixture.repository,
    completionFrom(currentWorkerRecovery),
    currentWorkerAuthority,
    null,
  );
  assert.equal(await fixture.repository.loadDeliveryAttempt(stale.tenantId, uuid(193)), undefined);
});

void test('restart and replay read ambiguous evidence without invoking the provider sender', async (t) => {
  const fixture = await createFixture(t, [restartReplayWorker]);
  const authority = await prepare(fixture, restartReplayWorker, 194, 195, 'restart_replay');
  const first = await createSender(fixture, authority, {
    sender: () => Promise.reject(new Error('synthetic provider outcome unknown')),
  }).send(input(authority));
  await assertAmbiguous(fixture.repository, first, authority, null);

  await fixture.repository.stop();
  const replacementWorker = {
    tenantId: restartReplayWorker.tenantId,
    workerGeneration: 9,
    childId: 'child_om_08_restart',
  } satisfies WorkerAuthority;
  await replaceWorker(fixture.postgres, replacementWorker);
  const restartedRepository = createRepository(fixture.postgres);
  await restartedRepository.start();
  t.after(() => restartedRepository.stop());
  let sends = 0;
  let generatedAttempts = 0;
  const replay = createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId: authority.tenantId },
    claim: createDeliveryClaimService({
      repository: restartedRepository,
      trustedTenant: { tenantId: authority.tenantId },
      ownerId: 'claim_owner_om_08_restart',
      idGenerator: {
        generate: () => uuid(195 + ++generatedAttempts),
      },
    }).claim,
    begin: createDeliveryBeginPort({
      repository: restartedRepository,
      trustedTenant: { tenantId: authority.tenantId },
    }),
    sender: () => {
      sends += 1;
      return Promise.resolve({ providerMessageId: 'provider_message_must_not_send' });
    },
    settle: createDeliverySettlementPort({
      repository: restartedRepository,
      trustedTenant: { tenantId: authority.tenantId },
    }),
  });
  const replayInput = {
    ...input(authority),
    workerGeneration: replacementWorker.workerGeneration,
    childId: replacementWorker.childId,
  };

  assert.deepEqual(await replay.send(replayInput), first);
  assert.deepEqual(await replay.send(replayInput), first);
  assert.equal(sends, 0);
  assert.equal(generatedAttempts, 2);
  assert.equal(
    await restartedRepository.loadDeliveryAttempt(authority.tenantId, uuid(196)),
    undefined,
  );
  assert.equal(
    await restartedRepository.loadDeliveryAttempt(authority.tenantId, uuid(197)),
    undefined,
  );
});

interface Fixture {
  readonly postgres: DisposablePostgres;
  readonly repository: ReturnType<typeof createPostgresBusinessRepository>;
}

interface TenantAuthority {
  readonly tenantId: string;
  readonly publicOpsId: string;
  readonly workerGeneration: number;
  readonly childId: string;
}

interface WorkerAuthority {
  readonly tenantId: string;
  readonly workerGeneration: number;
  readonly childId: string;
}

interface Authority extends WorkerAuthority {
  readonly operationId: string;
  readonly attemptId: string;
  readonly claimOwner: string;
  readonly claimFence: number;
  readonly leaseUntil: string;
}

async function createFixture(
  t: test.TestContext,
  tenants: readonly TenantAuthority[],
): Promise<Fixture> {
  const postgres = await createDisposablePostgres(t, `warlist-v2-om-08-${process.pid}-`);
  const client = new Client(postgres.config);
  await client.connect();
  try {
    for (const tenant of tenants) {
      await client.query(`INSERT INTO tenants (id, public_ops_id) VALUES ($1, $2)`, [
        tenant.tenantId,
        tenant.publicOpsId,
      ]);
      await client.query(
        `INSERT INTO tenant_worker_ownerships
           (tenant_id, state, generation, child_id, quarantined, revision)
         VALUES ($1, 'RUNNING', $2, $3, false, 1)`,
        [tenant.tenantId, tenant.workerGeneration, tenant.childId],
      );
    }
  } finally {
    await client.end();
  }
  const repository = createRepository(postgres);
  await repository.start();
  t.after(() => repository.stop());
  return { postgres, repository };
}

function createRepository(postgres: DisposablePostgres) {
  return createPostgresBusinessRepository({
    config: postgres.config,
    authorization: { assertAuthorized: () => undefined },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { increment() {} },
  });
}

async function prepare(
  fixture: Fixture,
  worker: TenantAuthority,
  operationSuffix: number,
  attemptSuffix: number,
  key: string,
): Promise<Authority> {
  const operationId = uuid(operationSuffix);
  const attemptId = uuid(attemptSuffix);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId: worker.tenantId,
    operationKey: `automation:om_08_${key}`,
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: worker.tenantId },
    ownerId: `claim_owner_om_08_${key}`,
    idGenerator: { generate: () => attemptId },
  }).claim({
    operationId,
    workerGeneration: worker.workerGeneration,
    childId: worker.childId,
  });
  return {
    tenantId: worker.tenantId,
    operationId,
    attemptId,
    claimOwner: claim.operation.claimOwner!,
    claimFence: claim.operation.claimFence,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: worker.workerGeneration,
    childId: worker.childId,
  };
}

function createSender(
  fixture: Fixture,
  authority: Authority,
  options: Readonly<{
    sender: () => Promise<Readonly<{ providerMessageId: string }>>;
    scheduler?: ManualScheduler;
    settle?: ReturnType<typeof createDeliverySettlementPort>;
  }>,
) {
  return createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId: authority.tenantId },
    claim: () =>
      Promise.resolve({
        operation: {
          id: authority.operationId,
          tenantId: authority.tenantId,
          operationKey: 'automation:om_08_synthetic',
          status: 'CLAIMED',
          claimOwner: authority.claimOwner,
          claimFence: authority.claimFence,
          leaseUntil: authority.leaseUntil,
          workerGeneration: authority.workerGeneration,
          childId: authority.childId,
          schemaVersion: 1,
          revision: 2,
          createdAt: '2030-08-27T00:00:00.000Z',
          updatedAt: '2030-08-27T00:00:00.000Z',
        },
        attempt: {
          id: authority.attemptId,
          tenantId: authority.tenantId,
          operationId: authority.operationId,
          attemptNumber: 1,
          status: 'PREPARED',
          claimFence: authority.claimFence,
          providerMessageId: null,
          schemaVersion: 1,
          revision: 1,
          createdAt: '2030-08-27T00:00:00.000Z',
          updatedAt: '2030-08-27T00:00:00.000Z',
        },
      }),
    begin: createDeliveryBeginPort({
      repository: fixture.repository,
      trustedTenant: { tenantId: authority.tenantId },
    }),
    sender: options.sender,
    settle:
      options.settle ??
      createDeliverySettlementPort({
        repository: fixture.repository,
        trustedTenant: { tenantId: authority.tenantId },
      }),
    sendTimeoutMs: 30_000,
    scheduler: options.scheduler ?? new ManualScheduler(),
  });
}

async function recover(
  fixture: Fixture,
  worker: WorkerAuthority,
  operationId: string,
  attemptSuffix: number,
): Promise<DeliveryClaimRecord> {
  return createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: worker.tenantId },
    ownerId: `claim_owner_om_08_recovery_${attemptSuffix}`,
    idGenerator: { generate: () => uuid(attemptSuffix) },
  }).claim({
    operationId,
    workerGeneration: worker.workerGeneration,
    childId: worker.childId,
  });
}

async function expireLease(
  postgres: DisposablePostgres,
  tenantId: string,
  operationId: string,
): Promise<void> {
  const client = new Client(postgres.config);
  await client.connect();
  try {
    await client.query(
      `UPDATE delivery_operations
       SET claim_lease_until = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, operationId],
    );
  } finally {
    await client.end();
  }
}

async function replaceWorker(postgres: DisposablePostgres, worker: WorkerAuthority): Promise<void> {
  const client = new Client(postgres.config);
  await client.connect();
  try {
    await client.query(
      `UPDATE tenant_worker_ownerships
       SET state = 'RUNNING', generation = $2, child_id = $3,
           quarantined = false, revision = revision + 1
       WHERE tenant_id = $1`,
      [worker.tenantId, worker.workerGeneration, worker.childId],
    );
  } finally {
    await client.end();
  }
}

function completionFrom(record: DeliveryClaimRecord): DeliveryAmbiguousCompletion {
  assert.equal(record.operation.status, 'AMBIGUOUS');
  assert.equal(record.attempt.status, 'AMBIGUOUS');
  assert.ok(record.operation.claimOwner);
  assert.ok(record.operation.leaseUntil);
  assert.ok(record.operation.workerGeneration);
  assert.ok(record.operation.childId);
  return {
    outcome: 'AMBIGUOUS',
    manualReconciliationRequired: true,
    tenantId: record.operation.tenantId,
    operationId: record.operation.id,
    attemptId: record.attempt.id,
    claimFence: record.operation.claimFence,
    claimOwner: record.operation.claimOwner,
    leaseUntil: record.operation.leaseUntil,
    workerGeneration: record.operation.workerGeneration,
    childId: record.operation.childId,
    providerMessageId: record.attempt.providerMessageId,
  };
}

function input(authority: Authority): AcceptedDeliverySend {
  return {
    decisionCode: 'ACCEPTED',
    correlationId: `correlation_${authority.operationId.slice(-3)}`,
    tenantId: authority.tenantId,
    operationId: authority.operationId,
    workerGeneration: authority.workerGeneration,
    childId: authority.childId,
    target: 'synthetic_group_om_08',
    text: 'Synthetic OM-08 message',
  };
}

async function assertAmbiguous(
  repository: Fixture['repository'],
  result: DeliverySentCompletion | DeliveryAmbiguousCompletion,
  authority: Authority,
  providerMessageId: string | null,
): Promise<void> {
  if (result.outcome !== 'AMBIGUOUS') assert.fail('expected ambiguous delivery evidence');
  assert.deepEqual(result, {
    outcome: 'AMBIGUOUS',
    manualReconciliationRequired: true,
    tenantId: authority.tenantId,
    operationId: authority.operationId,
    attemptId: authority.attemptId,
    claimFence: authority.claimFence,
    claimOwner: authority.claimOwner,
    leaseUntil: authority.leaseUntil,
    workerGeneration: authority.workerGeneration,
    childId: authority.childId,
    providerMessageId,
  });
  const operation = await repository.loadDelivery(authority.tenantId, authority.operationId);
  const attempt = await repository.loadDeliveryAttempt(authority.tenantId, authority.attemptId);
  assert.equal(operation?.status, 'AMBIGUOUS');
  assert.equal(operation?.claimFence, authority.claimFence);
  assert.equal(operation?.claimOwner, authority.claimOwner);
  assert.equal(operation?.workerGeneration, authority.workerGeneration);
  assert.equal(operation?.childId, authority.childId);
  assert.equal(attempt?.status, 'AMBIGUOUS');
  assert.equal(attempt?.claimFence, authority.claimFence);
  assert.equal(attempt?.providerMessageId, providerMessageId);
}

class ManualScheduler {
  private task: (() => void) | undefined;
  private resolveScheduled: (() => void) | undefined;
  readonly scheduled = new Promise<void>((resolve) => {
    this.resolveScheduled = resolve;
  });

  schedule(delayMs: number, task: () => void): () => void {
    assert.equal(delayMs, 30_000);
    this.task = task;
    this.resolveScheduled?.();
    return () => {
      if (this.task === task) this.task = undefined;
    };
  }

  fire(): void {
    const task = this.task;
    assert.ok(task, 'provider timeout was not scheduled');
    this.task = undefined;
    task();
  }
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
}
