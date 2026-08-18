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
  private stopError: Error | undefined;
  private hangingSend: Promise<void> | undefined;
  private sendError: Error | undefined;

  failNextStop(error: Error): void {
    this.stopError = error;
  }

  hangNextSend(): void {
    this.hangingSend = new Promise<void>(() => undefined);
  }

  failNextSend(error: Error): void {
    this.sendError = error;
  }

  start(handler: (message: unknown) => void): Promise<void> {
    this.ready = true;
    this.handler = handler;
    return Promise.resolve();
  }

  stop(): Promise<void> {
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
  const { service, transport } = fixture();
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
  acknowledge(transport, transport.sent[0]!, { commandType: 'START_WORKER', configVersion: 1 });
  acknowledge(transport, transport.sent[1]!, { commandType: 'START_WORKER', configVersion: 1 });
  assert.deepEqual(await tenantOne, { ok: true });
  assert.deepEqual(await tenantTwo, { ok: true });
  await service.stop();
});

void test('ignores non-matching acknowledgements and fails closed on timeout', async () => {
  const { service, transport, scheduler, diagnostics } = fixture();
  await service.start();

  const command = service.startWorker({ ...worker, configVersion: 1 });
  await flushCommands();
  const sent = transport.sent[0]!;
  acknowledge(
    transport,
    { ...sent, childId: 'child_wrong' },
    { commandType: 'START_WORKER', configVersion: 1 },
  );
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

void test('maps transport send failure to one safe unavailable diagnostic', async () => {
  const { service, transport, diagnostics } = fixture();
  transport.failNextSend(new Error('raw transport detail'));
  await service.start();

  await assert.rejects(
    service.startWorker({ ...worker, configVersion: 1 }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WA_RUNTIME_UNAVAILABLE',
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
  assert.equal(JSON.stringify(diagnostics).includes('raw transport detail'), false);
  await service.stop();
});

void test('maps synchronous runtime dependency failure to one safe unavailable diagnostic', async () => {
  const { service, scheduler, diagnostics } = fixture();
  scheduler.failNextSchedule(new Error('raw scheduler detail'));
  await service.start();

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
    | { commandType: 'STOP_WORKER' },
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
