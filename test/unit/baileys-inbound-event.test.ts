import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ChildMessage, ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import { evaluateAutomation } from '../../src/modules/automation/application/automation-evaluator';
import { normalizeSyntheticInboundMessage } from '../../src/modules/automation/application/inbound-message-normalizer';
import {
  createWorkerDiagnosticsService,
  type WorkerDiagnosticEvent,
} from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import {
  createWorkerRuntimeService,
  type ScheduleTaskPort,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
import {
  createBaileysWorkerChild,
  type BaileysSocketFactoryPort,
} from '../../src/modules/whatsapp/infrastructure/baileys-worker-child';
import { createLocalWhatsAppCredentialDirectory } from '../../src/modules/whatsapp/infrastructure/local-whatsapp-credential-directory';
import {
  createNodeWorkerCommandTransport,
  type SpawnWorkerChildPort,
  type WorkerChildProcessPort,
} from '../../src/modules/whatsapp/infrastructure/node-worker-command-transport';
import { SequenceIdGenerator } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000136';
const worker = {
  tenantId,
  generation: 1,
  childId: 'child_example_136',
  correlationId: 'corr_example_136',
  configVersion: 1,
} as const;
const now = 1_800_000_000_000;

void test('projects one live inbound message through IPC into the existing evaluator', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });

  fixture.socket.events.emit('connection.update', { connection: 'open' });
  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [
      {
        key: {
          id: 'message_example_one',
          remoteJid: 'group_example_one@g.us',
          participant: 'admin_example_one:3@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: now / 1_000,
        message: { conversation: ' list today ' },
        rawProviderMarker: 'raw-provider-payload-must-not-cross-ipc',
      },
    ],
  });
  await flush();

  assert.equal(fixture.inbound.length, 1);
  const inbound = fixture.inbound[0]!;
  assert.match(inbound.messageId, /^message:[a-f0-9]{64}$/);
  assert.match(inbound.message.groupId, /^group:[a-f0-9]{64}$/);
  assert.match(inbound.message.senderId, /^sender:[a-f0-9]{64}$/);
  assert.equal(inbound.message.text, 'list today');
  assert.deepEqual(inbound.decision, { code: 'ACCEPTED' });
  assert.deepEqual(fixture.diagnostics.at(-1), {
    kind: 'INBOUND',
    transportCode: 'FORWARDED',
    decisionCode: 'ACCEPTED',
    messageId: inbound.messageId,
    correlationId: worker.correlationId,
    tenantId,
    generation: worker.generation,
    childId: worker.childId,
  });

  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [messageFixture({ id: 'message_example_two', message: { conversation: 'nothing' } })],
  });
  await flush();
  assert.equal(fixture.inbound.length, 2);
  assert.deepEqual(fixture.inbound[1]?.decision, { code: 'KEYWORD_NOT_MATCHED' });
  const rejected = fixture.diagnostics.at(-1);
  assert.equal(
    rejected?.kind === 'INBOUND' ? rejected.decisionCode : undefined,
    'KEYWORD_NOT_MATCHED',
  );

  const boundary = JSON.stringify({ ipc: fixture.ipcMessages, diagnostics: fixture.diagnostics });
  for (const raw of [
    'group_example_one@g.us',
    'admin_example_one:3@s.whatsapp.net',
    'message_example_one',
    'raw-provider-payload-must-not-cross-ipc',
  ]) {
    assert.equal(boundary.includes(raw), false);
  }

  await fixture.runtime.stop();
});

void test('accepts official LID and Long-shaped participant/timestamp forms without raw identifiers', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  fixture.socket.events.emit('connection.update', { connection: 'open' });

  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [
      messageFixture({
        id: 'message_example_lid',
        participant: 'admin_example_lid@lid',
      }),
    ],
  });
  const longTimestampEvent = {
    type: 'notify',
    messages: [
      {
        ...messageFixture({ id: 'message_example_long' }),
        messageTimestamp: { low: 1_800_000_000, high: 0, unsigned: false },
      },
    ],
  };
  fixture.socket.events.emit('messages.upsert', longTimestampEvent);
  await flush();

  assert.equal(fixture.inbound.length, 2);
  assert.match(fixture.inbound[0]!.message.senderId, /^sender:[a-f0-9]{64}$/);
  assert.match(fixture.inbound[1]!.messageId, /^message:[a-f0-9]{64}$/);
  const boundary = JSON.stringify(fixture.ipcMessages);
  assert.equal(boundary.includes('admin_example_lid@lid'), false);
  assert.equal(boundary.includes('message_example_long'), false);
  await fixture.runtime.stop();
});

void test('does not let blank conversation bypass a quoted extended-text guard', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  fixture.socket.events.emit('connection.update', { connection: 'open' });

  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [
      messageFixture({
        id: 'quoted_fallback_example_one',
        message: {
          conversation: ' ',
          extendedTextMessage: {
            text: 'list today',
            contextInfo: { quotedMessage: { conversation: 'quoted' } },
          },
        },
      }),
    ],
  });
  await flush();

  assert.equal(fixture.inbound.length, 0);
  const diagnostic = fixture.diagnostics.at(-1);
  assert.equal(diagnostic?.kind, 'INBOUND');
  if (diagnostic?.kind !== 'INBOUND') throw new Error('missing inbound diagnostic');
  assert.equal(diagnostic.transportCode, 'QUOTED');
  await fixture.runtime.stop();
});

void test('rejects every characterized transport guard before automation evaluation', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });

  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [messageFixture({ id: 'preconnect_example_one' })],
  });
  await flush();
  const preConnect = fixture.diagnostics.at(-1);
  assert.equal(
    preConnect?.kind === 'INBOUND' ? preConnect.transportCode : undefined,
    'PRE_CONNECT',
  );
  fixture.socket.events.emit('connection.update', { connection: 'open' });

  const cases: Array<Readonly<{ code: string; event: unknown }>> = [
    {
      code: 'HISTORY_REPLAY',
      event: { type: 'append', messages: [messageFixture({ id: 'append_example_one' })] },
    },
    {
      code: 'HISTORY_REPLAY',
      event: {
        type: 'notify',
        requestId: 'request_example_one',
        messages: [messageFixture({ id: 'request_example_one' })],
      },
    },
    {
      code: 'FROM_ME',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'fromme_example_one', fromMe: true })],
      },
    },
    {
      code: 'STALE',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'stale_example_one', timestamp: now - 121_000 })],
      },
    },
    {
      code: 'QUOTED',
      event: {
        type: 'notify',
        messages: [
          messageFixture({
            id: 'quoted_example_one',
            message: {
              extendedTextMessage: {
                text: 'list today',
                contextInfo: { quotedMessage: { conversation: 'quoted' } },
              },
            },
          }),
        ],
      },
    },
    {
      code: 'NO_TEXT',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'notext_example_one', message: { imageMessage: {} } })],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'identity_example_one', remoteJid: 'not-a-group' })],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'identity_example_empty_group', remoteJid: '@g.us' })],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: {
        type: 'notify',
        messages: [messageFixture({ id: 'identity_example_empty_lid', participant: '@lid' })],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: {
        type: 'notify',
        messages: [
          messageFixture({
            id: 'identity_example_nested_jid',
            remoteJid: 'group_example@s.whatsapp.net@g.us',
          }),
        ],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: {
        type: 'notify',
        messages: [
          messageFixture({ id: 'identity_example_whitespace', remoteJid: 'group bad@g.us' }),
        ],
      },
    },
    {
      code: 'INVALID_MESSAGE',
      event: { type: 'notify', messages: [{ message: { conversation: 'list today' } }] },
    },
  ];

  for (const [index, candidate] of cases.entries()) {
    const before = fixture.diagnostics.length;
    fixture.socket.events.emit('messages.upsert', candidate.event);
    await flush();
    assert.equal(fixture.diagnostics.length, before + 1, `guard ${index} emitted once`);
    const event = fixture.diagnostics.at(-1);
    assert.equal(event?.kind, 'INBOUND');
    if (event?.kind !== 'INBOUND') throw new Error(`missing diagnostic for guard ${index}`);
    assert.equal(event.transportCode, candidate.code);
    assert.equal(fixture.inbound.length, 0);
  }

  await fixture.runtime.stop();
});

void test('does not record an async decision after runtime stop', async (t) => {
  let resolveDecision!: (value: Readonly<{ code: 'ACCEPTED' }>) => void;
  const decision = new Promise<Readonly<{ code: 'ACCEPTED' }>>((resolve) => {
    resolveDecision = resolve;
  });
  const fixture = await createFixture(t, () => decision);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  fixture.socket.events.emit('connection.update', { connection: 'open' });
  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [messageFixture({ id: 'message_example_pending' })],
  });
  await flush();
  const before = fixture.diagnostics.length;

  await fixture.runtime.stop();
  await fixture.runtime.start();
  resolveDecision({ code: 'ACCEPTED' });
  await flush();

  assert.equal(fixture.diagnostics.length, before);
  await fixture.runtime.stop();
});

void test('fences forged inbound identity and late post-stop events', async (t) => {
  const fixture = await createFixture(t);
  await fixture.runtime.start();
  assert.deepEqual(await fixture.runtime.startWorker(worker), { ok: true });
  fixture.socket.events.emit('connection.update', { connection: 'open' });
  await flush();

  const source = fixture.ipcMessages.find((message) => message.type === 'CONNECTION_UPDATE');
  assert.ok(source);
  const forwarded = {
    ...source,
    type: 'INBOUND_EVENT',
    payload: {
      transportCode: 'FORWARDED',
      messageId: `message:${'a'.repeat(64)}`,
      message: {
        groupId: `group:${'b'.repeat(64)}`,
        senderId: `sender:${'c'.repeat(64)}`,
        text: 'list today',
      },
    },
  } as const;
  const before = fixture.diagnostics.length;
  for (const forged of [
    { ...forwarded, requestId: 'request_example_forged' },
    { ...forwarded, correlationId: 'corr_example_forged' },
    { ...forwarded, tenantId: '00000000-0000-4000-8000-000000000999' },
    { ...forwarded, generation: worker.generation + 1 },
    { ...forwarded, childId: 'child_example_forged' },
  ] satisfies ChildMessage[]) {
    fixture.childProcess.receive(forged);
  }
  await flush();
  assert.equal(fixture.diagnostics.length, before);
  assert.equal(fixture.inbound.length, 0);

  await fixture.runtime.stop();
  fixture.socket.events.emit('messages.upsert', {
    type: 'notify',
    messages: [messageFixture({ id: 'late_example_one' })],
  });
  await flush();
  assert.equal(fixture.diagnostics.length, before);
  assert.equal(fixture.inbound.length, 0);
});

function messageFixture(
  input: Readonly<{
    id?: string;
    fromMe?: boolean;
    remoteJid?: string;
    participant?: string;
    timestamp?: number;
    message?: unknown;
  }> = {},
): Record<string, unknown> {
  return {
    key: {
      id: input.id ?? 'message_example_default',
      remoteJid: input.remoteJid ?? 'group_example_one@g.us',
      participant: input.participant ?? 'admin_example_one@s.whatsapp.net',
      fromMe: input.fromMe ?? false,
    },
    messageTimestamp: input.timestamp === undefined ? now / 1_000 : input.timestamp / 1_000,
    message: input.message ?? { conversation: 'list today' },
  };
}

async function createFixture(
  t: test.TestContext,
  decideOverride?: () => PromiseLike<Readonly<{ code: 'ACCEPTED' }>>,
) {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-02-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const credentialRoot = join(sandbox, 'credentials');
  const socket = new FakeBaileysSocket();
  const ipcMessages: ChildMessage[] = [];
  const inbound: Array<{
    messageId: string;
    message: { groupId: string; senderId: string; text: string };
    decision: { code: string };
  }> = [];
  const diagnostics: WorkerDiagnosticEvent[] = [];
  let childProcess: FakeWorkerChildProcess | undefined;

  const spawn: SpawnWorkerChildPort = () => {
    const process = new FakeWorkerChildProcess();
    childProcess = process;
    const socketFactory: BaileysSocketFactoryPort = {
      create: () =>
        Promise.resolve({
          socket,
          loggedOutStatusCode: 401,
          saveCredentials: () => Promise.resolve(),
        }),
    };
    const child = createBaileysWorkerChild({
      credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
      socketFactory,
      scheduler: new NoopScheduler(),
      reconnectDelayMs: 2_000,
      now: () => now,
      send(message) {
        ipcMessages.push(message);
        process.receive(message);
      },
    });
    process.attach(child);
    return process;
  };

  const runtime = createWorkerRuntimeService({
    transport: createNodeWorkerCommandTransport({
      modulePath: join(sandbox, 'baileys-worker-child.js'),
      credentialRoot,
      spawn,
    }),
    scheduler: new NoopScheduler(),
    idGenerator: new SequenceIdGenerator('req'),
    commandTimeoutMs: 5_000,
    inbound: {
      decide(input: {
        messageId: string;
        message: unknown;
      }): PromiseLike<Readonly<{ code: string }>> {
        if (decideOverride) return decideOverride();
        const message = normalizeSyntheticInboundMessage(input.message);
        const decision = evaluateAutomation(message, {
          enabled: true,
          targetGroupId: message.groupId,
          adminIds: [message.senderId],
          keyword: 'list',
        });
        inbound.push({ messageId: input.messageId, message, decision });
        return Promise.resolve(decision);
      },
    },
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  } as Parameters<typeof createWorkerRuntimeService>[0]);

  return {
    runtime,
    socket,
    inbound,
    diagnostics,
    ipcMessages,
    get childProcess() {
      assert.ok(childProcess);
      return childProcess;
    },
  };
}

class NoopScheduler implements ScheduleTaskPort {
  schedule(): () => void {
    return () => undefined;
  }
}

class FakeBaileysSocket {
  readonly events = new EventEmitter();
  readonly ev = {
    on: (event: string, listener: (...arguments_: unknown[]) => void) => {
      this.events.on(event, listener);
    },
    removeAllListeners: () => {
      this.events.removeAllListeners();
    },
  };

  requestPairingCode(): Promise<string> {
    return Promise.resolve('unused');
  }

  end(): void {}
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
    void this.child.stop().then(() => this.events.emit('exit', 0, null));
  }

  kill(): boolean {
    this.disconnect();
    return true;
  }

  receive(message: unknown): void {
    this.events.emit('message', message);
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
