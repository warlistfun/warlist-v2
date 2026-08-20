import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInMemoryWorkerLifecycleStateRepository,
  createWorkerLifecycleStateService,
  type WorkerLifecycleStateRepositoryPort,
} from '../../src/modules/whatsapp/application/worker-lifecycle-state-service';

const tenantOne = 'tenant_example_1';
const tenantTwo = 'tenant_example_2';

void test('keeps lifecycle state isolated by tenant', async () => {
  const service = createWorkerLifecycleStateService({
    repository: createInMemoryWorkerLifecycleStateRepository(),
  });

  await service.save({
    tenantId: tenantOne,
    state: 'RUNNING',
    generation: 3,
    childId: 'child_example_3',
    quarantined: false,
  });
  await service.save({
    tenantId: tenantTwo,
    state: 'STOPPING',
    generation: 8,
    childId: 'child_example_8',
    quarantined: true,
  });

  assert.deepEqual(await service.recover(tenantOne), {
    tenantId: tenantOne,
    state: 'RUNNING',
    generation: 3,
    childId: 'child_example_3',
    quarantined: false,
  });
  assert.deepEqual(await service.recover(tenantTwo), {
    tenantId: tenantTwo,
    state: 'STOPPING',
    generation: 8,
    childId: 'child_example_8',
    quarantined: true,
  });
});

void test('recovers the latest lifecycle state through a newly composed service', async () => {
  const repository = createInMemoryWorkerLifecycleStateRepository();
  const writer = createWorkerLifecycleStateService({ repository });

  await writer.save({
    tenantId: tenantOne,
    state: 'RUNNING',
    generation: 2,
    childId: 'child_example_2',
    quarantined: false,
  });
  await writer.save({
    tenantId: tenantOne,
    state: 'STOPPED',
    generation: 2,
    childId: null,
    quarantined: false,
  });

  const recovered = createWorkerLifecycleStateService({ repository });
  assert.deepEqual(await recovered.recover(tenantOne), {
    tenantId: tenantOne,
    state: 'STOPPED',
    generation: 2,
    childId: null,
    quarantined: false,
  });
});

void test('rejects a stale lifecycle write without overwriting the newer tenant state', async () => {
  const service = createWorkerLifecycleStateService({
    repository: createInMemoryWorkerLifecycleStateRepository(),
  });
  const current = {
    tenantId: tenantOne,
    state: 'RUNNING' as const,
    generation: 3,
    childId: 'child_example_3',
    quarantined: false,
  };

  await service.save(current);
  await assert.rejects(
    service.save({ ...current, state: 'STOPPED', generation: 2, childId: null }),
    /stale lifecycle state/,
  );
  assert.deepEqual(await service.recover(tenantOne), current);
});

void test('allows equal-generation state transitions without affecting another tenant', async () => {
  const service = createWorkerLifecycleStateService({
    repository: createInMemoryWorkerLifecycleStateRepository(),
  });

  await service.save({
    tenantId: tenantOne,
    state: 'RUNNING',
    generation: 3,
    childId: 'child_example_3',
    quarantined: false,
  });
  await service.save({
    tenantId: tenantTwo,
    state: 'RUNNING',
    generation: 1,
    childId: 'child_example_1',
    quarantined: false,
  });
  await service.save({
    tenantId: tenantOne,
    state: 'STOPPING',
    generation: 3,
    childId: 'child_example_3',
    quarantined: true,
  });

  assert.equal((await service.recover(tenantOne))?.state, 'STOPPING');
  assert.equal((await service.recover(tenantTwo))?.generation, 1);
});

void test('compares the expected generation before saving without changing another tenant', async () => {
  const repository = createInMemoryWorkerLifecycleStateRepository();
  const service = createWorkerLifecycleStateService({ repository });
  const next = {
    tenantId: tenantOne,
    state: 'RUNNING' as const,
    generation: 2,
    childId: 'child_example_2',
    quarantined: false,
  };

  await repository.compareAndSave(next, null);
  await service.save({
    tenantId: tenantTwo,
    state: 'RUNNING',
    generation: 7,
    childId: 'child_example_7',
    quarantined: false,
  });
  await repository.compareAndSave({ ...next, state: 'STOPPING', quarantined: true }, 2);

  assert.equal((await service.recover(tenantOne))?.state, 'STOPPING');
  assert.equal((await service.recover(tenantTwo))?.generation, 7);
});

void test('rejects a mismatched compare-and-save without overwriting the recoverable snapshot', async () => {
  const repository = createInMemoryWorkerLifecycleStateRepository();
  const service = createWorkerLifecycleStateService({ repository });
  const current = {
    tenantId: tenantOne,
    state: 'RUNNING' as const,
    generation: 4,
    childId: 'child_example_4',
    quarantined: false,
  };

  await service.save(current);
  await assert.rejects(
    repository.compareAndSave({ ...current, state: 'STOPPED', childId: null }, 3),
    /lifecycle state generation mismatch/,
  );
  await assert.rejects(
    repository.compareAndSave({ ...current, generation: 5, childId: 'child_example_5' }, null),
    /lifecycle state generation mismatch/,
  );
  assert.deepEqual(await service.recover(tenantOne), current);
});

void test('preserves the prior snapshot when persistence fails', async () => {
  const repository = new FailingRepository();
  const service = createWorkerLifecycleStateService({ repository });
  const prior = {
    tenantId: tenantOne,
    state: 'RUNNING' as const,
    generation: 1,
    childId: 'child_example_1',
    quarantined: false,
  };

  await service.save(prior);
  repository.failNextSave();

  await assert.rejects(
    service.save({ ...prior, generation: 2, childId: 'child_example_2' }),
    /persistence unavailable/,
  );
  assert.deepEqual(await service.recover(tenantOne), prior);
});

class FailingRepository implements WorkerLifecycleStateRepositoryPort {
  private readonly delegate = createInMemoryWorkerLifecycleStateRepository();
  private fail = false;

  failNextSave(): void {
    this.fail = true;
  }

  load(tenantId: string) {
    return this.delegate.load(tenantId);
  }

  save(snapshot: Parameters<WorkerLifecycleStateRepositoryPort['save']>[0]) {
    if (this.fail) {
      this.fail = false;
      return Promise.reject(new Error('persistence unavailable'));
    }
    return this.delegate.save(snapshot);
  }

  compareAndSave(
    snapshot: Parameters<WorkerLifecycleStateRepositoryPort['compareAndSave']>[0],
    expectedGeneration: Parameters<WorkerLifecycleStateRepositoryPort['compareAndSave']>[1],
  ) {
    return this.delegate.compareAndSave(snapshot, expectedGeneration);
  }
}
