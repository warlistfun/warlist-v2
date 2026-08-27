import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { Client } from 'pg';

import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDeliveryClaimService } from '../../src/modules/delivery/application/delivery-claim-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../src/modules/delivery/application/claim-gated-delivery-sender';
import {
  createBaileysWorkerChild,
  type BaileysSocketPort,
} from '../../src/modules/whatsapp/infrastructure/baileys-worker-child';
import { createDisposablePostgres, type DisposablePostgres } from '../support/disposable-postgres';

const tenantId = '00000000-0000-4000-8000-000000000150';
const operationId = '00000000-0000-4000-8000-000000000151';
const attemptId = '00000000-0000-4000-8000-000000000152';
const workerGeneration = 7;
const childId = 'child_om_07';
const input = {
  decisionCode: 'ACCEPTED',
  correlationId: 'correlation_om_07',
  tenantId,
  operationId,
  workerGeneration,
  childId,
  target: 'synthetic_group_om_07',
  text: 'Synthetic OM-07 message',
} as const;

void test('successful concrete send durably settles bounded SENT evidence before completion', async (t) => {
  const fixture = await createFixture(t);
  const settle = createDeliverySettlementPort({
    repository: fixture.repository,
    trustedTenant: { tenantId },
  });
  let signalSettlement!: () => void;
  const settlementStarted = new Promise<'settling'>((resolve) => {
    signalSettlement = () => resolve('settling');
  });
  let releaseSettlement!: () => void;
  const settlementRelease = new Promise<void>((resolve) => {
    releaseSettlement = resolve;
  });
  const sender = createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId },
    claim: fixture.claim.claim,
    begin: createDeliveryBeginPort({ repository: fixture.repository, trustedTenant: { tenantId } }),
    sender: (delivery) => fixture.child.sendDelivery(delivery),
    settle: async (authority) => {
      signalSettlement();
      await settlementRelease;
      return settle(authority);
    },
  });

  let completed = false;
  const completion = sender.send(input).then((result) => {
    completed = true;
    return result;
  });
  assert.equal(await Promise.race([settlementStarted, completion]), 'settling');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENDING');
  assert.equal(fixture.socket.sent.length, 1);

  releaseSettlement();
  assert.deepEqual(await completion, {
    outcome: 'SENT',
    tenantId,
    operationId,
    attemptId,
    claimFence: 1,
    workerGeneration,
    childId,
    providerMessageId: 'provider_message_om_07',
  });
  assert.equal((await fixture.repository.loadDelivery(tenantId, operationId))?.status, 'SENT');
  const attempt = await fixture.repository.loadDeliveryAttempt(tenantId, attemptId);
  assert.equal(attempt?.status, 'SENT');
  assert.equal(attempt?.providerMessageId, 'provider_message_om_07');
});

void test('duplicate delivery, restart, and replay read durable SENT evidence without resending', async (t) => {
  const fixture = await createFixture(t);
  const firstSender = createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId },
    claim: fixture.claim.claim,
    begin: createDeliveryBeginPort({ repository: fixture.repository, trustedTenant: { tenantId } }),
    sender: (delivery) => fixture.child.sendDelivery(delivery),
    settle: createDeliverySettlementPort({
      repository: fixture.repository,
      trustedTenant: { tenantId },
    }),
  });

  const sent = await firstSender.send(input);
  const duplicate = await firstSender.send(input);
  assert.deepEqual(duplicate, sent);
  assert.equal(fixture.socket.sent.length, 1);

  await fixture.repository.stop();
  const restartedRepository = createRepository(fixture.postgres);
  await restartedRepository.start();
  t.after(() => restartedRepository.stop());
  let replaySends = 0;
  let generatedAttempts = 0;
  const restartedSender = createAcceptedClaimGatedDeliverySender({
    trustedTenant: { tenantId },
    claim: createDeliveryClaimService({
      repository: restartedRepository,
      trustedTenant: { tenantId },
      ownerId: 'claim_owner_om_07_restart',
      idGenerator: {
        generate: () =>
          `00000000-0000-4000-8000-${String(160 + ++generatedAttempts).padStart(12, '0')}`,
      },
    }).claim,
    begin: createDeliveryBeginPort({
      repository: restartedRepository,
      trustedTenant: { tenantId },
    }),
    sender: () => {
      replaySends += 1;
      return Promise.resolve({ providerMessageId: 'provider_message_must_not_send' });
    },
    settle: createDeliverySettlementPort({
      repository: restartedRepository,
      trustedTenant: { tenantId },
    }),
  });

  assert.deepEqual(await restartedSender.send(input), sent);
  assert.deepEqual(await restartedSender.send(input), sent);
  assert.equal(replaySends, 0);
  assert.equal(fixture.socket.sent.length, 1);
  assert.equal(
    await restartedRepository.loadDeliveryAttempt(tenantId, '00000000-0000-4000-8000-000000000161'),
    undefined,
  );
});

interface Fixture {
  readonly postgres: DisposablePostgres;
  readonly repository: ReturnType<typeof createPostgresBusinessRepository>;
  readonly claim: ReturnType<typeof createDeliveryClaimService>;
  readonly child: ReturnType<typeof createBaileysWorkerChild>;
  readonly socket: FakeBaileysSocket;
}

async function createFixture(t: test.TestContext): Promise<Fixture> {
  const postgres = await createDisposablePostgres(t, `warlist-v2-om-07-${process.pid}-`);
  await seed(postgres);
  const repository = createRepository(postgres);
  await repository.start();
  t.after(() => repository.stop());

  const socket = new FakeBaileysSocket();
  const child = createBaileysWorkerChild({
    credentialDirectory: {
      acquire: () =>
        Promise.resolve({
          use: <T>(operation: (directory: string) => T | PromiseLike<T>) =>
            Promise.resolve(operation('/tmp/warlist-v2-om-07-synthetic')),
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
    requestId: 'request_om_07_start',
    correlationId: input.correlationId,
    tenantId,
    generation: workerGeneration,
    childId,
    type: 'START_WORKER',
    payload: { configVersion: 1 },
  });
  t.after(() => child.stop());

  return {
    postgres,
    repository,
    child,
    socket,
    claim: createDeliveryClaimService({
      repository,
      trustedTenant: { tenantId },
      ownerId: 'claim_owner_om_07',
      idGenerator: { generate: () => attemptId },
    }),
  };
}

function createRepository(postgres: DisposablePostgres) {
  return createPostgresBusinessRepository({
    config: postgres.config,
    authorization: { assertAuthorized: () => undefined },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { increment() {} },
  });
}

async function seed(postgres: DisposablePostgres): Promise<void> {
  const client = new Client(postgres.config);
  await client.connect();
  try {
    await client.query(`INSERT INTO tenants (id, public_ops_id) VALUES ($1, 'ops_om_07')`, [
      tenantId,
    ]);
    await client.query(
      `INSERT INTO tenant_worker_ownerships
         (tenant_id, state, generation, child_id, quarantined, revision)
       VALUES ($1, 'RUNNING', $2, $3, false, 1)`,
      [tenantId, workerGeneration, childId],
    );
    await client.query(
      `INSERT INTO delivery_operations (id, tenant_id, operation_key)
       VALUES ($1, $2, 'automation:message_om_07')`,
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

  sendMessage(target: string, content: { text: string }): Promise<unknown> {
    this.sent.push({ target, content });
    return Promise.resolve({
      key: { id: 'provider_message_om_07' },
      discarded: 'provider payload',
    });
  }

  end(): void {}
}
