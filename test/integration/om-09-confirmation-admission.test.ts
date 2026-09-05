import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createDeliveryConfirmationAdmissionService } from '../../src/modules/delivery/application/delivery-confirmation-admission-service';
import { createDeliveryConfirmationService } from '../../src/modules/delivery/application/delivery-confirmation-service';
import { createDeliveryManualRecoveryService } from '../../src/modules/delivery/application/delivery-manual-recovery-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { FixedClock, NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000c01';
const foreignTenantId = '00000000-0000-4000-8000-000000000c02';
const recoveryTenantId = '00000000-0000-4000-8000-000000000c17';
const operationId = '00000000-0000-4000-8000-000000000c03';
const attemptId = '00000000-0000-4000-8000-000000000c04';
const providerMessageId = 'provider_message_om_09';
const worker = {
  tenantId,
  state: 'RUNNING' as const,
  generation: 9,
  childId: 'child_example_om_09',
  quarantined: false,
  revision: 1,
};
const recoveryWorker = {
  ...worker,
  tenantId: recoveryTenantId,
  childId: 'child_example_om_09_recovery',
};

void test('admits one later inbound OPS confirmation without mistaking outbound send evidence for confirmation', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_09_confirmation',
    scheduledStartAt: '2030-01-02T08:00:00.000Z',
  });
  await sendOnce(fixture, operationId, attemptId);
  await assertConfirmationShapeConstraint(fixture);
  const admission = createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  const valid = {
    tenantId,
    confirmationMessageId: 'inbound_confirmation_om_09',
    publicOpsId: 'ops_example_om_09',
    workerGeneration: worker.generation,
    childId: worker.childId,
  };

  for (const malformed of [
    null,
    {},
    { ...valid, confirmationMessageId: ' raw-provider-payload ' },
    { ...valid, publicOpsId: 'ops identifier with spaces' },
  ]) {
    await assert.rejects(admission.admit(malformed), { code: 'INVALID_REPOSITORY_INPUT' });
  }
  await assert.rejects(
    admission.admit({ ...valid, tenantId: foreignTenantId, publicOpsId: 'ops_example_foreign' }),
    { code: 'TENANT_ACCESS_DENIED' },
  );
  for (const rejected of [
    { ...valid, publicOpsId: 'ops_not_this_tenant' },
    { ...valid, workerGeneration: worker.generation + 1 },
  ]) {
    await assert.rejects(admission.admit(rejected), { code: 'DELIVERY_CONFIRMATION_CONFLICT' });
  }

  const outcome = await admission.admit(valid);
  assert.deepEqual(
    {
      tenantId: outcome.tenantId,
      operationId: outcome.operationId,
      attemptId: outcome.attemptId,
      confirmationMessageId: outcome.confirmationMessageId,
    },
    { tenantId, operationId, attemptId, confirmationMessageId: valid.confirmationMessageId },
  );
  assert.match(outcome.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENT');
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, operationId))?.scheduledStartAt,
    '2030-01-02T08:00:00.000Z',
  );
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal(fixture.sends.count, 1);
});
void test('replays inbound confirmation once and rejects a second pending delivery', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_09_confirmation_replay',
  });
  await sendOnce(fixture, operationId, attemptId);
  const admission = createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  const valid = {
    tenantId,
    confirmationMessageId: 'inbound_confirmation_replay_om_09',
    publicOpsId: 'ops_example_om_09',
    workerGeneration: worker.generation,
    childId: worker.childId,
  };
  const [first, duplicate, outOfOrder] = await Promise.all([
    admission.admit(valid),
    admission.admit(valid),
    admission.admit(valid),
  ]);
  assert.deepEqual(duplicate, first);
  assert.deepEqual(outOfOrder, first);
  await fixture.repository.stop();
  const restartedRepository = createRepository(fixture.database, fixture.authorization);
  await restartedRepository.start();
  t.after(() => restartedRepository.stop());
  assert.deepEqual(
    await createDeliveryConfirmationAdmissionService({
      repository: restartedRepository,
      trustedTenant: { tenantId },
    }).admit(valid),
    first,
  );

  await assert.rejects(
    restartedRepository.prepareDelivery({
      id: '00000000-0000-4000-8000-000000000c05',
      tenantId,
      operationKey: 'automation:om_09_confirmation_second_pending',
    }),
    { code: 'DELIVERY_ALREADY_EXISTS' },
  );
  assert.equal((await restartedRepository.readEntitlementBalance(tenantId)).units, 0);
});
void test('admits confirmation while another tenant settles a delivery concurrently', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_09_confirmation_race_first',
  });
  await sendOnce(fixture, operationId, attemptId);
  await provisionTenantWorker(
    fixture,
    recoveryTenantId,
    'ops_example_om_09_recovery',
    recoveryWorker,
  );
  const secondOperationId = '00000000-0000-4000-8000-000000000c15';
  const secondAttemptId = '00000000-0000-4000-8000-000000000c16';
  const secondAuthority = await beginSending(
    fixture,
    recoveryTenantId,
    recoveryWorker,
    secondOperationId,
    secondAttemptId,
  );
  const admission = createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  }).admit({
    tenantId,
    confirmationMessageId: 'inbound_confirmation_race_om_09',
    publicOpsId: 'ops_example_om_09',
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
  const [admitted] = await Promise.all([
    admission,
    fixture.repository.settleDelivery({
      tenantId: recoveryTenantId,
      ...secondAuthority,
      outcome: 'SENT',
      providerMessageId: 'provider_message_race',
    }),
  ]);
  assert.equal(admitted.operationId, operationId);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal((await fixture.repository.readEntitlementBalance(recoveryTenantId)).units, 0);
});
async function createFixture(t: test.TestContext) {
  const database = await createDisposablePostgres(t, 'warlist-pg16-om-09-');
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createRepository(database, authorization);
  await repository.start();
  t.after(() => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_om_09' });

  const client = new Client(database.config);
  await client.connect();
  await createPostgresWorkerLifecycleStateRepository({ client, authorization }).compareAndSave(
    worker,
    null,
  );
  await client.end();
  return { database, authorization, repository, sends: { count: 0 } };
}
async function provisionTenantWorker(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  targetTenantId: string,
  publicOpsId: string,
  targetWorker: typeof worker,
): Promise<void> {
  fixture.authorization.allowed.add(targetTenantId);
  await fixture.repository.createTenant({ id: targetTenantId, publicOpsId });
  const client = new Client(fixture.database.config);
  await client.connect();
  try {
    await createPostgresWorkerLifecycleStateRepository({
      client,
      authorization: fixture.authorization,
    }).compareAndSave(targetWorker, null);
  } finally {
    await client.end();
  }
}

function createRepository(
  database: Awaited<ReturnType<typeof createDisposablePostgres>>,
  authorization: MutableTenantAuthorization,
) {
  return createPostgresBusinessRepository({
    config: database.config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
}

async function assertConfirmationShapeConstraint(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  const client = new Client(fixture.database.config);
  await client.connect();
  try {
    await assert.rejects(
      client.query(
        `UPDATE delivery_attempts SET confirmed_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, attemptId],
      ),
      { code: '23514' },
    );
  } finally {
    await client.end();
  }
}

async function sendOnce(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  targetOperationId: string,
  targetAttemptId: string,
): Promise<void> {
  const sender = createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId },
    claim: (input) =>
      createDeliveryClaimService({
        repository: fixture.repository,
        trustedTenant: { tenantId },
        ownerId: 'claim_owner_om_09',
        idGenerator: { generate: () => targetAttemptId },
      }).claim(input),
    begin: createDeliveryBeginPort({ repository: fixture.repository, trustedTenant: { tenantId } }),
    settle: createDeliverySettlementPort({
      repository: fixture.repository,
      trustedTenant: { tenantId },
    }),
    sender: () => {
      fixture.sends.count += 1;
      return Promise.resolve({ providerMessageId });
    },
  });
  const completion = await sender.send({
    decisionCode: 'ACCEPTED',
    correlationId: 'correlation_om_09',
    tenantId,
    operationId: targetOperationId,
    workerGeneration: worker.generation,
    childId: worker.childId,
    target: 'synthetic_group_om_09',
    text: 'Synthetic OM-09 message',
  });
  assert.equal(completion.outcome, 'SENT');
}
async function beginSending(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  targetTenantId: string,
  targetWorker: typeof worker,
  targetOperationId: string,
  targetAttemptId: string,
) {
  await fixture.repository.prepareDelivery({
    id: targetOperationId,
    tenantId: targetTenantId,
    operationKey: `automation:om_09_confirmation_${targetAttemptId}`,
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: targetTenantId },
    ownerId: 'claim_owner_om_09',
    idGenerator: { generate: () => targetAttemptId },
  }).claim({
    operationId: targetOperationId,
    workerGeneration: targetWorker.generation,
    childId: targetWorker.childId,
  });
  const authority = {
    operationId: targetOperationId,
    attemptId: targetAttemptId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: targetWorker.generation,
    childId: targetWorker.childId,
  };
  await fixture.repository.beginDelivery({ tenantId: targetTenantId, ...authority });
  return authority;
}

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
    publicOpsId: 'ops_example_om_09',
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
}

void test('OM-10 settles confirmation and daily debit atomically once', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_10_atomic',
  });
  await sendOnce(fixture, operationId, attemptId);
  await admitConfirmation(fixture, 'inbound_confirmation_settlement_om_09');
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-02T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000c05' },
  });
  const delivery = await fixture.repository.loadDelivery(tenantId, operationId);
  const attempt = await fixture.repository.loadDeliveryAttempt(tenantId, attemptId);
  assert.ok(delivery?.claimOwner && delivery.leaseUntil && attempt?.claimFence);
  const settled = await confirmation.confirm({
    operationId,
    attemptId,
    claimFence: attempt.claimFence,
    claimOwner: delivery.claimOwner,
    leaseUntil: delivery.leaseUntil,
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
  assert.equal(settled.operation.status, 'CONFIRMED');
  assert.ok(settled.debit);
  assert.equal(settled.debit.units, -1);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
});

void test('OM-10 concurrent replay is one debit and transaction failure rolls back', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_10_replay',
  });
  await sendOnce(fixture, operationId, attemptId);
  await admitConfirmation(fixture, 'inbound_confirmation_replay_settlement_om_09');
  const delivery = await fixture.repository.loadDelivery(tenantId, operationId);
  const attempt = await fixture.repository.loadDeliveryAttempt(tenantId, attemptId);
  assert.ok(delivery?.claimOwner && delivery.leaseUntil && attempt?.claimFence);
  const authority = {
    operationId,
    attemptId,
    claimFence: attempt.claimFence,
    claimOwner: delivery.claimOwner,
    leaseUntil: delivery.leaseUntil,
    workerGeneration: worker.generation,
    childId: worker.childId,
  };
  const make = () =>
    createDeliveryConfirmationService({
      repository: fixture.repository,
      trustedTenant: { tenantId },
      clock: new FixedClock(new Date('2030-01-02T17:00:00.000Z')),
      idGenerator: { generate: () => '00000000-0000-4000-8000-000000000c06' },
    }).confirm(authority);
  const [first, replay] = await Promise.all([make(), make()]);
  assert.deepEqual(replay, first);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);

  const failedOperationId = '00000000-0000-4000-8000-000000000c07';
  const failedAttemptId = '00000000-0000-4000-8000-000000000c08';
  await fixture.repository.prepareDelivery({
    id: failedOperationId,
    tenantId,
    operationKey: 'automation:om_10_rollback',
  });
  await sendOnce(fixture, failedOperationId, failedAttemptId);
  await admitConfirmation(fixture, 'inbound_confirmation_rollback_om_09');
  const failedDelivery = await fixture.repository.loadDelivery(tenantId, failedOperationId);
  const failedAttempt = await fixture.repository.loadDeliveryAttempt(tenantId, failedAttemptId);
  assert.ok(failedDelivery?.claimOwner && failedDelivery.leaseUntil && failedAttempt?.claimFence);
  const client = new Client(fixture.database.config);
  await client.connect();
  try {
    await client.query(
      `CREATE FUNCTION om_10_injected_debit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected debit failure'; END $$`,
    );
    await client.query(
      `CREATE TRIGGER om_10_injected_debit_failure BEFORE INSERT ON entitlement_ledger FOR EACH ROW EXECUTE FUNCTION om_10_injected_debit_failure()`,
    );
    const failure = createDeliveryConfirmationService({
      repository: fixture.repository,
      trustedTenant: { tenantId },
      clock: new FixedClock(new Date('2030-01-03T17:00:00.000Z')),
      idGenerator: { generate: () => '00000000-0000-4000-8000-000000000c09' },
    });
    await assert.rejects(
      failure.confirm({
        operationId: failedOperationId,
        attemptId: failedAttemptId,
        claimFence: failedAttempt.claimFence,
        claimOwner: failedDelivery.claimOwner,
        leaseUntil: failedDelivery.leaseUntil,
        workerGeneration: worker.generation,
        childId: worker.childId,
      }),
      { code: 'DATABASE_UNAVAILABLE' },
    );
  } finally {
    await client.end();
  }
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, failedOperationId))?.status,
    'SENT',
  );
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
});

void test('OM-11 authorized manual recovery converges ambiguous replay and restart to SENT without debit or resend', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_11_manual_recovery',
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_om_11',
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
    outcome: 'AMBIGUOUS',
    providerMessageId: null,
  });
  const recovery = createDeliveryManualRecoveryService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  const client = new Client(fixture.database.config);
  await client.connect();
  try {
    await client.query(
      `UPDATE delivery_operations SET claim_lease_until = clock_timestamp() - interval '1 second'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, operationId],
    );
  } finally {
    await client.end();
  }
  await assert.rejects(recovery.resolve(authority), { code: 'DELIVERY_CLAIM_CONFLICT' });
  await provisionTenantWorker(
    fixture,
    recoveryTenantId,
    'ops_example_om_09_recovery',
    recoveryWorker,
  );
  const currentOperationId = '00000000-0000-4000-8000-000000000c10';
  const currentAttemptId = '00000000-0000-4000-8000-000000000c11';
  await fixture.repository.prepareDelivery({
    id: currentOperationId,
    tenantId: recoveryTenantId,
    operationKey: 'automation:om_11_recovery_current',
  });
  const currentClaim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId: recoveryTenantId },
    ownerId: 'claim_owner_om_11_current',
    idGenerator: { generate: () => currentAttemptId },
  }).claim({
    operationId: currentOperationId,
    workerGeneration: recoveryWorker.generation,
    childId: recoveryWorker.childId,
  });
  const currentAuthority = {
    operationId: currentClaim.operation.id,
    attemptId: currentClaim.attempt.id,
    claimFence: currentClaim.operation.claimFence,
    claimOwner: currentClaim.operation.claimOwner!,
    leaseUntil: currentClaim.operation.leaseUntil!,
    workerGeneration: recoveryWorker.generation,
    childId: recoveryWorker.childId,
  };
  await fixture.repository.beginDelivery({ tenantId: recoveryTenantId, ...currentAuthority });
  await fixture.repository.settleDelivery({
    tenantId: recoveryTenantId,
    ...currentAuthority,
    outcome: 'AMBIGUOUS',
    providerMessageId: null,
  });
  const currentRecovery = createDeliveryManualRecoveryService({
    repository: fixture.repository,
    trustedTenant: { tenantId: recoveryTenantId },
  });
  const first = await currentRecovery.resolve(currentAuthority);
  const replay = await currentRecovery.resolve(currentAuthority);
  assert.equal(first.operation.status, 'SENT');
  assert.equal(first.attempt.status, 'SENT');
  assert.deepEqual(replay, first);
  await fixture.repository.stop();
  const restartedRepository = createRepository(fixture.database, fixture.authorization);
  await restartedRepository.start();
  t.after(() => restartedRepository.stop());
  assert.deepEqual(
    await createDeliveryManualRecoveryService({
      repository: restartedRepository,
      trustedTenant: { tenantId: recoveryTenantId },
    }).resolve(currentAuthority),
    first,
  );
  assert.equal((await restartedRepository.readEntitlementBalance(recoveryTenantId)).units, 0);
  assert.equal(fixture.sends.count, 0);
});
