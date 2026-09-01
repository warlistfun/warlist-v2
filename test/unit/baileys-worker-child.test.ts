import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, lstat, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ChildMessage, ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import {
  createWorkerDiagnosticsService,
  type WorkerDiagnosticEvent,
} from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import {
  createWorkerRuntimeService,
  type CancelScheduledTask,
  type ScheduleTaskPort,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
import {
  createBaileysWorkerChild,
  type BaileysSocketFactoryPort,
  type BaileysSocketPort,
} from '../../src/modules/whatsapp/infrastructure/baileys-worker-child';
import { createLocalWhatsAppCredentialDirectory } from '../../src/modules/whatsapp/infrastructure/local-whatsapp-credential-directory';
import {
  createNodeWorkerCommandTransport,
  type SpawnWorkerChildPort,
  type WorkerChildProcessPort,
} from '../../src/modules/whatsapp/infrastructure/node-worker-command-transport';
import { SequenceIdGenerator } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000132';
const worker = {
  tenantId,
  generation: 1,
  childId: 'child_example_132',
  correlationId: 'corr_example_132',
  configVersion: 1,
} as const;

void test('runs start, credential save, retry, and terminal stop through one concrete child', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();

  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  assert.equal(fixture.spawned, 1);
  assert.equal(fixture.sockets.created.length, 1);
  assert.deepEqual(fixture.sockets.directories, [join(fixture.credentialRoot, tenantId)]);
  assert.deepEqual(await readdir(join(fixture.credentialRoot, tenantId)), []);

  const first = fixture.sockets.created[0]!;
  first.events.emit('creds.update');
  await fixture.sockets.firstSave;
  assert.equal(fixture.sockets.saved, 1);

  first.events.emit('connection.update', { connection: 'open' });
  first.events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  });
  assert.equal(first.ended, 1);
  assert.equal(first.listenerCount(), 0);
  fixture.reconnectScheduler.runNext();
  await fixture.sockets.secondSocket;
  await flush();

  assert.equal(fixture.sockets.created.length, 2);
  const second = fixture.sockets.created[1]!;
  second.events.emit('connection.update', { connection: 'open' });
  second.events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  });
  assert.equal(fixture.reconnectScheduler.activeCount(), 1);

  assert.deepEqual(await fixture.runtime.stopWorker(worker), { ok: true });
  assert.equal(fixture.reconnectScheduler.activeCount(), 0);
  fixture.reconnectScheduler.runAll();
  await flush();
  assert.equal(fixture.sockets.created.length, 2);
  assert.equal(second.ended, 1);
  assert.equal(second.listenerCount(), 0);

  const diagnosticsAfterStop = fixture.diagnostics.length;
  first.events.emit('creds.update');
  second.events.emit('connection.update', { connection: 'open' });
  await flush();
  assert.equal(fixture.sockets.saved, 1);
  assert.equal(fixture.diagnostics.length, diagnosticsAfterStop);

  await fixture.runtime.stop();
  await fixture.runtime.stop();
  assert.deepEqual(projectDiagnostics(fixture.diagnostics), [
    ['CONNECTION', 'CONNECTING'],
    ['COMMAND', 'START_WORKER', 'ACKNOWLEDGED'],
    ['CONNECTION', 'OPEN'],
    ['CONNECTION', 'CLOSED_RETRYING'],
    ['CONNECTION', 'CONNECTING'],
    ['CONNECTION', 'OPEN'],
    ['CONNECTION', 'CLOSED_RETRYING'],
    ['CONNECTION', 'STOPPED'],
    ['COMMAND', 'STOP_WORKER', 'ACKNOWLEDGED'],
  ]);
});

void test('resumes a synthetic QR-authenticated credential root without offering a second QR', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-18-8-resume-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const marker = join(credentialRoot, tenantId, 'synthetic-authenticated');
  const messages: ChildMessage[] = [];
  const sockets = new ResumeSocketFactory(marker);
  const first = createBaileysWorkerChild({
    credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
    socketFactory: sockets,
    scheduler: new ManualScheduler(),
    reconnectDelayMs: 1,
    send: (message) => messages.push(message),
  });
  const firstStart = {
    protocolVersion: 1 as const,
    requestId: 'req_om_18_8_first',
    correlationId: worker.correlationId,
    tenantId,
    generation: 1,
    childId: 'child_example_18_8_first',
    type: 'START_WORKER' as const,
    payload: { configVersion: 1 },
  };

  await first.handle(firstStart);
  await flush();
  assert.equal(sockets.qrOffered, 1);
  sockets.created[0]!.events.emit('creds.update');
  await sockets.saved;
  sockets.created[0]!.events.emit('connection.update', { connection: 'open' });
  await flush();
  await first.handle({ ...firstStart, requestId: 'req_om_18_8_first_stop', type: 'STOP_WORKER', payload: {} });

  const second = createBaileysWorkerChild({
    credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
    socketFactory: sockets,
    scheduler: new ManualScheduler(),
    reconnectDelayMs: 1,
    send: (message) => messages.push(message),
  });
  const secondStart = {
    ...firstStart,
    requestId: 'req_om_18_8_second',
    generation: 2,
    childId: 'child_example_18_8_second',
  };
  await second.handle(secondStart);
  await flush();
  assert.equal(sockets.resumed, true);
  assert.equal(sockets.qrOffered, 1);
  sockets.created[1]!.events.emit('connection.update', { connection: 'open' });
  await flush();
  await second.handle({ ...secondStart, requestId: 'req_om_18_8_second_stop', type: 'STOP_WORKER', payload: {} });

  assert.deepEqual(
    messages
      .filter((message) => message.type === 'CONNECTION_UPDATE' && message.payload.state === 'OPEN')
      .map((message) => [message.generation, message.childId]),
    [
      [1, 'child_example_18_8_first'],
      [2, 'child_example_18_8_second'],
    ],
  );

  assert.equal(JSON.stringify(messages).includes('synthetic-qr'), false);
  assert.equal(JSON.stringify(messages).includes(credentialRoot), false);
  await rm(credentialRoot, { recursive: true, force: true });
  await assert.rejects(lstat(credentialRoot), (error: unknown) => hasFileCode(error, 'ENOENT'));
});

void test('keeps credential failures and logged-out provider payloads behind safe diagnostics', async (t) => {
  const fixture = await createFixture(t);
  const sensitiveMarker = 'customer-content-must-not-cross-the-child-boundary';
  fixture.sockets.nextSaveFailure = new Error(sensitiveMarker);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });

  const socket = fixture.sockets.created[0]!;
  socket.events.emit('creds.update', { rawCredential: sensitiveMarker });
  await fixture.sockets.firstSave;
  await flush();
  socket.events.emit('connection.update', {
    connection: 'close',
    qr: sensitiveMarker,
    message: sensitiveMarker,
    lastDisconnect: {
      error: {
        message: sensitiveMarker,
        output: { statusCode: 401, rawProviderPayload: sensitiveMarker },
      },
    },
  });
  await flush();

  assert.equal(socket.ended, 1);
  assert.equal(socket.listenerCount(), 0);
  assert.equal(fixture.reconnectScheduler.activeCount(), 0);
  fixture.reconnectScheduler.runAll();
  assert.equal(fixture.sockets.created.length, 1);
  assert.equal(JSON.stringify(fixture.diagnostics).includes(sensitiveMarker), false);
  assert.equal(JSON.stringify(fixture.diagnostics).includes(fixture.credentialRoot), false);
  assert.deepEqual(projectDiagnostics(fixture.diagnostics), [
    ['CONNECTION', 'CONNECTING'],
    ['COMMAND', 'START_WORKER', 'ACKNOWLEDGED'],
    ['CONNECTION', 'CREDENTIALS_SAVE_FAILED'],
    ['CONNECTION', 'LOGGED_OUT'],
  ]);

  const diagnosticsAfterLogout = fixture.diagnostics.length;
  socket.events.emit('creds.update');
  socket.events.emit('connection.update', { connection: 'open' });
  await flush();
  assert.equal(fixture.diagnostics.length, diagnosticsAfterLogout);

  assert.deepEqual(await fixture.runtime.stopWorker(worker), { ok: true });
  await fixture.runtime.stop();
  assert.deepEqual(projectDiagnostics(fixture.diagnostics).slice(-2), [
    ['CONNECTION', 'STOPPED'],
    ['COMMAND', 'STOP_WORKER', 'ACKNOWLEDGED'],
  ]);
});

void test('deletes synthetic auth only after an explicit reset reaches terminal stop', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-05-reset-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const credentialDirectory = join(credentialRoot, tenantId);
  const marker = join(credentialDirectory, 'synthetic-auth-marker');
  const sockets = new FakeBaileysSocketFactory();
  const reconnectScheduler = new ManualScheduler();
  const messages: ChildMessage[] = [];
  const child = createBaileysWorkerChild({
    credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
    socketFactory: sockets,
    scheduler: reconnectScheduler,
    reconnectDelayMs: 2_000,
    send(message) {
      messages.push(message);
    },
  });

  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_start_1',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type: 'START_WORKER',
    payload: { configVersion: worker.configVersion },
  });
  await writeFile(marker, 'invented synthetic state', { mode: 0o600 });

  const first = sockets.created[0]!;
  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_pairing',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type: 'REQUEST_PAIRING',
    payload: { pairingTarget: 'synthetic_om_05_target' },
  });
  first.events.emit('connection.update', { connection: 'open', qr: 'synthetic-signal' });
  await flush();
  await access(marker);

  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_stale_reset',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation + 1,
    childId: 'child_example_146_stale',
    type: 'RESET_WORKER',
    payload: {},
  });
  await access(marker);

  first.events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  });
  reconnectScheduler.runNext();
  await sockets.secondSocket;
  await access(marker);

  const second = sockets.created[1]!;
  second.events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } },
  });
  assert.equal(reconnectScheduler.activeCount(), 0);
  await access(marker);

  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_stop',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type: 'STOP_WORKER',
    payload: {},
  });
  await access(marker);

  const resetWorker = {
    ...worker,
    generation: 2,
    childId: 'child_example_146',
  } as const;
  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_start_2',
    correlationId: resetWorker.correlationId,
    tenantId,
    generation: resetWorker.generation,
    childId: resetWorker.childId,
    type: 'START_WORKER',
    payload: { configVersion: resetWorker.configVersion },
  });
  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_05_reset',
    correlationId: resetWorker.correlationId,
    tenantId,
    generation: resetWorker.generation,
    childId: resetWorker.childId,
    type: 'RESET_WORKER',
    payload: {},
  });

  await assert.rejects(access(credentialDirectory), (error: unknown) =>
    hasFileCode(error, 'ENOENT'),
  );
  assert.equal(
    messages.some(
      (message) =>
        message.type === 'COMMAND_ACK' &&
        (message.payload as Readonly<{ commandType?: string }>).commandType === 'RESET_WORKER',
    ),
    true,
  );
});

void test('allows a fresh owner only after reset acknowledgement releases the child', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  assert.deepEqual(await fixture.runtime.resetWorker(worker), { ok: true });

  const next = {
    ...worker,
    generation: 2,
    childId: 'child_example_146_next',
    correlationId: 'corr_example_146_next',
  } as const;
  assert.deepEqual(await fixture.runtime.startWorker(next), { ok: true });
  assert.equal(fixture.spawned, 2);
  await fixture.runtime.stopWorker(next);
  await fixture.runtime.stop();
});

void test('runtime shutdown disposes an open socket exactly once', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });

  const socket = fixture.sockets.created[0]!;
  socket.events.emit('connection.update', { connection: 'open' });
  await fixture.runtime.stop();
  await fixture.runtime.stop();

  assert.equal(socket.ended, 1);
  assert.equal(socket.listenerCount(), 0);
  assert.equal(fixture.reconnectScheduler.activeCount(), 0);
  assert.equal(fixture.sockets.created.length, 1);
  assert.deepEqual(projectDiagnostics(fixture.diagnostics), [
    ['CONNECTION', 'CONNECTING'],
    ['COMMAND', 'START_WORKER', 'ACKNOWLEDGED'],
    ['CONNECTION', 'OPEN'],
  ]);
});

void test('fences factory-owned credential callbacks after stop', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-04-callback-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const socketFactory = new CredentialAccessSocketFactory();
  const child = createBaileysWorkerChild({
    credentialDirectory: createLocalWhatsAppCredentialDirectory({
      root: join(sandbox, 'credentials'),
    }),
    socketFactory,
    scheduler: new ManualScheduler(),
    reconnectDelayMs: 2_000,
    send() {},
  });
  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_04_callback',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type: 'START_WORKER',
    payload: { configVersion: worker.configVersion },
  });

  assert.equal(await socketFactory.accessCredentials(), 1);
  await child.stop();
  await assert.rejects(
    socketFactory.accessCredentials(),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CREDENTIAL_DIRECTORY_OWNERSHIP_LOST',
  );
});

void test('child stop waits for credential ownership release', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-04-stop-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  let releaseOwnership!: () => void;
  let releaseStarted = false;
  let stopSettled = false;
  const child = createBaileysWorkerChild({
    credentialDirectory: {
      acquire: () =>
        Promise.resolve({
          use: async <T>(operation: (directory: string) => T | PromiseLike<T>) =>
            operation(join(sandbox, 'credentials', tenantId)),
          reset: () => Promise.resolve(),
          release: () =>
            new Promise<void>((resolve) => {
              releaseStarted = true;
              releaseOwnership = resolve;
            }),
        }),
    },
    socketFactory: new FakeBaileysSocketFactory(),
    scheduler: new ManualScheduler(),
    reconnectDelayMs: 2_000,
    send() {},
  });
  await child.handle({
    protocolVersion: 1,
    requestId: 'req_example_om_04_stop',
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type: 'START_WORKER',
    payload: { configVersion: worker.configVersion },
  });

  const stopping = child.stop().then(() => {
    stopSettled = true;
  });
  await flush();
  assert.equal(releaseStarted, true);
  assert.equal(stopSettled, false);

  releaseOwnership();
  await stopping;
  assert.equal(stopSettled, true);
});

void test('accepts only a higher current-owner config revision and recovers it from start', async () => {
  const messages: ChildMessage[] = [];
  const child = createBaileysWorkerChild({
    credentialDirectory: {
      acquire: () =>
        Promise.resolve({
          use: <T>(operation: (directory: string) => T | PromiseLike<T>) =>
            Promise.resolve(operation('synthetic')),
          reset: () => Promise.resolve(),
          release: () => Promise.resolve(),
        }),
    },
    socketFactory: new FakeBaileysSocketFactory(),
    scheduler: new ManualScheduler(),
    reconnectDelayMs: 2_000,
    send(message) {
      messages.push(message);
    },
  });
  const command = (
    type: 'START_WORKER' | 'APPLY_CONFIG',
    configVersion: number,
    requestId: string,
  ) => ({
    protocolVersion: 1 as const,
    requestId,
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
    type,
    payload: { configVersion },
  });

  await child.handle(command('START_WORKER', 3, 'req_start'));
  await child.handle(command('APPLY_CONFIG', 3, 'req_equal'));
  await child.handle(command('APPLY_CONFIG', 2, 'req_stale'));
  await child.handle({ ...command('APPLY_CONFIG', 4, 'req_wrong_owner'), childId: 'child_other' });
  await child.handle(command('APPLY_CONFIG', 4, 'req_higher'));

  assert.deepEqual(
    messages
      .filter((message) => message.type === 'COMMAND_ACK' || message.type === 'COMMAND_ERROR')
      .map((message) =>
        message.type === 'COMMAND_ACK'
          ? [
              message.type,
              message.requestId,
              (message.payload as { readonly configVersion: number }).configVersion,
            ]
          : [message.type, message.requestId],
      ),
    [
      ['COMMAND_ACK', 'req_start', 3],
      ['COMMAND_ERROR', 'req_equal'],
      ['COMMAND_ERROR', 'req_stale'],
      ['COMMAND_ERROR', 'req_wrong_owner'],
      ['COMMAND_ACK', 'req_higher', 4],
    ],
  );
});

async function createFixture(t: test.TestContext) {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-01-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const sockets = new FakeBaileysSocketFactory();
  const reconnectScheduler = new ManualScheduler();
  let spawned = 0;

  const spawn: SpawnWorkerChildPort = (_modulePath, arguments_) => {
    spawned += 1;
    assert.deepEqual(arguments_, [credentialRoot, '3005']);
    const process = new FakeWorkerChildProcess();
    const child = createBaileysWorkerChild({
      credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
      socketFactory: sockets,
      scheduler: reconnectScheduler,
      reconnectDelayMs: 2_000,
      send(message) {
        process.receive(message);
      },
    });
    process.attach(child);
    return process;
  };

  const diagnostics: WorkerDiagnosticEvent[] = [];
  const transport = createNodeWorkerCommandTransport({
    modulePath: join(sandbox, 'baileys-worker-child.js'),
    credentialRoot,
    pairingConsolePort: 3005,
    spawn,
  });
  const runtime = createWorkerRuntimeService({
    transport,
    scheduler: new ManualScheduler(),
    idGenerator: new SequenceIdGenerator('req'),
    commandTimeoutMs: 5_000,
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  });

  return {
    runtime,
    sockets,
    reconnectScheduler,
    diagnostics,
    credentialRoot,
    get spawned() {
      return spawned;
    },
  };
}

class ManualScheduler implements ScheduleTaskPort {
  private readonly tasks: Array<{ active: boolean; task: () => void }> = [];

  schedule(_delayMs: number, task: () => void): CancelScheduledTask {
    const scheduled = { active: true, task };
    this.tasks.push(scheduled);
    return () => {
      scheduled.active = false;
    };
  }

  activeCount(): number {
    return this.tasks.filter((candidate) => candidate.active).length;
  }

  runNext(): void {
    const scheduled = this.tasks.find((candidate) => candidate.active);
    assert.ok(scheduled, 'expected a scheduled task');
    scheduled.active = false;
    scheduled.task();
  }

  runAll(): void {
    for (const scheduled of this.tasks.filter((candidate) => candidate.active)) {
      scheduled.active = false;
      scheduled.task();
    }
  }
}

class ResumeSocketFactory implements BaileysSocketFactoryPort {
  readonly created: FakeBaileysSocket[] = [];
  readonly saved: Promise<void>;
  qrOffered = 0;
  resumed = false;
  private readonly resolveSaved: () => void;

  constructor(private readonly marker: string) {
    let resolveSaved!: () => void;
    this.saved = new Promise<void>((resolve) => {
      resolveSaved = resolve;
    });
    this.resolveSaved = resolveSaved;
  }

  async create(credentials: Parameters<BaileysSocketFactoryPort['create']>[0]) {
    const authenticated = await credentials.use(async () =>
      access(this.marker).then(
        () => true,
        () => false,
      ),
    );
    this.resumed ||= authenticated;
    const socket = new FakeBaileysSocket();
    if (!authenticated) {
      queueMicrotask(() => {
        this.qrOffered += 1;
        socket.events.emit('connection.update', { qr: 'synthetic-qr' });
      });
    }
    this.created.push(socket);
    return {
      socket,
      loggedOutStatusCode: 401,
      saveCredentials: async () => {
        await writeFile(this.marker, 'invented authenticated state', { mode: 0o600 });
        this.resolveSaved();
      },
    };
  }
}

class CredentialAccessSocketFactory implements BaileysSocketFactoryPort {
  private access: (() => Promise<number>) | undefined;

  create(credentials: Parameters<BaileysSocketFactoryPort['create']>[0]) {
    return credentials.use((directory) => {
      this.access = () => credentials.use(() => Promise.resolve(directory.length > 0 ? 1 : 0));
      return {
        socket: new FakeBaileysSocket(),
        loggedOutStatusCode: 401,
        saveCredentials: () => Promise.resolve(),
      };
    });
  }

  accessCredentials(): Promise<number> {
    assert.ok(this.access);
    return this.access();
  }
}

class FakeBaileysSocketFactory implements BaileysSocketFactoryPort {
  private resolveFirstSave!: () => void;
  private resolveSecondSocket!: () => void;
  readonly created: FakeBaileysSocket[] = [];
  readonly directories: string[] = [];
  readonly firstSave = new Promise<void>((resolve) => {
    this.resolveFirstSave = resolve;
  });
  readonly secondSocket = new Promise<void>((resolve) => {
    this.resolveSecondSocket = resolve;
  });
  nextSaveFailure: Error | undefined;
  saved = 0;

  create(credentials: Parameters<BaileysSocketFactoryPort['create']>[0]) {
    return credentials.use((directory) => {
      const socket = new FakeBaileysSocket();
      this.created.push(socket);
      this.directories.push(directory);
      if (this.created.length === 2) this.resolveSecondSocket();
      return {
        socket,
        loggedOutStatusCode: 401,
        saveCredentials: () => {
          this.saved += 1;
          this.resolveFirstSave();
          const error = this.nextSaveFailure;
          this.nextSaveFailure = undefined;
          return error ? Promise.reject(error) : Promise.resolve();
        },
      };
    });
  }
}

class FakeBaileysSocket implements BaileysSocketPort {
  readonly events = new EventEmitter();
  ended = 0;

  readonly ev = {
    on: (
      event: 'creds.update' | 'connection.update',
      listener: (...arguments_: unknown[]) => void,
    ) => {
      this.events.on(event, listener);
    },
    removeAllListeners: () => {
      this.events.removeAllListeners();
    },
  };

  requestPairingCode(): Promise<string> {
    return Promise.resolve('unused');
  }

  listenerCount(): number {
    return this.events
      .eventNames()
      .reduce((count, event) => count + this.events.listenerCount(event), 0);
  }

  end(): void {
    this.ended += 1;
  }
}

interface WorkerChild {
  handle(message: unknown): Promise<void>;
  stop(): Promise<void>;
}

class FakeWorkerChildProcess implements WorkerChildProcessPort {
  connected = true;
  private readonly events = new EventEmitter();
  private child: WorkerChild | undefined;

  attach(child: WorkerChild): void {
    assert.equal(this.child, undefined);
    this.child = child;
  }

  on(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  off(event: 'message' | 'exit' | 'error', listener: (...arguments_: unknown[]) => void): this {
    this.events.off(event, listener);
    return this;
  }

  send(message: ParentMessage, callback: (error: Error | null) => void): boolean {
    assert.ok(this.child);
    callback(null);
    void this.child.handle(message);
    return true;
  }

  disconnect(): void {
    if (!this.connected) return;
    assert.ok(this.child);
    this.connected = false;
    void this.child.stop().then(() => {
      this.events.emit('exit', 0, null);
    });
  }

  kill(): boolean {
    this.disconnect();
    return true;
  }

  receive(message: ChildMessage): void {
    this.events.emit('message', message);
  }
}

function projectDiagnostics(events: readonly WorkerDiagnosticEvent[]): string[][] {
  return events.map((event) => {
    if (event.kind === 'CONNECTION') return [event.kind, event.state];
    if (event.kind === 'COMMAND') return [event.kind, event.commandType, event.outcome];
    if (event.kind === 'INBOUND') {
      return [event.kind, event.transportCode, event.decisionCode ?? 'none'];
    }
    return [event.kind, event.state];
  });
}

function hasFileCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Readonly<{ code?: unknown }>).code === code
  );
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
