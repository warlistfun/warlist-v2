import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkerRuntimeError,
  type WorkerCommandResult,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
import {
  createWorkerDiagnosticsService,
  type WorkerDiagnosticEvent,
} from '../../src/modules/whatsapp/application/worker-diagnostics-service';
import {
  createWorkerOwnershipService,
  type WorkerCommandPort,
} from '../../src/modules/whatsapp/application/worker-ownership-service';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

class ControlledCommands implements WorkerCommandPort {
  readonly starts: Array<WorkerInput & { configVersion: number }> = [];
  readonly stops: WorkerInput[] = [];
  readonly updates: Array<WorkerInput & { configVersion: number }> = [];
  private updateError: Error | undefined;
  readonly startResults: Array<Deferred<WorkerCommandResult>> = [];
  readonly stopResults: Array<Deferred<WorkerCommandResult>> = [];

  invalidateWorker(): void {}

  failNextUpdate(error: Error): void {
    this.updateError = error;
  }

  startWorker(input: WorkerInput & { configVersion: number }): Promise<WorkerCommandResult> {
    this.starts.push(input);
    const result = deferred<WorkerCommandResult>();
    this.startResults.push(result);
    return result.promise;
  }

  stopWorker(input: WorkerInput): Promise<WorkerCommandResult> {
    this.stops.push(input);
    const result = deferred<WorkerCommandResult>();
    this.stopResults.push(result);
    return result.promise;
  }

  applyConfig(input: WorkerInput & { configVersion: number }): Promise<WorkerCommandResult> {
    this.updates.push(input);
    if (!this.updateError) return Promise.resolve({ ok: true });
    const error = this.updateError;
    this.updateError = undefined;
    return Promise.reject(error);
  }
}

type WorkerInput = {
  tenantId: string;
  generation: number;
  childId: string;
  correlationId: string;
};

const tenant = {
  tenantId: 'tenant_example_1',
  childId: 'child_example_1',
  correlationId: 'corr_example_1',
  configVersion: 1,
} as const;

const noopDiagnostics = createWorkerDiagnosticsService({ sink: { record() {} } });

void test('does not let a diagnostic implementation block ownership transitions', async () => {
  const commands = new ControlledCommands();
  let handled = false;
  let failure: Promise<void> | undefined;
  const ownership = createWorkerOwnershipService({
    commands,
    diagnostics: {
      recordCommand() {},
      recordOwnership() {
        failure = Promise.reject(new Error('diagnostics unavailable'));
        const originalCatch = failure.catch.bind(failure);
        failure.catch = ((onRejected) => {
          handled = true;
          return originalCatch(onRejected);
        }) as typeof failure.catch;
        return failure;
      },
    },
  });

  const start = ownership.startWorker(tenant);
  const observed = handled;
  if (!handled) void failure?.catch(() => undefined);
  assert.equal(observed, true);
  assert.equal(commands.starts.length, 1);
  commands.startResults[0]!.resolve({ ok: true });
  assert.deepEqual(await start, { ok: true });

  const stop = ownership.stopWorker({
    tenantId: tenant.tenantId,
    correlationId: 'corr_stop',
  });
  assert.equal(commands.stops.length, 1);
  commands.stopResults[0]!.resolve({ ok: true });
  assert.deepEqual(await stop, { ok: true });
});

void test('emits correlated ownership transitions for a successful start', async () => {
  const commands = new ControlledCommands();
  const diagnostics: WorkerDiagnosticEvent[] = [];
  const ownership = createWorkerOwnershipService({
    commands,
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  });

  const start = ownership.startWorker(tenant);
  assert.deepEqual(diagnostics, [ownershipEvent('STARTING', false, tenant.correlationId)]);

  commands.startResults[0]!.resolve({ ok: true });
  assert.deepEqual(await start, { ok: true });
  assert.deepEqual(diagnostics, [
    ownershipEvent('STARTING', false, tenant.correlationId),
    ownershipEvent('RUNNING', false, tenant.correlationId),
  ]);

  const stop = ownership.stopWorker({
    tenantId: tenant.tenantId,
    correlationId: 'corr_stop',
  });
  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPING', false, 'corr_stop'));

  commands.stopResults[0]!.resolve({ ok: true });
  assert.deepEqual(await stop, { ok: true });
  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPED', false, 'corr_stop'));
});

void test('allocates monotonically increasing generations after terminal stop evidence', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const firstStart = ownership.startWorker(tenant);
  assert.equal(commands.starts[0]?.generation, 1);
  commands.startResults[0]!.resolve({ ok: true });
  assert.deepEqual(await firstStart, { ok: true });

  const stop = ownership.stopWorker({
    tenantId: tenant.tenantId,
    correlationId: 'corr_example_2',
  });
  commands.stopResults[0]!.resolve({ ok: true });
  assert.deepEqual(await stop, { ok: true });

  const secondStart = ownership.startWorker({
    ...tenant,
    childId: 'child_example_2',
    correlationId: 'corr_example_3',
  });
  assert.equal(commands.starts[1]?.generation, 2);
  commands.startResults[1]!.resolve({ ok: true });
  assert.deepEqual(await secondStart, { ok: true });
});

void test('quarantines a timed-out start and sends a compensating stop', async () => {
  const commands = new ControlledCommands();
  const diagnostics: WorkerDiagnosticEvent[] = [];
  const ownership = createWorkerOwnershipService({
    commands,
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.reject(
    new WorkerRuntimeError('WORKER_COMMAND_TIMEOUT', 'Worker command timed out', true),
  );

  await assert.rejects(
    start,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_COMMAND_TIMEOUT',
  );
  assert.equal(commands.stops.length, 1);
  assert.deepEqual(ownership.getState(tenant.tenantId), {
    state: 'STOPPING',
    desired: 'STOPPED',
    generation: 1,
    childId: tenant.childId,
    quarantined: true,
  });
  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPING', true, tenant.correlationId));

  await assert.rejects(
    ownership.startWorker({ ...tenant, correlationId: 'corr_retry' }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_OWNERSHIP_QUARANTINED',
  );

  commands.stopResults[0]!.resolve({ ok: true });
  await flush();
  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPED', false, tenant.correlationId));
});

void test('quarantines any uncertain start failure until compensating stop evidence arrives', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.reject(
    new WorkerRuntimeError('WA_RUNTIME_UNAVAILABLE', 'Worker runtime is unavailable', true),
  );

  await assert.rejects(
    start,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WA_RUNTIME_UNAVAILABLE',
  );
  assert.deepEqual(commands.stops, [
    {
      tenantId: tenant.tenantId,
      generation: 1,
      childId: tenant.childId,
      correlationId: tenant.correlationId,
    },
  ]);
  assert.deepEqual(ownership.getState(tenant.tenantId), {
    state: 'STOPPING',
    desired: 'STOPPED',
    generation: 1,
    childId: tenant.childId,
    quarantined: true,
  });
});

void test('does not duplicate a stop already pending when start later fails', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  const stop = ownership.stopWorker({ tenantId: tenant.tenantId, correlationId: 'corr_stop' });
  assert.equal(commands.stops.length, 1);

  commands.startResults[0]!.reject(
    new WorkerRuntimeError('WORKER_COMMAND_TIMEOUT', 'Worker command timed out', true),
  );
  await assert.rejects(start);
  assert.equal(commands.stops.length, 1);

  commands.stopResults[0]!.resolve({ ok: true });
  assert.deepEqual(await stop, { ok: true });
  assert.equal(ownership.getState(tenant.tenantId).state, 'STOPPED');
});

void test('rejects a start acknowledgement after its exact child already exited', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);
  commands.startResults[0]!.resolve({ ok: true });

  await assert.rejects(
    start,
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_OWNERSHIP_QUARANTINED',
  );
  assert.equal(ownership.getState(tenant.tenantId).state, 'STOPPED');
});

void test('allows retrying a rejected compensating stop while preserving quarantine', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.reject(
    new WorkerRuntimeError('WORKER_COMMAND_TIMEOUT', 'Worker command timed out', true),
  );
  await assert.rejects(start);

  commands.stopResults[0]!.reject(new Error('stop unavailable'));
  await flush();

  const retry = ownership.stopWorker({
    tenantId: tenant.tenantId,
    correlationId: 'corr_retry_stop',
  });
  assert.equal(commands.stops.length, 2);
  commands.stopResults[1]!.resolve({ ok: true });
  assert.deepEqual(await retry, { ok: true });
  assert.equal(ownership.getState(tenant.tenantId).state, 'STOPPED');
});

void test('emits quarantine when an explicit stop is rejected', async () => {
  const commands = new ControlledCommands();
  const diagnostics: WorkerDiagnosticEvent[] = [];
  const ownership = createWorkerOwnershipService({
    commands,
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await start;

  const stop = ownership.stopWorker({
    tenantId: tenant.tenantId,
    correlationId: 'corr_stop',
  });
  commands.stopResults[0]!.reject(new Error('raw stop detail'));
  await assert.rejects(stop, /raw stop detail/);

  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPING', true, 'corr_stop'));
  assert.equal(JSON.stringify(diagnostics).includes('raw stop detail'), false);
});

void test('releases quarantined ownership only after terminal stop evidence', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.reject(
    new WorkerRuntimeError('WORKER_COMMAND_TIMEOUT', 'Worker command timed out', true),
  );
  await assert.rejects(start);

  commands.stopResults[0]!.resolve({ ok: true });
  await flush();

  assert.deepEqual(ownership.getState(tenant.tenantId), {
    state: 'STOPPED',
    desired: 'STOPPED',
    generation: 1,
    childId: null,
    quarantined: false,
  });
});

void test('does not let stale generation completion claim newer ownership', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const first = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await first;

  const stop = ownership.stopWorker({ tenantId: tenant.tenantId, correlationId: 'corr_stop' });
  commands.stopResults[0]!.resolve({ ok: true });
  await stop;

  const second = ownership.startWorker({
    ...tenant,
    childId: 'child_example_2',
    correlationId: 'corr_second',
  });
  assert.equal(commands.starts[1]?.generation, 2);

  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);
  assert.equal(ownership.getState(tenant.tenantId).generation, 2);
  assert.equal(ownership.getState(tenant.tenantId).state, 'STARTING');

  commands.startResults[1]!.resolve({ ok: true });
  await second;
  assert.equal(ownership.getState(tenant.tenantId).state, 'RUNNING');
});

void test('ignores prior-incarnation terminal evidence while a restarted owner is pending', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const first = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await first;
  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);

  const restarted = ownership.startWorker({
    ...tenant,
    childId: 'child_example_2',
    correlationId: 'corr_restart',
  });
  assert.deepEqual(commands.starts[1], {
    tenantId: tenant.tenantId,
    generation: 2,
    childId: 'child_example_2',
    correlationId: 'corr_restart',
    configVersion: 1,
  });
  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);
  assert.deepEqual(ownership.getState(tenant.tenantId), {
    state: 'STARTING',
    desired: 'RUNNING',
    generation: 2,
    childId: 'child_example_2',
    quarantined: false,
  });

  commands.startResults[1]!.resolve({ ok: true });
  assert.deepEqual(await restarted, { ok: true });
  assert.equal(ownership.getState(tenant.tenantId).state, 'RUNNING');
});

void test('forwards a running tenant update with its fenced owner identity', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await start;

  assert.deepEqual(
    await ownership.applyConfig({
      tenantId: tenant.tenantId,
      correlationId: 'corr_update',
      configVersion: 2,
    }),
    { ok: true },
  );
  assert.deepEqual(commands.updates, [
    {
      tenantId: tenant.tenantId,
      generation: 1,
      childId: tenant.childId,
      correlationId: 'corr_update',
      configVersion: 2,
    },
  ]);
  assert.deepEqual(ownership.getState(tenant.tenantId), {
    state: 'RUNNING',
    desired: 'RUNNING',
    generation: 1,
    childId: tenant.childId,
    quarantined: false,
  });
});

void test('preserves running ownership when an update is rejected', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await start;
  commands.failNextUpdate(new Error('update unavailable'));

  await assert.rejects(
    ownership.applyConfig({
      tenantId: tenant.tenantId,
      correlationId: 'corr_update',
      configVersion: 2,
    }),
    /update unavailable/,
  );
  assert.equal(ownership.getState(tenant.tenantId).state, 'RUNNING');
  assert.equal(ownership.getState(tenant.tenantId).quarantined, false);
});

void test('rejects update before command dispatch unless ownership is running', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands, diagnostics: noopDiagnostics });

  await assert.rejects(
    ownership.applyConfig({
      tenantId: tenant.tenantId,
      correlationId: 'corr_update',
      configVersion: 2,
    }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_OWNERSHIP_QUARANTINED',
  );
  assert.deepEqual(commands.updates, []);
});

void test('exact current-child exit is terminal evidence and respects desired stopped state', async () => {
  const commands = new ControlledCommands();
  const diagnostics: WorkerDiagnosticEvent[] = [];
  const ownership = createWorkerOwnershipService({
    commands,
    diagnostics: createWorkerDiagnosticsService({
      sink: {
        record(event) {
          diagnostics.push(event);
        },
      },
    }),
  });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await start;

  const stop = ownership.stopWorker({ tenantId: tenant.tenantId, correlationId: 'corr_stop' });
  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);

  assert.deepEqual(await stop, { ok: true });
  assert.equal(ownership.getState(tenant.tenantId).state, 'STOPPED');
  assert.equal(commands.starts.length, 1);
  assert.deepEqual(diagnostics.at(-1), ownershipEvent('STOPPED', false, 'corr_stop'));
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function ownershipEvent(
  state: 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED',
  quarantined: boolean,
  correlationId: string,
): WorkerDiagnosticEvent {
  return {
    kind: 'OWNERSHIP',
    state,
    quarantined,
    correlationId,
    tenantId: tenant.tenantId,
    generation: 1,
    childId: tenant.childId,
  };
}
