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
}
