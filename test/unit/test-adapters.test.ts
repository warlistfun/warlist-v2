import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FixedClock,
  InMemoryRepository,
  NoopLogger,
  NoopMetrics,
  SequenceIdGenerator,
  InMemoryWorkerRuntime,
} from '../support/test-adapters';

void test('test adapters provide deterministic in-memory dependencies', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const repository = new InMemoryRepository();
  const workerRuntime = new InMemoryWorkerRuntime();
  const ids = new SequenceIdGenerator('test');

  await repository.start();
  await workerRuntime.start();

  assert.equal(await repository.isReady(), true);
  assert.equal(await workerRuntime.isReady(), true);
  assert.equal(new FixedClock(now).now(), now);
  assert.equal(ids.generate(), 'test-1');
  assert.equal(ids.generate(), 'test-2');
  assert.doesNotThrow(() => {
    new NoopLogger().info('ignored');
    new NoopMetrics().increment('ignored');
  });

  await workerRuntime.stop();
  await repository.stop();

  assert.equal(await repository.isReady(), false);
  assert.equal(await workerRuntime.isReady(), false);
});
