import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import {
  createWorkerDiagnosticsService,
  type WorkerDiagnosticEvent,
} from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import {
  WorkerRuntimeError,
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

const tenantId = '00000000-0000-4000-8000-000000000140';
const worker = {
  tenantId,
  generation: 1,
  childId: 'child_example_140',
  correlationId: 'corr_example_140',
  configVersion: 1,
} as const;
const pairingTarget = 'synthetic_pairing_target_140';
const sensitive = {
  code: 'pairing-code-must-not-cross-boundary',
  credential: 'credential-payload-must-not-cross-boundary',
  jid: 'provider-identity@g.us',
  provider: 'raw-provider-update-must-not-cross-boundary',
  qr: 'qr-material-must-not-cross-boundary',
} as const;

void test('runs one fenced synthetic pairing request and exposes only bounded onboarding states', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  fixture.socket.events.emit('connection.update', {
    qr: '',
    rawProviderUpdate: sensitive.provider,
  });
  await flush();
  assert.deepEqual(fixture.socket.pairingTargets, []);
  fixture.socket.events.emit('connection.update', {
    qr: sensitive.qr,
    rawProviderUpdate: sensitive.provider,
  });
  await flush();
  assert.deepEqual(fixture.socket.pairingTargets, []);

  const request = fixture.runtime.requestPairing({ ...worker, pairingTarget });
  const pendingDuplicate = fixture.runtime.requestPairing({ ...worker, pairingTarget });
  assert.equal(request, pendingDuplicate);
  assert.deepEqual(await request, { ok: true });
  await flush();
  assert.deepEqual(fixture.socket.pairingTargets, [pairingTarget]);
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'CODE_READY']);
  assert.deepEqual(await fixture.runtime.requestPairing({ ...worker, pairingTarget }), {
    ok: true,
  });
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'CODE_READY']);

  const source = fixture.childMessages.find(
    (message) =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'PAIRING_UPDATE',
  );
  assert.ok(source);
  const beforeForged = fixture.diagnostics.length;
  for (const forged of [
    { ...source, requestId: 'request_example_forged' },
    { ...source, correlationId: 'corr_example_forged' },
    { ...source, tenantId: '00000000-0000-4000-8000-000000000999' },
    { ...source, generation: worker.generation + 1 },
    { ...source, childId: 'child_example_forged' },
  ]) {
    fixture.childProcess.receive(forged);
  }
  assert.equal(fixture.diagnostics.length, beforeForged);

  fixture.socket.events.emit('creds.update', { credential: sensitive.credential });
  fixture.socket.events.emit('connection.update', {
    qr: sensitive.qr,
    jid: sensitive.jid,
    rawProviderUpdate: sensitive.provider,
  });
  await flush();

  assert.deepEqual(fixture.socket.pairingTargets, [pairingTarget]);
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'CODE_READY']);

  fixture.socket.events.emit('connection.update', {
    connection: 'open',
    qr: sensitive.qr,
    jid: sensitive.jid,
    rawProviderUpdate: sensitive.provider,
  });
  fixture.socket.events.emit('connection.update', { connection: 'open', qr: sensitive.qr });
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'CODE_READY', 'OPEN']);

  fixture.socket.events.emit('connection.update', {
    connection: 'close',
    qr: sensitive.qr,
    jid: sensitive.jid,
    rawProviderUpdate: sensitive.provider,
    lastDisconnect: { error: { output: { statusCode: 408 }, raw: sensitive.provider } },
  });
  fixture.socket.events.emit('connection.update', { connection: 'close' });
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), [
    'REQUESTED',
    'CODE_READY',
    'OPEN',
    'CLOSED',
  ]);
  assert.equal(fixture.reconnectScheduler.activeCount(), 1);

  await assert.rejects(
    fixture.runtime.requestPairing({
      ...worker,
      pairingTarget: 'synthetic_different_target_140',
    }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_COMMAND_REJECTED',
  );
  assert.deepEqual(fixture.socket.pairingTargets, [pairingTarget]);

  assert.deepEqual(await fixture.runtime.stopWorker(worker), { ok: true });
  await fixture.runtime.stop();
  await fixture.runtime.stop();
  assert.deepEqual(pairingStates(fixture.diagnostics), [
    'REQUESTED',
    'CODE_READY',
    'OPEN',
    'CLOSED',
    'STOPPED',
  ]);
  assert.equal(fixture.reconnectScheduler.activeCount(), 0);
  assert.equal(fixture.socket.listenerCount(), 0);
  assert.equal(fixture.socket.ended, 1);

  const exposed = JSON.stringify({
    childMessages: fixture.childMessages,
    diagnostics: fixture.diagnostics,
  });
  for (const forbidden of [...Object.values(sensitive), pairingTarget]) {
    assert.equal(exposed.includes(forbidden), false, `must not expose ${forbidden}`);
  }
});

void test('keeps an open pairing terminal when code settlement arrives late', async (t) => {
  const fixture = await createFixture(t, { deferPairingCode: true });
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  assert.deepEqual(await fixture.runtime.requestPairing({ ...worker, pairingTarget }), {
    ok: true,
  });

  fixture.socket.events.emit('connection.update', { qr: sensitive.qr });
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED']);

  fixture.socket.events.emit('connection.update', { connection: 'open' });
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'OPEN']);

  fixture.socket.completePairingCode();
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'OPEN']);

  fixture.socket.events.emit('connection.update', { connection: 'close' });
  await flush();
  assert.deepEqual(pairingStates(fixture.diagnostics), ['REQUESTED', 'OPEN', 'CLOSED']);
  assert.deepEqual(await fixture.runtime.stopWorker(worker), { ok: true });
  await fixture.runtime.stop();
});

async function createFixture(
  t: test.TestContext,
  options: { readonly deferPairingCode?: boolean } = {},
) {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-03-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const socket = new FakeBaileysSocket(options.deferPairingCode);
  const reconnectScheduler = new ManualScheduler();
  const childMessages: unknown[] = [];
  const diagnostics: WorkerDiagnosticEvent[] = [];
  let childProcess: FakeWorkerChildProcess | undefined;

  const socketFactory: BaileysSocketFactoryPort = {
    create() {
      return Promise.resolve({
        socket,
        loggedOutStatusCode: 401,
        saveCredentials: () => Promise.resolve(),
      });
    },
  };
  const spawn: SpawnWorkerChildPort = () => {
    const process = new FakeWorkerChildProcess();
    childProcess = process;
    const child = createBaileysWorkerChild({
      credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
      socketFactory,
      scheduler: reconnectScheduler,
      reconnectDelayMs: 2_000,
      send(message) {
        childMessages.push(message);
        process.receive(message);
      },
    });
    process.attach(child);
    return process;
  };
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

  assert.ok(childProcess === undefined);
  return {
    runtime,
    socket,
    diagnostics,
    childMessages,
    reconnectScheduler,
    get childProcess(): FakeWorkerChildProcess {
      assert.ok(childProcess);
      return childProcess;
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
    return this.tasks.filter((task) => task.active).length;
  }
}

class FakeBaileysSocket implements BaileysSocketPort {
  readonly events = new EventEmitter();
  readonly pairingTargets: string[] = [];
  ended = 0;
  private completePairing: (() => void) | undefined;

  constructor(private readonly deferPairingCode = false) {}

  readonly ev = {
    on: (
      event: 'creds.update' | 'connection.update' | 'messages.upsert',
      listener: (update?: unknown) => void,
    ) => {
      this.events.on(event, listener);
    },
    removeAllListeners: () => {
      this.events.removeAllListeners();
    },
  };

  requestPairingCode(target: string): Promise<string> {
    this.pairingTargets.push(target);
    if (!this.deferPairingCode) return Promise.resolve(sensitive.code);
    return new Promise((resolve) => {
      this.completePairing = () => resolve(sensitive.code);
    });
  }

  completePairingCode(): void {
    assert.ok(this.completePairing);
    this.completePairing();
    this.completePairing = undefined;
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

  receive(message: unknown): void {
    this.events.emit('message', message);
  }
}

function pairingStates(events: readonly WorkerDiagnosticEvent[]): string[] {
  return events.flatMap((event) =>
    (event as WorkerDiagnosticEvent & { kind: string; state?: string }).kind === 'PAIRING'
      ? [(event as WorkerDiagnosticEvent & { state: string }).state]
      : [],
  );
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
