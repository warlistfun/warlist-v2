import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChildMessage, ParentMessage } from '../../src/interfaces/worker-ipc/contract';
import {
  createWorkerDiagnosticsService,
  type WorkerDiagnosticEvent,
  type WorkerDiagnosticsService,
} from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import {
  WorkerRuntimeError,
  createWorkerRuntimeService,
  type CancelScheduledTask,
  type ScheduleTaskPort,
  type WorkerCommandTransportPort,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
import { SequenceIdGenerator } from '../support/test-adapters';

class ManualScheduler implements ScheduleTaskPort {
  private readonly tasks: Array<{ active: boolean; task: () => void }> = [];
  private scheduleError: Error | undefined;

  failNextSchedule(error: Error): void {
    this.scheduleError = error;
  }

  schedule(_delayMs: number, task: () => void): CancelScheduledTask {
    if (this.scheduleError) {
      const error = this.scheduleError;
      this.scheduleError = undefined;
      throw error;
    }
    const scheduled = { active: true, task };
    this.tasks.push(scheduled);
    return () => {
      scheduled.active = false;
    };
  }

  runNext(): void {
    const scheduled = this.tasks.find((candidate) => candidate.active);
    assert.ok(scheduled, 'expected a scheduled task');
    scheduled.active = false;
    scheduled.task();
  }
}

class ManualTransport implements WorkerCommandTransportPort {
  readonly sent: ParentMessage[] = [];
  private handler: ((message: unknown) => void) | undefined;
  private ready = false;
  private startError: Error | undefined;
  private stopError: Error | undefined;
  private hangingStart = false;
  private hangingStop = false;
  private resolveStart: (() => void) | undefined;
  private resolveStop: (() => void) | undefined;
  private hangingStartSignal: AbortSignal | undefined;
  private hangingStopSignal: AbortSignal | undefined;
  private hangingSend: Promise<void> | undefined;
  private sendError: Error | undefined;

  failNextStart(error: Error): void {
    this.startError = error;
  }

  failNextStop(error: Error): void {
    this.stopError = error;
  }

  hangNextStart(): void {
    this.hangingStart = true;
  }

  hangNextStop(): void {
    this.hangingStop = true;
  }

  completeHangingStart(): void {
    assert.ok(this.resolveStart, 'expected a hanging start');
    const resolve = this.resolveStart;
    this.resolveStart = undefined;
    if (!this.hangingStartSignal?.aborted) this.ready = true;
    this.hangingStartSignal = undefined;
    resolve();
  }

  completeHangingStop(): void {
    assert.ok(this.resolveStop, 'expected a hanging stop');
    const resolve = this.resolveStop;
    this.resolveStop = undefined;
    if (!this.hangingStopSignal?.aborted) {
      this.ready = false;
      this.handler = undefined;
    }
    this.hangingStopSignal = undefined;
    resolve();
  }

  hangNextSend(): void {
    this.hangingSend = new Promise<void>(() => undefined);
  }

  failNextSend(error: Error): void {
    this.sendError = error;
  }

  start(handler: (message: unknown) => void, signal?: AbortSignal): Promise<void> {
    this.ready = true;
    this.handler = handler;
    if (this.hangingStart) {
      this.hangingStart = false;
      this.hangingStartSignal = signal;
      return new Promise<void>((resolve) => {
        this.resolveStart = resolve;
      });
    }
    if (this.startError) {
      const error = this.startError;
      this.startError = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  stop(signal?: AbortSignal): Promise<void> {
    if (this.hangingStop) {
      this.hangingStop = false;
      this.hangingStopSignal = signal;
      return new Promise<void>((resolve) => {
        this.resolveStop = resolve;
      });
    }
    if (this.stopError) {
      const error = this.stopError;
      this.stopError = undefined;
      return Promise.reject(error);
    }
    this.ready = false;
    this.handler = undefined;
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }

  send(message: ParentMessage): Promise<void> {
    this.sent.push(message);
    if (this.sendError) {
      const error = this.sendError;
      this.sendError = undefined;
      return Promise.reject(error);
    }
    if (this.hangingSend) {
      const hanging = this.hangingSend;
      this.hangingSend = undefined;
      return hanging;
    }
    return Promise.resolve();
  }

  receive(message: ChildMessage): void {
    assert.ok(this.handler, 'transport must be started');
    this.handler(message);
  }
}

const worker = {
  tenantId: 'tenant_example_1',
  generation: 1,
  childId: 'child_example_1',
  correlationId: 'corr_example_1',
} as const;

function fixture(diagnosticsOverride?: WorkerDiagnosticsService) {
  const transport = new ManualTransport();
  const scheduler = new ManualScheduler();
  const diagnostics: WorkerDiagnosticEvent[] = [];
  const service = createWorkerRuntimeService({
    transport,
    scheduler,
    idGenerator: new SequenceIdGenerator('req'),
    commandTimeoutMs: 5_000,
    diagnostics:
      diagnosticsOverride ??
      createWorkerDiagnosticsService({
        sink: {
          record(event) {
            diagnostics.push(event);
          },
        },
      }),
  });
  return { service, transport, scheduler, diagnostics };
}

void test('does not let a diagnostic implementation block command settlement', async () => {
  let handled = false;
  let failure: Promise<void> | undefined;
  const { service, transport } = fixture({
    recordCommand() {
      failure = Promise.reject(new Error('diagnostics unavailable'));
      const originalCatch = failure.catch.bind(failure);
      failure.catch = ((onRejected) => {
        handled = true;
        return originalCatch(onRejected);
      }) as typeof failure.catch;
      return failure;
    },
    recordOwnership() {},
  });
  await service.start();

  const command = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  assert.doesNotThrow(() => {
    acknowledge(transport, transport.sent[0]!, {
      commandType: 'START_WORKER',
      configVersion: 1,
    });
  });
  const observed = handled;
  if (!handled) void failure?.catch(() => undefined);
  assert.equal(observed, true);
  assert.deepEqual(await command, { ok: true });
  await service.stop();
});

void test('emits one correlated diagnostic for a matching command acknowledgement', async () => {
  const { service, transport, diagnostics } = fixture();
  await service.start();

  const command = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 1 });

  assert.deepEqual(await command, { ok: true });
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'ACKNOWLEDGED',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
  await service.stop();
});

void test('runs start, config update, and stop commands through IPC v1 acknowledgements', async () => {
  const { service, transport, diagnostics } = fixture();
  await service.start();

  const started = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await started, { ok: true });

  const updated = service.applyConfig({ ...worker, configVersion: 2 });
  await flushCommands();
  acknowledge(transport, transport.sent[1]!, { commandType: 'APPLY_CONFIG', configVersion: 2 });
  assert.deepEqual(await updated, { ok: true });

  const stopped = service.stopWorker(worker);
  await flushCommands();
  acknowledge(transport, transport.sent[2]!, { commandType: 'STOP_WORKER' });
  assert.deepEqual(await stopped, { ok: true });

  assert.deepEqual(
    diagnostics.map((event) =>
      event.kind === 'COMMAND'
        ? [
            event.commandType,
            event.outcome,
            event.correlationId,
            event.tenantId,
            event.generation,
            event.childId,
          ]
        : event,
    ),
    [
      ['START_WORKER', 'ACKNOWLEDGED', 'corr_example_1', 'tenant_example_1', 1, 'child_example_1'],
      ['APPLY_CONFIG', 'ACKNOWLEDGED', 'corr_example_1', 'tenant_example_1', 1, 'child_example_1'],
      ['STOP_WORKER', 'ACKNOWLEDGED', 'corr_example_1', 'tenant_example_1', 1, 'child_example_1'],
    ],
  );
  await service.stop();
});

void test('runs explicit reset through one exact IPC acknowledgement', async () => {
  const { service, transport, diagnostics } = fixture();
  await service.start();

  const reset = service.resetWorker(worker);
  await flushCommands();
  assert.deepEqual(transport.sent, [
    {
      ...identity(transport.sent[0]!),
      type: 'RESET_WORKER',
      payload: {},
    },
  ]);
  const sent = transport.sent[0]!;
  acknowledge(
    transport,
    { ...sent, childId: 'child_example_stale' },
    { commandType: 'RESET_WORKER' },
  );
  await flushCommands();
  assert.equal(service.getDebugSnapshot().pendingCommands.length, 1);

  acknowledge(transport, sent, { commandType: 'RESET_WORKER' });
  assert.deepEqual(await reset, { ok: true });
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'ACKNOWLEDGED',
      commandType: 'RESET_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
  await service.stop();
});

void test('deduplicates identical pending commands and serializes commands for one tenant', async () => {
  const { service, transport } = fixture();
  await service.start();

  const first = service.startWorker({ ...worker, configVersion: 1 });
  const duplicate = service.startWorker({ ...worker, configVersion: 1 });
  const update = service.applyConfig({ ...worker, configVersion: 2 });

  assert.equal(first, duplicate);
  await flushCommands();
  assert.equal(transport.sent.length, 1);

  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await first, { ok: true });
  await flushCommands();
  assert.equal(transport.sent.length, 2);

  acknowledge(transport, transport.sent[1]!, { commandType: 'APPLY_CONFIG', configVersion: 2 });
  assert.deepEqual(await update, { ok: true });
  await service.stop();
});

void test('child invalidation prevents an already queued command from sending', async () => {
  const { service, transport } = fixture();
  await service.start();

  const active = service.startWorker({ ...worker, configVersion: 1 });
  const queued = service.applyConfig({ ...worker, configVersion: 2 });
  await flushCommands();
  assert.equal(transport.sent.length, 1);

  service.invalidateWorker(worker);
  await assert.rejects(
    active,
    (error: unknown) => error instanceof WorkerRuntimeError && error.code === 'WORKER_CHILD_EXITED',
  );
  await assert.rejects(
    queued,
    (error: unknown) => error instanceof WorkerRuntimeError && error.code === 'WORKER_CHILD_EXITED',
  );
  await flushCommands();
  assert.equal(transport.sent.length, 1);
  await service.stop();
});

void test('does not deduplicate distinct legal worker identities that contain delimiters', async () => {
  const { service, transport } = fixture();
  await service.start();

  const first = service.startWorker({
    tenantId: 'tenant-a',
    generation: 1,
    childId: 'child-a:START_WORKER:2:child-b',
    correlationId: 'corr-a',
    configVersion: 3,
  });
  const second = service.startWorker({
    tenantId: 'tenant-a:START_WORKER:1:child-a',
    generation: 2,
    childId: 'child-b',
    correlationId: 'corr-b',
    configVersion: 3,
  });

  assert.notEqual(first, second);
  await flushCommands();
  assert.equal(transport.sent.length, 2);
  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 3 });
  acknowledge(transport, transport.sent[1]!, { commandType: 'START_WORKER', configVersion: 3 });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
  await service.stop();
});

void test('does not deduplicate identical commands across different tenants', async () => {
  const { service, transport } = fixture();
  await service.start();

  const tenantOne = service.startWorker({ ...worker, configVersion: 1 });
  const tenantTwo = service.startWorker({
    ...worker,
    tenantId: 'tenant_example_2',
    correlationId: 'corr_example_2',
    configVersion: 1,
  });

  assert.notEqual(tenantOne, tenantTwo);
  await flushCommands();
  assert.equal(transport.sent.length, 2);
  const snapshot = service.getDebugSnapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.pendingCommands), true);
  assert.equal(Object.isFrozen(snapshot.pendingCommands[0]), true);
  assert.deepEqual(snapshot, {
    pendingCommands: [
      {
        commandType: 'START_WORKER',
        correlationId: worker.correlationId,
        tenantId: worker.tenantId,
        generation: worker.generation,
        childId: worker.childId,
      },
      {
        commandType: 'START_WORKER',
        correlationId: 'corr_example_2',
        tenantId: 'tenant_example_2',
        generation: worker.generation,
        childId: worker.childId,
      },
    ],
  });
  assert.equal(JSON.stringify(snapshot).includes('configVersion'), false);
  assert.equal(JSON.stringify(snapshot).includes('requestId'), false);

  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 1 });
  acknowledge(transport, transport.sent[1]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await tenantOne, { ok: true });
  assert.deepEqual(await tenantTwo, { ok: true });
  assert.deepEqual(service.getDebugSnapshot(), { pendingCommands: [] });
  await service.stop();
});

void test('ignores non-matching acknowledgements without stalling another tenant', async () => {
  const { service, transport, scheduler, diagnostics } = fixture();
  await service.start();

  const command = service.startWorker({ ...worker, configVersion: 1 });
  const otherWorker = {
    ...worker,
    tenantId: 'tenant_example_2',
    correlationId: 'corr_example_2',
  } as const;
  const otherCommand = service.startWorker({ ...otherWorker, configVersion: 1 });
  await flushCommands();
  const sent = transport.sent[0]!;
  acknowledge(
    transport,
    { ...sent, childId: 'child_wrong' },
    { commandType: 'START_WORKER', configVersion: 1 },
  );
  acknowledge(transport, transport.sent[1]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await otherCommand, { ok: true });
  scheduler.runNext();

  await assert.rejects(
    command,
    (error: unknown) =>
      error instanceof WorkerRuntimeError &&
      error.code === 'WORKER_COMMAND_TIMEOUT' &&
      error.retryable === true,
  );
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'ACKNOWLEDGED',
      commandType: 'START_WORKER',
      correlationId: otherWorker.correlationId,
      tenantId: otherWorker.tenantId,
      generation: otherWorker.generation,
      childId: otherWorker.childId,
    },
    {
      kind: 'COMMAND',
      outcome: 'TIMED_OUT',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
  await service.stop();
});

void test('ignores a timed-out command late acknowledgement while its retry is pending', async () => {
  const { service, transport, scheduler } = fixture();
  await service.start();

  const expired = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  const first = transport.sent[0]!;
  scheduler.runNext();
  await assert.rejects(
    expired,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_COMMAND_TIMEOUT',
  );

  const retry = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  const second = transport.sent[1]!;
  assert.notEqual(first.requestId, second.requestId);
  acknowledge(transport, first, { commandType: 'START_WORKER', configVersion: 1 });
  transport.receive({
    ...identity(first),
    type: 'COMMAND_ERROR',
    payload: {
      commandType: 'START_WORKER',
      error: {
        code: 'WA_RUNTIME_UNAVAILABLE',
        message: 'Worker runtime is unavailable',
        retryable: true,
      },
    },
  });
  await flushCommands();
  assert.deepEqual(service.getDebugSnapshot(), {
    pendingCommands: [
      {
        commandType: 'START_WORKER',
        correlationId: worker.correlationId,
        tenantId: worker.tenantId,
        generation: worker.generation,
        childId: worker.childId,
      },
    ],
  });

  acknowledge(transport, second, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await retry, { ok: true });
  await service.stop();
});

void test('maps matching child failures to canonical runtime errors', async () => {
  const { service, transport, diagnostics } = fixture();
  await service.start();

  const command = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  const sent = transport.sent[0]!;
  transport.receive({
    ...identity(sent),
    type: 'COMMAND_ERROR',
    payload: {
      commandType: 'START_WORKER',
      error: {
        code: 'WA_RUNTIME_UNAVAILABLE',
        message: 'Worker runtime is unavailable',
        retryable: true,
      },
    },
  });

  await assert.rejects(
    command,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WA_RUNTIME_UNAVAILABLE',
  );
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'REJECTED',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
  await service.stop();
});

void test('maps transport failure safely without stalling another tenant', async () => {
  const { service, transport, diagnostics } = fixture();
  transport.failNextSend(new Error('raw transport detail'));
  await service.start();

  const unavailable = service.startWorker({ ...worker, configVersion: 1 });
  const otherWorker = {
    ...worker,
    tenantId: 'tenant_example_2',
    correlationId: 'corr_example_2',
  } as const;
  const otherCommand = service.startWorker({ ...otherWorker, configVersion: 1 });
  await assert.rejects(
    unavailable,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WA_RUNTIME_UNAVAILABLE',
  );
  await flushCommands();
  acknowledge(transport, transport.sent[1]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await otherCommand, { ok: true });
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'UNAVAILABLE',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
    {
      kind: 'COMMAND',
      outcome: 'ACKNOWLEDGED',
      commandType: 'START_WORKER',
      correlationId: otherWorker.correlationId,
      tenantId: otherWorker.tenantId,
      generation: otherWorker.generation,
      childId: otherWorker.childId,
    },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes('raw transport detail'), false);
  await service.stop();
});

void test('maps synchronous runtime dependency failure to one safe unavailable diagnostic', async () => {
  const { service, scheduler, diagnostics } = fixture();
  await service.start();
  scheduler.failNextSchedule(new Error('raw scheduler detail'));

  await assert.rejects(
    service.startWorker({ ...worker, configVersion: 1 }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_INTERNAL_ERROR',
  );
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'UNAVAILABLE',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes('raw scheduler detail'), false);
  await service.stop();
});

void test('shutdown rejects pending commands and leaves the transport stopped', async () => {
  const { service, transport, diagnostics } = fixture();
  await service.start();
  const command = service.startWorker({ ...worker, configVersion: 1 });

  await service.stop();

  await assert.rejects(
    command,
    (error: unknown) => error instanceof WorkerRuntimeError && error.code === 'WA_RUNTIME_STOPPED',
  );
  assert.equal(await transport.isReady(), false);
  assert.equal(await service.isReady(), false);
  assert.deepEqual(diagnostics, [
    {
      kind: 'COMMAND',
      outcome: 'RUNTIME_STOPPED',
      commandType: 'START_WORKER',
      correlationId: worker.correlationId,
      tenantId: worker.tenantId,
      generation: worker.generation,
      childId: worker.childId,
    },
  ]);
});

void test('cleans a never-settling start without waiting and fences its late completion', async () => {
  const { service, transport, scheduler } = fixture();
  transport.hangNextStart();
  const start = service.start();
  await flushCommands();
  scheduler.runNext();
  await assert.rejects(start, /Worker runtime start timed out/);
  await assert.rejects(service.start(), /Worker runtime cleanup is incomplete/);

  await service.stop();
  transport.completeHangingStart();
  await flushCommands();
  assert.equal(await transport.isReady(), false);
  assert.equal(await service.isReady(), false);

  await service.start();
  assert.equal(await service.isReady(), true);
  await service.stop();
});

void test('retries a never-settling stop and fences its late completion after restart', async () => {
  const { service, transport, scheduler } = fixture();
  await service.start();
  transport.hangNextStop();
  const stop = service.stop();
  await flushCommands();
  scheduler.runNext();
  await assert.rejects(stop, /Worker runtime stop timed out/);
  assert.equal(await service.isReady(), false);
  await assert.rejects(service.start(), /Worker runtime cleanup is incomplete/);

  await service.stop();
  await service.start();
  assert.equal(await service.isReady(), true);
  transport.completeHangingStop();
  await flushCommands();
  assert.equal(await service.isReady(), true);
  await service.stop();
});

void test('failed transport start remains cleanable and blocks restart until cleaned', async () => {
  const { service, transport } = fixture();
  transport.failNextStart(new Error('transport failed after allocation'));

  await assert.rejects(service.start(), /transport failed after allocation/);
  assert.equal(await transport.isReady(), true);
  await assert.rejects(service.start(), /Worker runtime cleanup is incomplete/);

  await service.stop();
  assert.equal(await transport.isReady(), false);
  await service.start();
  assert.equal(await service.isReady(), true);
  await service.stop();
});

void test('failed transport shutdown remains retriable and blocks restart until cleaned', async () => {
  const { service, transport } = fixture();
  await service.start();
  transport.failNextStop(new Error('transport cleanup failed'));

  await assert.rejects(service.stop(), /transport cleanup failed/);
  await assert.rejects(service.start(), /Worker runtime cleanup is incomplete/);
  await service.stop();

  assert.equal(await transport.isReady(), false);
  await service.start();
  assert.equal(await service.isReady(), true);
  await service.stop();
});

void test('timeout releases the tenant queue even when transport send never settles', async () => {
  const { service, transport, scheduler } = fixture();
  await service.start();
  transport.hangNextSend();

  const first = service.startWorker({ ...worker, configVersion: 1 });
  const second = service.applyConfig({ ...worker, configVersion: 2 });
  await flushCommands();
  assert.equal(transport.sent.length, 1);

  scheduler.runNext();
  await assert.rejects(
    first,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_COMMAND_TIMEOUT',
  );
  await flushCommands();
  assert.equal(transport.sent.length, 2);

  acknowledge(transport, transport.sent[1]!, { commandType: 'APPLY_CONFIG', configVersion: 2 });
  assert.deepEqual(await second, { ok: true });
  await service.stop();
});

function acknowledge(
  transport: ManualTransport,
  sent: ParentMessage,
  payload:
    | { commandType: 'START_WORKER' | 'APPLY_CONFIG'; configVersion: number }
    | { commandType: 'STOP_WORKER' | 'RESET_WORKER' },
): void {
  transport.receive({ ...identity(sent), type: 'COMMAND_ACK', payload });
}

function identity(message: ParentMessage) {
  return {
    protocolVersion: message.protocolVersion,
    requestId: message.requestId,
    correlationId: message.correlationId,
    tenantId: message.tenantId,
    generation: message.generation,
    childId: message.childId,
  } as const;
}

async function flushCommands(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
