import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client, type ClientConfig } from 'pg';
import type {
  BusinessRepositoryPort,
  DeliveryClaimRepositoryPort,
  DeliveryConfirmationAdmissionRepositoryPort,
} from '../../src/app/business-repository';

import { runPostgresMigrations } from '../../src/infrastructure/database/postgres-migrator';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createActiveAutomationDecisionService } from '../../src/modules/automation/application/active-automation-decision-service';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import { createDeliveryConfirmationAdmissionService } from '../../src/modules/delivery/application/delivery-confirmation-admission-service';
import { createDeliveryConfirmationService } from '../../src/modules/delivery/application/delivery-confirmation-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import { createOm20DeliveryComposition } from '../../src/modules/delivery/application/om-20-delivery-composition';
import { createPostgresWorkerLifecycleStateRepository } from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres, postgresMigrations } from '../support/disposable-postgres';
import { FixedClock, NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000220';
const groupId = `group:${'a'.repeat(64)}`;
const adminId = `sender:${'b'.repeat(64)}`;
const worker = { workerGeneration: 1, childId: 'child_om_20' } as const;
const trigger = {
  tenantId,
  messageId: `message:${'c'.repeat(64)}`,
  correlationId: 'correlation_om_20',
  ...worker,
  message: {
    groupId,
    senderId: adminId,
    text: 'list 2 Januari 2030 PUKUL 08:30',
  },
} as const;
void test('migrates and reads a legacy colon provider message ID', async (t) => {
  const database = await createDisposablePostgres(
    t,
    `warlist-v2-om-20-legacy-${process.pid}-`,
    postgresMigrations.slice(0, 13),
  );
  const client = new Client(database.config);
  await client.connect();
  try {
    await client.query(
      `INSERT INTO tenants (id, public_ops_id)
       VALUES ($1, 'ops_example_om_20_legacy')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO delivery_operations
         (id, tenant_id, operation_key, status, claim_owner, claim_fence, claim_lease_until,
          worker_generation, worker_child_id)
       VALUES ($1, $2, 'automation:legacy_provider_message', 'SENT', 'claim_owner_om_20', 1,
               '2030-01-02T02:00:00.000Z', 1, 'child_om_20')`,
      ['00000000-0000-4000-8000-000000000221', tenantId],
    );
    await client.query(
      `INSERT INTO delivery_attempts
         (id, tenant_id, operation_id, attempt_number, status, claim_fence, provider_message_id)
       VALUES ($1, $2, '00000000-0000-4000-8000-000000000221', 1, 'SENT', 1,
               'legacy:provider_message_om_20')`,
      ['00000000-0000-4000-8000-000000000222', tenantId],
    );
    await runPostgresMigrations({ client, migrations: postgresMigrations });
  } finally {
    await client.end();
  }

  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createRepository(database.config, authorization);
  await repository.start();
  t.after(() => repository.stop());
  assert.equal(
    (await repository.loadDeliveryAttempt(tenantId, '00000000-0000-4000-8000-000000000222'))
      ?.providerMessageId,
    'legacy:provider_message_om_20',
  );
});

void test('accepted inbound sends at most once and restart replay confirms once from durable authority', async (t) => {
  const database = await createDisposablePostgres(t, `warlist-v2-om-20-${process.pid}-`);
  await assertProviderMessageIdSchema(database.config);
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  let repository = createRepository(database.config, authorization);
  await repository.start();
  t.after(async () => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_om_20' });
  await repository.compareAndSaveConfig(
    {
      tenantId,
      configuration: {
        automation: {
          enabled: true,
          opsStatus: 'active',
          timeWindow: { enabled: false, startMinute: 0, endMinute: 0 },
          targetGroupId: groupId,
          adminIds: [adminId],
          keyword: 'list',
        },
      },
    },
    null,
  );
  await repository.appendEntitlementLedgerEntry({
    id: randomUUID(),
    tenantId,
    entryType: 'CREDIT_COUPON',
    units: 1,
    businessKey: 'credit:om_20',
    correlationId: 'correlation_credit_om_20',
  });
  await saveWorker(database.config, authorization);

  const sends: SentInput[] = [];
  let composition = compose(repository, sends);
  const sent = await composition.handle(trigger);
  assert.equal(sent.code, 'ACCEPTED');
  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.target, groupId);
  assert.equal(sends[0]?.text, 'OPS ops_example_om_20');
  const second = await composition.handle({
    ...trigger,
    messageId: `message:${'e'.repeat(64)}`,
    correlationId: 'correlation_second_om_20',
  });
  assert.equal(second.code, 'DELIVERY_ALREADY_EXISTS');
  assert.equal(sends.length, 1);
  const replay = await composition.handle(trigger);
  assert.equal(replay.code, 'DELIVERY_ALREADY_EXISTS');
  assert.equal(sends.length, 1);

  await repository.stop();
  repository = createRepository(database.config, authorization);
  await repository.start();
  composition = compose(repository, sends);
  assert.equal((await composition.handle(trigger)).code, 'DELIVERY_ALREADY_EXISTS');
  assert.equal(sends.length, 1);
  const operationBeforeConfirmation = await repository.loadDeliveryByOperationKey(
    tenantId,
    `automation:${trigger.messageId}`,
  );
  assert.ok(operationBeforeConfirmation);
  const workerClient = new Client(database.config);
  await workerClient.connect();
  try {
    await workerClient.query(
      `UPDATE delivery_operations
       SET claim_lease_until = date_trunc('milliseconds', clock_timestamp()) - interval '1 second'
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, operationBeforeConfirmation.id],
    );
    const ownership = createPostgresWorkerLifecycleStateRepository({
      client: workerClient,
      authorization,
    });
    await ownership.compareAndSave(
      {
        tenantId,
        state: 'RUNNING',
        generation: 2,
        childId: 'child_om_20_replacement',
        quarantined: false,
        revision: 2,
      },
      {
        tenantId,
        state: 'RUNNING',
        generation: worker.workerGeneration,
        childId: worker.childId,
        quarantined: false,
        revision: 1,
      },
    );
  } finally {
    await workerClient.end();
  }

  const confirmation = {
    ...trigger,
    workerGeneration: 2,
    childId: 'child_om_20_replacement',
    messageId: `message:${'d'.repeat(64)}`,
    correlationId: 'correlation_confirmation_om_20',
    message: { groupId, senderId: adminId, text: 'OPS ops_example_om_20 selesai' },
  } as const;
  const confirmed = await composition.handle(confirmation);
  assert.equal(confirmed.code, 'CONFIRMED');
  assert.match(confirmed.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(confirmed.scheduledStartAt, '2030-01-02T01:30:00.000Z');
  const operation = await repository.loadDeliveryByOperationKey(
    tenantId,
    `automation:${trigger.messageId}`,
  );
  assert.equal(operation?.status, 'CONFIRMED');
  assert.equal(operation?.scheduledStartAt, confirmed.scheduledStartAt);
  assert.equal(operation?.scheduledStartAt, '2030-01-02T01:30:00.000Z');
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 0);
  assert.deepEqual(await composition.handle(confirmation), confirmed);
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal(sends.length, 1);

  await assert.rejects(
    composition.handle({
      ...confirmation,
      workerGeneration: 2,
      messageId: `message:${'e'.repeat(64)}`,
    }),
    { code: 'DELIVERY_CONFIRMATION_CONFLICT' },
  );
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 0);
  assert.equal(sends.length, 1);
});

function createRepository(config: unknown, authorization: MutableTenantAuthorization) {
  return createPostgresBusinessRepository({
    config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
}

async function saveWorker(
  config: ClientConfig,
  authorization: MutableTenantAuthorization,
): Promise<void> {
  const client = new Client(config);
  await client.connect();
  try {
    await createPostgresWorkerLifecycleStateRepository({ client, authorization }).compareAndSave(
      {
        tenantId,
        state: 'RUNNING',
        generation: worker.workerGeneration,
        childId: worker.childId,
        quarantined: false,
        revision: 1,
      },
      null,
    );
  } finally {
    await client.end();
  }
}

async function assertProviderMessageIdSchema(config: ClientConfig): Promise<void> {
  const client = new Client(config);
  await client.connect();
  try {
    const result = await client.query<Readonly<{ definition: string }>>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname = 'delivery_attempts_provider_message_id_check'`,
    );
    assert.match(result.rows[0]?.definition ?? '', /A-Za-z0-9_:-/);
  } finally {
    await client.end();
  }
}

type SentInput = Readonly<{
  target: string;
  text: string;
}>;

type Om20Repository = BusinessRepositoryPort &
  DeliveryClaimRepositoryPort &
  DeliveryConfirmationAdmissionRepositoryPort;

function compose(repository: Om20Repository, sends: SentInput[]) {
  const trustedTenant = { tenantId };
  const decision = createActiveAutomationDecisionService({
    repository,
    trustedTenant,
    state: {
      async load({ messageId }) {
        const [balance, delivery] = await Promise.all([
          repository.readEntitlementBalance(tenantId),
          repository.loadDeliveryByOperationKey(tenantId, `automation:${messageId}`),
        ]);
        return {
          hasEntitlement: balance.units > 0,
          duplicateMessage: false,
          deliveryExists: delivery !== undefined,
          delivery,
        };
      },
    },
  });
  const claim = createDeliveryClaimService({
    repository,
    trustedTenant,
    ownerId: 'claim_owner_om_20',
    idGenerator: { generate: randomUUID },
  });
  const delivery = createAcceptedClaimGatedDeliverySender({
    trustedTenant,
    claim: claim.claim,
    begin: createDeliveryBeginPort({ repository, trustedTenant }),
    settle: createDeliverySettlementPort({ repository, trustedTenant }),
    sender: (input) => {
      sends.push({ target: input.target, text: input.text });
      return Promise.resolve({ providerMessageId: '3EB0ABCDEF1234567890ABCDEF123456' });
    },
  });
  return createOm20DeliveryComposition({
    trustedTenant,
    repository,
    decision,
    delivery,
    admission: createDeliveryConfirmationAdmissionService({ repository, trustedTenant }),
    confirmation: createDeliveryConfirmationService({
      repository,
      trustedTenant,
      clock: new FixedClock(new Date('2030-01-02T01:45:00.000Z')),
      idGenerator: { generate: randomUUID },
    }),
  });
}
