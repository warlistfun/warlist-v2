import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
  await flush();
  assert.equal(fixture.sockets.saved, 1);

  first.events.emit('connection.update', { connection: 'open' });
  first.events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  });
  assert.equal(first.ended, 1);
  assert.equal(first.listenerCount(), 0);
  fixture.reconnectScheduler.runNext();
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

void test('keeps credential failures and logged-out provider payloads behind safe diagnostics', async (t) => {
  const fixture = await createFixture(t);
  const sensitiveMarker = 'customer-content-must-not-cross-the-child-boundary';
  fixture.sockets.nextSaveFailure = new Error(sensitiveMarker);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });

  const socket = fixture.sockets.created[0]!;
  socket.events.emit('creds.update', { rawCredential: sensitiveMarker });
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

async function createFixture(t: test.TestContext) {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-01-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const sockets = new FakeBaileysSocketFactory();
  const reconnectScheduler = new ManualScheduler();
  let spawned = 0;

  const spawn: SpawnWorkerChildPort = (_modulePath, arguments_) => {
    spawned += 1;
    assert.deepEqual(arguments_, [credentialRoot]);
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

class FakeBaileysSocketFactory implements BaileysSocketFactoryPort {
  readonly created: FakeBaileysSocket[] = [];
  readonly directories: string[] = [];
  nextSaveFailure: Error | undefined;
  saved = 0;

  create(directory: string) {
    const socket = new FakeBaileysSocket();
    this.created.push(socket);
    this.directories.push(directory);
    return Promise.resolve({
      socket,
      loggedOutStatusCode: 401,
      saveCredentials: () => {
        this.saved += 1;
        const error = this.nextSaveFailure;
        this.nextSaveFailure = undefined;
        return error ? Promise.reject(error) : Promise.resolve();
      },
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

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
