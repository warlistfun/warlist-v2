import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createDeliveryConfirmationAdmissionService } from '../../src/modules/delivery/application/delivery-confirmation-admission-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000c01';
const foreignTenantId = '00000000-0000-4000-8000-000000000c02';
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

void test('admits only a valid confirmation correlated to the current tenant delivery and attempt', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_09_confirmation',
  });
  await sendOnce(fixture, operationId, attemptId);
  await assertConfirmationShapeConstraint(fixture);

  const admission = createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  const valid = { tenantId, operationId, attemptId, providerMessageId };

  for (const malformed of [
    null,
    {},
    { ...valid, attemptId: 'not-an-attempt-id' },
    { ...valid, providerMessageId: ' raw-provider-payload ' },
  ]) {
    await assert.rejects(admission.admit(malformed), { code: 'INVALID_REPOSITORY_INPUT' });
  }
  await assert.rejects(admission.admit({ ...valid, tenantId: foreignTenantId }), {
    code: 'TENANT_ACCESS_DENIED',
  });
  for (const stale of [
    { ...valid, operationId: '00000000-0000-4000-8000-000000000c05' },
    { ...valid, attemptId: '00000000-0000-4000-8000-000000000c06' },
    { ...valid, providerMessageId: 'provider_message_om_09_stale' },
  ]) {
    await assert.rejects(admission.admit(stale), { code: 'DELIVERY_CONFIRMATION_CONFLICT' });
  }

  const outcome = await admission.admit(valid);
  assert.equal(outcome.outcome, 'CONFIRMED');
  assert.deepEqual(
    {
      tenantId: outcome.tenantId,
      operationId: outcome.operationId,
      attemptId: outcome.attemptId,
      providerMessageId: outcome.providerMessageId,
    },
    valid,
  );
  assert.match(outcome.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENT');
  assert.equal((await fixture.repository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal(fixture.sends.count, 1);
});

void test('duplicate, out-of-order, and post-restart confirmations converge on one durable outcome', async (t) => {
  const fixture = await createFixture(t);
  await fixture.repository.prepareDelivery({
    id: operationId,
    tenantId,
    operationKey: 'automation:om_09_confirmation_replay',
  });
  const valid = { tenantId, operationId, attemptId, providerMessageId };
  const admission = createDeliveryConfirmationAdmissionService({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  await assert.rejects(admission.admit(valid), { code: 'DELIVERY_CONFIRMATION_CONFLICT' });
  await sendOnce(fixture, operationId, attemptId);

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
  const restartedAdmission = createDeliveryConfirmationAdmissionService({
    repository: restartedRepository,
    trustedTenant: { tenantId },
  });
  assert.deepEqual(await restartedAdmission.admit(valid), first);
  const client = new Client(fixture.database.config);
  await client.connect();
  const durable = await client.query<{
    confirmation_count: string;
    confirmation_provider_message_id: string;
    confirmed_at: Date;
  }>(
    `SELECT count(*) FILTER (WHERE confirmed_at IS NOT NULL)::text AS confirmation_count,
            max(confirmation_provider_message_id) AS confirmation_provider_message_id,
            max(confirmed_at) AS confirmed_at
     FROM delivery_attempts WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, operationId],
  );
  await client.end();
  assert.deepEqual(durable.rows[0], {
    confirmation_count: '1',
    confirmation_provider_message_id: providerMessageId,
    confirmed_at: new Date(first.confirmedAt),
  });
  assert.equal((await restartedRepository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal(fixture.sends.count, 1);
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
