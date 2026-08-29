import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { RepositoryError, type TenantRecord } from '../../src/app/business-repository';
import type {
  ApplicationLifecycle,
  RepositoryPort,
  ShutdownSignal,
  ShutdownSignalPort,
} from '../../src/app/ports';
import { IPC_PROTOCOL_VERSION, type ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import { createEntrypoint } from '../../src/main';
import {
  createNodeWorkerCommandTransport,
  type WorkerChildProcessPort,
} from '../../src/modules/whatsapp/infrastructure/node-worker-command-transport';
import { FixedClock, NoopLogger, NoopMetrics, SequenceIdGenerator } from '../support/test-adapters';

const tenantOne = '00000000-0000-4000-8000-000000001601';
const tenantTwo = '00000000-0000-4000-8000-000000001602';

void test('runnable entrypoint boots every canonical active tenant through concrete worker IPC', async () => {
  const repository = new ControlledTenantRepository([tenantOne, tenantTwo]);
  const children: AckingWorkerProcess[] = [];
  const entrypoint = createEntrypoint(
    {
      application: { environment: 'test', serviceName: 'warlist' },
      database: null,
      worker: {
        modulePath: '/tmp/warlist-v2-example-worker.js',
        credentialRoot: '/tmp/warlist-v2-example-credentials',
        commandTimeoutMs: 1_000,
        activeTenants: [
          { tenantId: tenantOne, configVersion: 3 },
          { tenantId: tenantTwo, configVersion: 5 },
        ],
      },
      http: null,
    },
    {
      logger: new NoopLogger(),
      metrics: new NoopMetrics(),
      clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
      idGenerator: new SequenceIdGenerator('worker'),
      signals: new ControlledSignals(),
      createRepository: () => repository,
      spawnWorker() {
        const child = new AckingWorkerProcess();
        children.push(child);
        return child;
      },
      createHttpServer: () => new ControlledHttpServer(),
    },
  );

  await entrypoint.start();

  assert.deepEqual(await entrypoint.httpApp.handle({ method: 'GET', path: '/api/v1/ready' }), {
    status: 200,
    body: {
      ok: true,
      data: { status: 'ready', provider: 'not_observed' },
      meta: {},
      requestId: 'worker-7',
    },
  });
  assert.deepEqual(repository.loads, [tenantOne, tenantTwo]);
  assert.deepEqual(
    children.map(({ messages }) => {
      const message = messages[0];
      assert.ok(message && message.type === 'START_WORKER');
      return {
        tenantId: message.tenantId,
        generation: message.generation,
        childId: message.childId,
        correlationId: message.correlationId,
        configVersion: message.payload.configVersion,
      };
    }),
    [
      {
        tenantId: tenantOne,
        generation: 1,
        childId: 'worker-1',
        correlationId: 'worker-2',
        configVersion: 3,
      },
      {
        tenantId: tenantTwo,
        generation: 1,
        childId: 'worker-3',
        correlationId: 'worker-4',
        configVersion: 5,
      },
    ],
  );

  await entrypoint.stop();
});

void test('partial worker start reaches terminal exit before replacement and ignores unavailable tenants', async () => {
  const unavailableTenant = '00000000-0000-4000-8000-000000001603';
  const repository = new ControlledTenantRepository([tenantOne]);
  repository.errors.set(unavailableTenant, new RepositoryError('DATABASE_UNAVAILABLE'));
  const children: AckingWorkerProcess[] = [];
  const entrypoint = createEntrypoint(
    {
      application: { environment: 'test', serviceName: 'warlist' },
      database: null,
      worker: {
        modulePath: '/tmp/warlist-v2-example-worker.js',
        credentialRoot: '/tmp/warlist-v2-example-credentials',
        commandTimeoutMs: 1_000,
        activeTenants: [
          { tenantId: tenantOne, configVersion: 3 },
          { tenantId: unavailableTenant, configVersion: 1 },
        ],
      },
      http: null,
    },
    {
      logger: new NoopLogger(),
      metrics: new NoopMetrics(),
      clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
      idGenerator: new SequenceIdGenerator('replacement'),
      signals: new ControlledSignals(),
      createRepository: () => repository,
      spawnWorker() {
        const child = new AckingWorkerProcess(children.length === 0 ? 'ERROR' : 'ACK');
        children.push(child);
        return child;
      },
      createHttpServer: () => new ControlledHttpServer(),
    },
  );

  await assert.rejects(entrypoint.start());
  assert.deepEqual(repository.loads, [tenantOne, unavailableTenant]);
  assert.equal(children[0]?.connected, false);

  await entrypoint.start();
  const replacement = children[1]?.messages[0];
  assert.ok(replacement && replacement.type === 'START_WORKER');
  assert.deepEqual(
    {
      tenantId: replacement.tenantId,
      generation: replacement.generation,
      childId: replacement.childId,
    },
    { tenantId: tenantOne, generation: 2, childId: 'replacement-7' },
  );
  assert.equal(children.filter(({ connected }) => connected).length, 1);

  children[0]?.emitExit();
  await entrypoint.start();
  assert.equal(children.length, 2);
  assert.equal(children[1]?.connected, true);

  await entrypoint.stop();
});

void test('child exit during an unacknowledged stop carries the current ownership correlation', async () => {
  const child = new AckingWorkerProcess();
  const exits: Array<Readonly<{ correlationId: string }>> = [];
  const transport = createNodeWorkerCommandTransport({
    modulePath: '/tmp/warlist-v2-example-worker.js',
    credentialRoot: '/tmp/warlist-v2-example-credentials',
    spawn: () => child,
    onChildExit: (identity) => exits.push(identity),
  });
  await transport.start(() => undefined, new AbortController().signal);
  const identity = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    tenantId: tenantOne,
    generation: 1,
    childId: 'child_example_stop_exit',
  } as const;
  await transport.send({
    ...identity,
    type: 'START_WORKER',
    requestId: 'request_example_start',
    correlationId: 'correlation_example_start',
    payload: { configVersion: 1 },
  });
  await transport.send({
    ...identity,
    type: 'STOP_WORKER',
    requestId: 'request_example_stop',
    correlationId: 'correlation_example_stop',
    payload: {},
  });

  child.emitExit();

  assert.deepEqual(exits, [
    {
      tenantId: tenantOne,
      generation: 1,
      childId: 'child_example_stop_exit',
      correlationId: 'correlation_example_stop',
    },
  ]);
});

void test('child exit after config application retains the process ownership correlation', async () => {
  const child = new AckingWorkerProcess();
  const exits: Array<Readonly<{ correlationId: string }>> = [];
  const transport = createNodeWorkerCommandTransport({
    modulePath: '/tmp/warlist-v2-example-worker.js',
    credentialRoot: '/tmp/warlist-v2-example-credentials',
    spawn: () => child,
    onChildExit: (identity) => exits.push(identity),
  });
  await transport.start(() => undefined, new AbortController().signal);
  const identity = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    tenantId: tenantOne,
    generation: 1,
    childId: 'child_example_config_exit',
  } as const;
  await transport.send({
    ...identity,
    type: 'START_WORKER',
    requestId: 'request_example_start_config',
    correlationId: 'correlation_example_owner',
    payload: { configVersion: 1 },
  });
  await transport.send({
    ...identity,
    type: 'APPLY_CONFIG',
    requestId: 'request_example_apply',
    correlationId: 'correlation_example_apply',
    payload: { configVersion: 2 },
  });

  child.emitExit();

  assert.deepEqual(
    exits.map(({ correlationId }) => correlationId),
    ['correlation_example_owner'],
  );
});

class ControlledTenantRepository implements RepositoryPort {
  readonly loads: string[] = [];
  readonly errors = new Map<string, RepositoryError>();
  private readonly tenants: Map<string, TenantRecord>;
  private ready = false;

  constructor(tenantIds: readonly string[]) {
    this.tenants = new Map(tenantIds.map((tenantId) => [tenantId, activeTenant(tenantId)]));
  }

  start(): Promise<void> {
    this.ready = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.ready = false;
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }

  loadTenant(tenantId: string): Promise<TenantRecord | undefined> {
    this.loads.push(tenantId);
    const error = this.errors.get(tenantId);
    if (error) return Promise.reject(error);
    return Promise.resolve(this.tenants.get(tenantId));
  }
}

class ControlledHttpServer implements ApplicationLifecycle {
  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

class ControlledSignals implements ShutdownSignalPort {
  register(signal: ShutdownSignal, handler: () => void): void {
    void signal;
    void handler;
  }

  unregister(signal: ShutdownSignal, handler: () => void): void {
    void signal;
    void handler;
  }
}

class AckingWorkerProcess implements WorkerChildProcessPort {
  connected = true;
  readonly messages: ParentMessage[] = [];
  private readonly events = new EventEmitter();

  constructor(private readonly startOutcome: 'ACK' | 'ERROR' = 'ACK') {}

  on(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  off(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this {
    this.events.off(event, listener);
    return this;
  }

  send(message: ParentMessage, callback: (error: Error | null) => void): boolean {
    this.messages.push(message);
    callback(null);
    queueMicrotask(() => {
      if (message.type !== 'START_WORKER') return;
      if (this.startOutcome === 'ERROR') {
        this.events.emit('error', new Error('synthetic child unavailable after allocation'));
        return;
      }
      this.events.emit('message', {
        ...message,
        type: 'COMMAND_ACK',
        payload: { commandType: message.type, configVersion: message.payload.configVersion },
      });
    });
    return true;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    queueMicrotask(() => this.events.emit('exit', 0, null));
  }

  kill(): boolean {
    this.disconnect();
    return true;
  }

  emitExit(): void {
    this.connected = false;
    this.events.emit('exit', 1, null);
  }
}

function activeTenant(id: string): TenantRecord {
  return Object.freeze({
    id,
    publicOpsId: `ops_example_${id.slice(-4)}`,
    status: 'ACTIVE',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  });
}
