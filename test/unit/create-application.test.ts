import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplication } from '../../src/app/create-application';
import type { ApplicationLifecycle, RepositoryPort, WorkerRuntimePort } from '../../src/app/ports';
import {
  FixedClock,
  InMemoryRepository,
  InMemoryWorkerRuntime,
  NoopLogger,
  NoopMetrics,
  SequenceIdGenerator,
} from '../support/test-adapters';

interface ControlledLifecycle extends ApplicationLifecycle {
  readonly startCalls: number;
  readonly stopCalls: number;
  failNextStart(error: Error): void;
  failNextStop(error: Error): void;
  isReady(): Promise<boolean>;
}

function controlledLifecycle(name: string, events: string[]): ControlledLifecycle {
  let startCalls = 0;
  let stopCalls = 0;
  let startError: Error | undefined;
  let stopError: Error | undefined;

  return {
    get startCalls(): number {
      return startCalls;
    },
    get stopCalls(): number {
      return stopCalls;
    },
    failNextStart(error: Error): void {
      startError = error;
    },
    failNextStop(error: Error): void {
      stopError = error;
    },
    isReady(): Promise<boolean> {
      return Promise.resolve(startCalls > stopCalls);
    },
    start(): Promise<void> {
      startCalls += 1;
      events.push(`start:${name}`);
      if (startError) {
        const error = startError;
        startError = undefined;
        return Promise.reject(error);
      }
      return Promise.resolve();
    },
    stop(): Promise<void> {
      stopCalls += 1;
      events.push(`stop:${name}`);
      if (stopError) {
        const error = stopError;
        stopError = undefined;
        return Promise.reject(error);
      }
      return Promise.resolve();
    },
  };
}

function dependencies(repository: RepositoryPort, workerRuntime: WorkerRuntimePort) {
  return {
    config: { environment: 'test' as const, serviceName: 'warlist' },
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
    clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    idGenerator: new SequenceIdGenerator('test'),
    repository,
    workerRuntime,
  };
}

void test('application enforces repository-before-worker startup and reverse shutdown', async () => {
  const events: string[] = [];
  const repository = controlledLifecycle('repository', events);
  const workerRuntime = controlledLifecycle('worker-runtime', events);
  const application = createApplication(dependencies(repository, workerRuntime));

  await application.start();
  await application.stop();

  assert.deepEqual(events, [
    'start:repository',
    'start:worker-runtime',
    'stop:worker-runtime',
    'stop:repository',
  ]);
});

void test('startup failure rolls back every started dependency and preserves the startup error', async () => {
  const events: string[] = [];
  const startupError = new Error('worker-runtime failed');
  const repository = controlledLifecycle('repository', events);
  const workerRuntime = controlledLifecycle('worker-runtime', events);
  workerRuntime.failNextStart(startupError);
  repository.failNextStop(new Error('repository rollback failed'));
  const application = createApplication(dependencies(repository, workerRuntime));

  await assert.rejects(application.start(), (error: unknown) => error === startupError);
  await application.stop();

  assert.deepEqual(events, [
    'start:repository',
    'start:worker-runtime',
    'stop:worker-runtime',
    'stop:repository',
    'stop:repository',
  ]);
});

void test('startup failure cleans the dependency that partially allocated resources', async () => {
  const events: string[] = [];
  const repository = controlledLifecycle('repository', events);
  let workerActive = false;
  let workerStopCalls = 0;
  const workerRuntime: WorkerRuntimePort = {
    start(): Promise<void> {
      workerActive = true;
      return Promise.reject(new Error('worker failed after allocation'));
    },
    stop(): Promise<void> {
      workerStopCalls += 1;
      workerActive = false;
      return Promise.resolve();
    },
    isReady(): Promise<boolean> {
      return Promise.resolve(workerActive);
    },
  };
  const application = createApplication(dependencies(repository, workerRuntime));

  await assert.rejects(application.start(), /worker failed after allocation/);

  assert.equal(workerStopCalls, 1);
  assert.equal(workerActive, false);
});

void test('failed shutdown is retriable and cleanup continues in reverse order', async () => {
  const events: string[] = [];
  const repository = controlledLifecycle('repository', events);
  const workerRuntime = controlledLifecycle('worker-runtime', events);
  workerRuntime.failNextStop(new Error('worker stop failed'));
  const application = createApplication(dependencies(repository, workerRuntime));

  await application.start();
  await assert.rejects(application.stop(), /Application shutdown failed/);
  await application.stop();

  assert.deepEqual(events, [
    'start:repository',
    'start:worker-runtime',
    'stop:worker-runtime',
    'stop:repository',
    'stop:worker-runtime',
  ]);
});

void test('concurrent lifecycle requests are serialized and idempotent', async () => {
  const events: string[] = [];
  const repository = controlledLifecycle('repository', events);
  const workerRuntime = controlledLifecycle('worker-runtime', events);
  const application = createApplication(dependencies(repository, workerRuntime));

  await Promise.all([application.start(), application.start()]);
  await Promise.all([application.stop(), application.stop()]);

  assert.equal(repository.startCalls, 1);
  assert.equal(workerRuntime.startCalls, 1);
  assert.equal(repository.stopCalls, 1);
  assert.equal(workerRuntime.stopCalls, 1);
});

void test('application constructs with deterministic resource-free adapters', async () => {
  const application = createApplication(
    dependencies(new InMemoryRepository(), new InMemoryWorkerRuntime()),
  );

  await application.start();
  await application.stop();
});
