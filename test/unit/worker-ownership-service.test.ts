import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkerRuntimeError,
  type WorkerCommandResult,
} from '../../src/modules/whatsapp/application/worker-runtime-service';
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
  readonly startResults: Array<Deferred<WorkerCommandResult>> = [];
  readonly stopResults: Array<Deferred<WorkerCommandResult>> = [];

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
    return Promise.resolve({ ok: true });
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

void test('allocates monotonically increasing generations after terminal stop evidence', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands });

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
  const ownership = createWorkerOwnershipService({ commands });

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

  await assert.rejects(
    ownership.startWorker({ ...tenant, correlationId: 'corr_retry' }),
    (error: unknown) =>
      error instanceof WorkerRuntimeError && error.code === 'WORKER_OWNERSHIP_QUARANTINED',
  );
});

void test('quarantines any uncertain start failure until compensating stop evidence arrives', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands });

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
  const ownership = createWorkerOwnershipService({ commands });

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
  const ownership = createWorkerOwnershipService({ commands });

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
  const ownership = createWorkerOwnershipService({ commands });

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

void test('releases quarantined ownership only after terminal stop evidence', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands });

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
  const ownership = createWorkerOwnershipService({ commands });

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

void test('exact current-child exit is terminal evidence and respects desired stopped state', async () => {
  const commands = new ControlledCommands();
  const ownership = createWorkerOwnershipService({ commands });

  const start = ownership.startWorker(tenant);
  commands.startResults[0]!.resolve({ ok: true });
  await start;

  const stop = ownership.stopWorker({ tenantId: tenant.tenantId, correlationId: 'corr_stop' });
  ownership.recordChildExit(tenant.tenantId, 1, tenant.childId);

  assert.deepEqual(await stop, { ok: true });
  assert.equal(ownership.getState(tenant.tenantId).state, 'STOPPED');
  assert.equal(commands.starts.length, 1);
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
