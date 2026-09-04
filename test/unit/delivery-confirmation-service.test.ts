import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { createDeliveryConfirmationAdmissionService } from '../../src/modules/delivery/application/delivery-confirmation-admission-service';
import { createDeliveryConfirmationService } from '../../src/modules/delivery/application/delivery-confirmation-service';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { FixedClock, NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000a01';
const operationId = '00000000-0000-4000-8000-000000000a02';
const attemptId = '00000000-0000-4000-8000-000000000a03';

void test('confirms a sent delivery once and debits at most once for its WIB date', async (t) => {
  const fixture = await createFixture(t);
  const authority = await prepareSentDelivery(fixture);
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-01T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000a04' },
  });

  for (const stale of [
    { claimOwner: 'claim_owner_confirmation_stale' },
    { leaseUntil: new Date(Date.parse(authority.leaseUntil) + 1_000).toISOString() },
  ]) {
    await assert.rejects(confirmation.confirm({ ...authority, ...stale }), {
      code: 'DELIVERY_CLAIM_CONFLICT',
    });
  }
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
  await admitConfirmation(fixture, 'inbound_confirmation_first');

  const first = await confirmation.confirm(authority);
  const replay = await confirmation.confirm(authority);

  assert.equal(first.operation.status, 'CONFIRMED');
  assert.equal(first.businessDate, '2030-01-02');
  assert.equal(first.debit?.units, -1);
  assert.deepEqual(replay, first);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
  await assert.rejects(
    confirmation.confirm({ ...authority, claimFence: authority.claimFence + 1 }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'CONFIRMED');
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
});

void test('fails closed when more than one sent delivery could match one inbound confirmation', async (t) => {
  const fixture = await createFixture(t);
  await prepareSentDelivery(fixture);
  await prepareSentDelivery(fixture, {
    operationId: '00000000-0000-4000-8000-000000000a05',
    attemptId: '00000000-0000-4000-8000-000000000a06',
    operationKey: 'automation:message_confirmation_second',
  });

  await assert.rejects(admitConfirmation(fixture, 'inbound_confirmation_ambiguous'), {
    code: 'DELIVERY_CONFIRMATION_CONFLICT',
  });
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
});

void test('rejects an expired initial confirmation without debit or state drift', async (t) => {
  const fixture = await createFixture(t);
  const expiredAuthority = await prepareSentDelivery(fixture);
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-02T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000a08' },
  });
  const expiredLease = await expireLease(fixture, expiredAuthority.operationId);
  await admitConfirmation(fixture, 'inbound_confirmation_expired');

  await assert.rejects(confirmation.confirm({ ...expiredAuthority, leaseUntil: expiredLease }), {
    code: 'DELIVERY_CLAIM_CONFLICT',
  });
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENT');
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
});

void test('replays a durable confirmation with the exact expired persisted lease', async (t) => {
  const fixture = await createFixture(t);
  const replayAuthority = await prepareSentDelivery(fixture, {
    operationId: '00000000-0000-4000-8000-000000000a09',
    attemptId: '00000000-0000-4000-8000-000000000a10',
    operationKey: 'automation:message_confirmation_expired_replay',
  });
  const replayConfirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-02T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000a11' },
  });
  await admitConfirmation(fixture, 'inbound_confirmation_replay');
  const first = await replayConfirmation.confirm(replayAuthority);
  const replayLease = await expireLease(fixture, replayAuthority.operationId);
  const replay = await replayConfirmation.confirm({ ...replayAuthority, leaseUntil: replayLease });

  assert.equal(replay.operation.status, 'CONFIRMED');
  assert.deepEqual(replay.debit, first.debit);
  assert.equal(replay.businessDate, first.businessDate);
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, -1);
});

async function createFixture(t: test.TestContext) {
  const database = await createDisposablePostgres(t);
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createPostgresBusinessRepository({
    config: database.config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
  await repository.start();
  t.after(() => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_confirmation' });
  const client = new Client(database.config);
  await client.connect();
  t.after(() => client.end());
  const workerRepository = createPostgresWorkerLifecycleStateRepository({
    client,
    authorization,
  });
  await workerRepository.compareAndSave(
    {
      tenantId,
      state: 'RUNNING',
      generation: 1,
      childId: 'child_example_1',
      quarantined: false,
      revision: 1,
    },
    null,
  );
  return { database, repository, workerRepository };
}

async function prepareSentDelivery(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input = { operationId, attemptId, operationKey: 'automation:message_confirmation_example' },
) {
  await fixture.repository.prepareDelivery({
    id: input.operationId,
    tenantId,
    operationKey: input.operationKey,
  });
  const claim = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_confirmation',
    idGenerator: { generate: () => input.attemptId },
  }).claim({ operationId: input.operationId, workerGeneration: 1, childId: 'child_example_1' });
  const authority = {
    operationId: input.operationId,
    attemptId: input.attemptId,
    claimFence: claim.operation.claimFence,
    claimOwner: claim.operation.claimOwner!,
    leaseUntil: claim.operation.leaseUntil!,
    workerGeneration: 1,
    childId: 'child_example_1',
  };
  await fixture.repository.beginDelivery({ tenantId, ...authority });
  await fixture.repository.settleDelivery({
    tenantId,
    ...authority,
    outcome: 'SENT',
    providerMessageId: 'provider_message_confirmation',
  });
  return authority;
}
async function admitConfirmation(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  confirmationMessageId: string,
) {
  await createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  }).admit({
    tenantId,
    confirmationMessageId,
    publicOpsId: 'ops_example_confirmation',
    workerGeneration: 1,
    childId: 'child_example_1',
  });
}

async function expireLease(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  targetOperationId: string,
): Promise<string> {
  const client = new Client(fixture.database.config);
  await client.connect();
  try {
    const updated = await client.query<{ claim_lease_until: Date }>(
      `UPDATE delivery_operations
       SET claim_lease_until = date_trunc('milliseconds', clock_timestamp())
       WHERE tenant_id = $1 AND id = $2
       RETURNING claim_lease_until`,
      [tenantId, targetOperationId],
    );
    const leaseUntil = updated.rows[0]?.claim_lease_until.toISOString();
    assert.ok(leaseUntil);
    const clock = await client.query<{ expired: boolean }>(
      'SELECT clock_timestamp() >= $1::timestamptz AS expired',
      [leaseUntil],
    );
    assert.equal(clock.rows[0]?.expired, true);
    return leaseUntil;
  } finally {
    await client.end();
  }
}
