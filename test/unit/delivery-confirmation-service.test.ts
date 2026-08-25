import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

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

void test('confirms a second sent delivery on the same WIB date without another debit', async (t) => {
  const fixture = await createFixture(t);
  const first = await prepareSentDelivery(fixture);
  const second = await prepareSentDelivery(fixture, {
    operationId: '00000000-0000-4000-8000-000000000a05',
    attemptId: '00000000-0000-4000-8000-000000000a06',
    operationKey: 'automation:message_confirmation_second',
  });
  const confirmation = createDeliveryConfirmationService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    clock: new FixedClock(new Date('2030-01-01T17:00:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000a07' },
  });

  const [firstResult, secondResult] = await Promise.all([
    confirmation.confirm(first),
    confirmation.confirm(second),
  ]);

  assert.equal(firstResult.operation.status, 'CONFIRMED');
  assert.equal(secondResult.operation.status, 'CONFIRMED');
  assert.equal([firstResult.debit, secondResult.debit].filter(Boolean).length, 1);
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
