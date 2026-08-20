import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActiveTenantWorkerService,
  type WorkerLifecyclePort,
} from '../../src/modules/whatsapp/application/active-tenant-worker-service';

class ControlledLifecycle implements WorkerLifecyclePort {
  readonly starts: Parameters<WorkerLifecyclePort['startWorker']>[0][] = [];
  readonly updates: Parameters<WorkerLifecyclePort['applyConfig']>[0][] = [];
  readonly stops: Parameters<WorkerLifecyclePort['stopWorker']>[0][] = [];
  private startError: Error | undefined;

  failNextStart(error: Error): void {
    this.startError = error;
  }

  startWorker(input: Parameters<WorkerLifecyclePort['startWorker']>[0]): Promise<{ ok: true }> {
    this.starts.push(input);
    if (!this.startError) return Promise.resolve({ ok: true });
    const error = this.startError;
    this.startError = undefined;
    return Promise.reject(error);
  }

  applyConfig(input: Parameters<WorkerLifecyclePort['applyConfig']>[0]): Promise<{ ok: true }> {
    this.updates.push(input);
    return Promise.resolve({ ok: true });
  }

  stopWorker(input: Parameters<WorkerLifecyclePort['stopWorker']>[0]): Promise<{ ok: true }> {
    this.stops.push(input);
    return Promise.resolve({ ok: true });
  }
}

void test('stops boot at the first delegated failure', async () => {
  const lifecycle = new ControlledLifecycle();
  lifecycle.failNextStart(new Error('start unavailable'));
  const service = createActiveTenantWorkerService({ lifecycle });

  await assert.rejects(
    service.bootActiveTenants([
      {
        tenantId: 'tenant_example_1',
        childId: 'child_example_1',
        correlationId: 'corr_boot_1',
        configVersion: 1,
      },
      {
        tenantId: 'tenant_example_2',
        childId: 'child_example_2',
        correlationId: 'corr_boot_2',
        configVersion: 1,
      },
    ]),
    /start unavailable/,
  );
  assert.deepEqual(
    lifecycle.starts.map(({ tenantId }) => tenantId),
    ['tenant_example_1'],
  );
});

void test('boots supplied active tenants in input order and delegates update and stop', async () => {
  const lifecycle = new ControlledLifecycle();
  const service = createActiveTenantWorkerService({ lifecycle });

  await service.bootActiveTenants([
    {
      tenantId: 'tenant_example_1',
      childId: 'child_example_1',
      correlationId: 'corr_boot_1',
      configVersion: 1,
    },
    {
      tenantId: 'tenant_example_2',
      childId: 'child_example_2',
      correlationId: 'corr_boot_2',
      configVersion: 1,
    },
  ]);
  await service.applyConfig({
    tenantId: 'tenant_example_1',
    correlationId: 'corr_update',
    configVersion: 2,
  });
  await service.stopWorker({ tenantId: 'tenant_example_2', correlationId: 'corr_stop' });

  assert.deepEqual(lifecycle.starts, [
    {
      tenantId: 'tenant_example_1',
      childId: 'child_example_1',
      correlationId: 'corr_boot_1',
      configVersion: 1,
    },
    {
      tenantId: 'tenant_example_2',
      childId: 'child_example_2',
      correlationId: 'corr_boot_2',
      configVersion: 1,
    },
  ]);
  assert.deepEqual(lifecycle.updates, [
    { tenantId: 'tenant_example_1', correlationId: 'corr_update', configVersion: 2 },
  ]);
  assert.deepEqual(lifecycle.stops, [{ tenantId: 'tenant_example_2', correlationId: 'corr_stop' }]);
});
