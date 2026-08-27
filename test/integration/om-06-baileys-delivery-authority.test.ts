import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { Client } from 'pg';

import type { DeliveryClaimRepositoryPort } from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
  type CorrelatedDeliverySend,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import {
  createBaileysWorkerChild,
  type BaileysSocketPort,
} from '../../src/modules/whatsapp/infrastructure/baileys-worker-child';
import { createDisposablePostgres, type DisposablePostgres } from '../support/disposable-postgres';

const tenantId = '00000000-0000-4000-8000-000000000148';
const operationId = '00000000-0000-4000-8000-000000000149';
const workerGeneration = 6;
const childId = 'child_om_06';
const input = {
  decisionCode: 'ACCEPTED',
  correlationId: 'correlation_om_06',
  tenantId,
  operationId,
  workerGeneration,
  childId,
  target: 'synthetic_group_om_06',
  text: 'Synthetic OM-06 message',
} as const;

void test('one current database authority invokes the concrete Baileys sender at most once', async (t) => {
  const fixture = await createFixture(t);

  const results = await Promise.allSettled([
    fixture.sender.send(input),
    fixture.sender.send(input),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(fixture.socket.sent.length, 1);
  assert.deepEqual(fixture.socket.sent, [{ target: input.target, content: { text: input.text } }]);
  assert.deepEqual(fixture.sentInputs, [
    {
      correlationId: input.correlationId,
      tenantId,
      operationId,
      attemptId: '00000000-0000-4000-8000-000000000151',
      claimFence: 1,
      workerGeneration,
      childId,
      target: input.target,
      text: input.text,
    },
  ]);
});

void test('unavailable persistence and stale or foreign identity invoke no Baileys sender', async (t) => {
  const fixture = await createFixture(t);

  const rejected = [
    { ...input, tenantId: '00000000-0000-4000-8000-000000000150' },
    { ...input, workerGeneration: workerGeneration + 1 },
    { ...input, childId: 'child_stale_om_06' },
    { ...input, target: 'not bounded' },
    { ...input, text: 'x'.repeat(4_097) },
  ];
  for (const candidate of rejected) await assert.rejects(fixture.sender.send(candidate));

  await fixture.repository.stop();
  await assert.rejects(fixture.sender.send(input), { code: 'DATABASE_UNAVAILABLE' });
  assert.equal(fixture.socket.sent.length, 0);
});

void test('stale attempt or fence authority invokes no Baileys sender', async (t) => {
  const fixture = await createFixture(t);
  const claim = await fixture.claim.claim(input);
  const staleClaims = [
    {
      ...claim,
      attempt: {
        ...claim.attempt,
        operationId: '00000000-0000-4000-8000-000000000152',
      },
    },
    {
      ...claim,
      attempt: { ...claim.attempt, claimFence: claim.operation.claimFence + 1 },
    },
    {
      ...claim,
      attempt: {
        ...claim.attempt,
        id: '00000000-0000-4000-8000-000000000153',
      },
    },
  ];

  for (const stale of staleClaims) {
    const sender = createAcceptedClaimGatedDeliverySender({
      trustedTenant: { tenantId },
      claim: () => Promise.resolve(stale),
      begin: createDeliveryBeginPort({
        repository: fixture.repository,
        trustedTenant: { tenantId },
      }),
      settle: createDeliverySettlementPort({
        repository: fixture.repository,
        trustedTenant: { tenantId },
      }),
      sender: (delivery) => fixture.child.sendDelivery(delivery),
    });
    await assert.rejects(sender.send(input));
  }
  assert.equal(fixture.socket.sent.length, 0);
});

interface Fixture {
  readonly repository: DeliveryClaimRepositoryPort & { stop(): Promise<void> };
  readonly claim: ReturnType<typeof createDeliveryClaimService>;
  readonly child: ReturnType<typeof createBaileysWorkerChild>;
  readonly sender: ReturnType<typeof createAcceptedClaimGatedDeliverySender>;
  readonly sentInputs: CorrelatedDeliverySend[];
  readonly socket: FakeBaileysSocket;
}

async function createFixture(t: test.TestContext): Promise<Fixture> {
  const postgres = await createDisposablePostgres(t, `warlist-v2-om-06-${process.pid}-`);
  await seed(postgres);

  const repository = createPostgresBusinessRepository({
    config: postgres.config,
    authorization: { assertAuthorized: () => undefined },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { increment() {} },
  });
  await repository.start();
  t.after(() => repository.stop());

  const socket = new FakeBaileysSocket();
  const child = createBaileysWorkerChild({
    credentialDirectory: {
      acquire: () =>
        Promise.resolve({
          use: <T>(operation: (directory: string) => T | PromiseLike<T>) =>
            Promise.resolve(operation('/tmp/warlist-v2-om-06-synthetic')),
          reset: () => Promise.resolve(),
          release: () => Promise.resolve(),
        }),
    },
    socketFactory: {
      create: () =>
        Promise.resolve({
          socket,
          saveCredentials: () => Promise.resolve(),
          loggedOutStatusCode: 401,
        }),
    },
    scheduler: { schedule: () => () => undefined },
    reconnectDelayMs: 2_000,
    send: () => undefined,
  });
  await child.handle({
    protocolVersion: 1,
    requestId: 'request_om_06_start',
    correlationId: input.correlationId,
    tenantId,
    generation: workerGeneration,
    childId,
    type: 'START_WORKER',
    payload: { configVersion: 1 },
  });
  t.after(() => child.stop());

  let attemptSequence = 0;
  const claim = createDeliveryClaimService({
    repository,
    trustedTenant: { tenantId },
    ownerId: 'claim_owner_om_06',
    idGenerator: {
      generate() {
        attemptSequence += 1;
        return `00000000-0000-4000-8000-${String(150 + attemptSequence).padStart(12, '0')}`;
      },
    },
  });
  const sentInputs: CorrelatedDeliverySend[] = [];
  return {
    repository,
    claim,
    child,
    socket,
    sentInputs,
    sender: createAcceptedClaimGatedDeliverySender({
      trustedTenant: { tenantId },
      claim: claim.claim,
      begin: createDeliveryBeginPort({ repository, trustedTenant: { tenantId } }),
      settle: createDeliverySettlementPort({ repository, trustedTenant: { tenantId } }),
      sender: (delivery: CorrelatedDeliverySend) => {
        sentInputs.push(delivery);
        return child.sendDelivery(delivery);
      },
    }),
  };
}

async function seed(postgres: DisposablePostgres): Promise<void> {
  const client = new Client(postgres.config);
  await client.connect();
  try {
    await client.query(
      `INSERT INTO tenants (id, public_ops_id)
       VALUES ($1, 'ops_om_06')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO tenant_worker_ownerships
         (tenant_id, state, generation, child_id, quarantined, revision)
       VALUES ($1, 'RUNNING', $2, $3, false, 1)`,
      [tenantId, workerGeneration, childId],
    );
    await client.query(
      `INSERT INTO delivery_operations (id, tenant_id, operation_key)
       VALUES ($1, $2, 'automation:message_om_06')`,
      [operationId, tenantId],
    );
  } finally {
    await client.end();
  }
}

class FakeBaileysSocket implements BaileysSocketPort {
  readonly events = new EventEmitter();
  readonly sent: Array<{ target: string; content: { text: string } }> = [];
  readonly ev = {
    on: (
      event: 'creds.update' | 'connection.update' | 'messages.upsert',
      listener: (update?: unknown) => void,
    ) => this.events.on(event, listener),
    removeAllListeners: () => this.events.removeAllListeners(),
  };

  requestPairingCode(): Promise<string> {
    return Promise.resolve('discarded');
  }

  sendMessage(target: string, content: { text: string }): Promise<{ key: { id: string } }> {
    this.sent.push({ target, content });
    return Promise.resolve({ key: { id: 'provider_message_om_06' } });
  }

  end(): void {}
}
