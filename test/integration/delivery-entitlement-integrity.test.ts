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
          clock: new FixedClock(new Date('2030-08-22T07:00:00.000Z')),
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

  const ambiguousOperationId = '00000000-0000-4000-8000-000000000b05';
  await fixture.repository.prepareDelivery({
    id: ambiguousOperationId,
    tenantId,
    operationKey: 'automation:matrix_crash',
  });
  const crashSender = createClaimGatedDeliverySender({
    claim: (input) =>
      createDeliveryClaimService({
        repository: fixture.repository,
        trustedTenant: { tenantId },
        ownerId: 'claim_owner_matrix_crash',
        clock: new FixedClock(new Date('2030-08-22T07:02:00.000Z')),
        idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b06' },
      }).claim(input),
    begin: createDeliveryBeginPort({ repository: fixture.repository, trustedTenant: { tenantId } }),
    settle: createDeliverySettlementPort({
      repository: fixture.repository,
      trustedTenant: { tenantId },
    }),
    sender: () => {
      sends += 1;
      return Promise.reject(new Error('synthetic crash after send admission'));
    },
  });
  await assert.rejects(
    crashSender.send({
      operationId: ambiguousOperationId,
      workerGeneration: worker.generation,
      childId: worker.childId,
    }),
  );
  assert.equal(
    (await fixture.repository.loadDelivery(tenantId, ambiguousOperationId))?.status,
    'AMBIGUOUS',
  );
  await assert.rejects(
    createDeliveryClaimService({
      repository: fixture.repository,
      trustedTenant: { tenantId },
      ownerId: 'claim_owner_matrix_replay',
      clock: new FixedClock(new Date('2030-08-22T07:04:00.000Z')),
      idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b07' },
    }).claim({
      operationId: ambiguousOperationId,
      workerGeneration: worker.generation,
      childId: worker.childId,
    }),
    { code: 'DELIVERY_CLAIM_CONFLICT' },
  );
  assert.equal(sends, 2);

  await fixture.repository.prepareDelivery({
    id: '00000000-0000-4000-8000-000000000b11',
    tenantId,
    operationKey: 'automation:matrix_stale_claim',
  });
  const staleClaim = createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_matrix_stale',
    clock: new FixedClock(new Date('2030-08-22T07:05:00.000Z')),
    idGenerator: { generate: () => '00000000-0000-4000-8000-000000000b12' },
  });
  for (const stale of [
    { workerGeneration: worker.generation + 1, childId: worker.childId },
    { workerGeneration: worker.generation, childId: 'child_example_matrix_stale' },
  ]) {
    await assert.rejects(
      staleClaim.claim({
        operationId: '00000000-0000-4000-8000-000000000b11',
        ...stale,
      }),
      { code: 'DELIVERY_CLAIM_CONFLICT' },
    );
  }

  const staleOperationId = '00000000-0000-4000-8000-000000000b13';
  const staleAttemptId = '00000000-0000-4000-8000-000000000b14';
  await fixture.repository.prepareDelivery({
    id: staleOperationId,
    tenantId,
    operationKey: 'automation:matrix_stale_send',
  });
  const staleAuthority = await createDeliveryClaimService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_matrix_stale_send',
    clock: new FixedClock(new Date('2030-08-22T07:06:00.000Z')),
    idGenerator: { generate: () => staleAttemptId },
  }).claim({
    operationId: staleOperationId,
    workerGeneration: worker.generation,
    childId: worker.childId,
  });
  const staleSend = {
    operationId: staleOperationId,
    attemptId: staleAttemptId,
    claimFence: staleAuthority.operation.claimFence,
    workerGeneration: worker.generation,
    childId: worker.childId,
  };
  for (const stale of [
    { childId: 'child_example_matrix_stale' },
    { workerGeneration: worker.generation + 1 },
    { claimFence: staleSend.claimFence + 1 },
  ]) {
    await assert.rejects(fixture.repository.beginDelivery({ tenantId, ...staleSend, ...stale }), {
      code: 'DELIVERY_CLAIM_CONFLICT',
    });
  }
  await fixture.repository.beginDelivery({ tenantId, ...staleSend });
  for (const stale of [
    { childId: 'child_example_matrix_stale' },
    { workerGeneration: worker.generation + 1 },
    { claimFence: staleSend.claimFence + 1 },
  ]) {
    await assert.rejects(
      fixture.repository.settleDelivery({
        tenantId,
        ...staleSend,
        ...stale,
        outcome: 'AMBIGUOUS',
        providerMessageId: null,
      }),
      { code: 'DELIVERY_CLAIM_CONFLICT' },
    );
  }
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
    clock: new FixedClock(new Date('2030-08-22T08:00:00.000Z')),
    idGenerator: { generate: () => attemptId },
  }).claim({ operationId, workerGeneration: worker.generation, childId: worker.childId });
  const authority = {
    operationId,
    attemptId,
    claimFence: claim.operation.claimFence,
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
  return { repository, secondRepository };
}
