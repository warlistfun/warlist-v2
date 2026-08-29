import assert from 'node:assert/strict';
import test from 'node:test';

import { createBootstrap } from '../../src/app/bootstrap';
import type { RepositoryPort, ShutdownSignalPort, WorkerRuntimePort } from '../../src/app/ports';
import { FixedClock, NoopLogger, NoopMetrics, SequenceIdGenerator } from '../support/test-adapters';

class InMemorySignals implements ShutdownSignalPort {
  private handlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
  failRegistrationFor?: 'SIGINT' | 'SIGTERM';
  failUnregistrationFor: 'SIGINT' | 'SIGTERM' | undefined;

  register(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void {
    if (signal === this.failRegistrationFor) throw new Error('signal registration failed');
    this.handlers.set(signal, handler);
  }

  unregister(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void {
    if (signal === this.failUnregistrationFor) throw new Error('signal unregistration failed');
    if (this.handlers.get(signal) === handler) this.handlers.delete(signal);
  }

  emit(signal: 'SIGINT' | 'SIGTERM'): void {
    this.handlers.get(signal)?.();
  }

  get size(): number {
    return this.handlers.size;
  }
}

class ControlledRuntime implements RepositoryPort, WorkerRuntimePort {
  startCalls = 0;
  stopCalls = 0;
  failStart?: Error;
  failStopCount = 0;

  start(): Promise<void> {
    this.startCalls += 1;
    return this.failStart ? Promise.reject(this.failStart) : Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.failStopCount > 0) {
      this.failStopCount -= 1;
      return Promise.reject(new Error('stop failed'));
    }
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.startCalls > this.stopCalls);
  }
}

function dependencies(
  repository: RepositoryPort,
  workerRuntime: WorkerRuntimePort,
  signals: ShutdownSignalPort,
) {
  return {
    config: { environment: 'test' as const, serviceName: 'warlist' },
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
    clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    idGenerator: new SequenceIdGenerator('req'),
    repository,
    workerRuntime,
    signals,
    createHttpServer: () => new ControlledRuntime(),
  };
}

void test('bootstrap constructs application and HTTP app without external resources', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await bootstrap.start();

  assert.equal(
    (await bootstrap.httpApp.handle({ method: 'GET', path: '/api/v1/ready' })).status,
    200,
  );
  assert.equal(signals.size, 2);

  await bootstrap.stop();
  assert.equal(signals.size, 0);
});

void test('a shutdown signal triggers one orderly stop', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await bootstrap.start();
  signals.emit('SIGTERM');
  signals.emit('SIGINT');
  await bootstrap.stop();

  assert.equal(repository.stopCalls, 1);
  assert.equal(workerRuntime.stopCalls, 1);
  assert.equal(signals.size, 0);
});

void test('failed application startup with failed rollback remains cleanable', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  repository.failStopCount = 1;
  workerRuntime.failStart = new Error('worker start failed');
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await assert.rejects(bootstrap.start(), /worker start failed/);
  await bootstrap.stop();

  assert.equal(repository.stopCalls, 2);
  assert.equal(signals.size, 0);
});

void test('start rejects while failed startup cleanup remains incomplete', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  repository.failStopCount = 2;
  workerRuntime.failStart = new Error('worker start failed');
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await assert.rejects(bootstrap.start(), /worker start failed/);
  await assert.rejects(bootstrap.start(), /Bootstrap cleanup is incomplete/);
  await bootstrap.stop();

  assert.equal(repository.startCalls, 1);
  assert.equal(repository.stopCalls, 3);
});

void test('partial signal registration failure unregisters handlers and stops the application', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  signals.failRegistrationFor = 'SIGTERM';
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await assert.rejects(bootstrap.start(), /signal registration failed/);

  assert.equal(signals.size, 0);
  assert.equal(repository.stopCalls, 1);
  assert.equal(workerRuntime.stopCalls, 1);
});

void test('failed shutdown remains retriable', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  workerRuntime.failStopCount = 1;
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await bootstrap.start();
  await assert.rejects(bootstrap.stop(), /Bootstrap shutdown failed/);
  await bootstrap.stop();

  assert.equal(workerRuntime.stopCalls, 2);
  assert.equal(repository.stopCalls, 1);
  assert.equal(signals.size, 0);
});

void test('signal unregistration failure does not prevent application cleanup', async () => {
  const repository = new ControlledRuntime();
  const workerRuntime = new ControlledRuntime();
  const signals = new InMemorySignals();
  const bootstrap = createBootstrap(dependencies(repository, workerRuntime, signals));

  await bootstrap.start();
  signals.failUnregistrationFor = 'SIGINT';
  await assert.rejects(bootstrap.stop(), /Bootstrap shutdown failed/);

  assert.equal(repository.stopCalls, 1);
  assert.equal(workerRuntime.stopCalls, 1);
  assert.equal(signals.size, 1);

  signals.failUnregistrationFor = undefined;
  await bootstrap.stop();
  assert.equal(signals.size, 0);
  assert.equal(repository.stopCalls, 1);
});
