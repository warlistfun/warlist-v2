import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RepositoryError,
  type BusinessRepositoryPort,
  type TenantRecord,
} from '../../src/app/business-repository';
import { createActiveTenantBootService } from '../../src/modules/whatsapp/application/active-tenant-boot-service';
import type {
  ActiveTenantWorker,
  ActiveTenantWorkerService,
} from '../../src/modules/whatsapp/application/active-tenant-worker-service';

const tenantOne = '00000000-0000-4000-8000-000000001201';
const tenantTwo = '00000000-0000-4000-8000-000000001202';

class ControlledRepository implements Pick<BusinessRepositoryPort, 'loadTenant'> {
  readonly loads: string[] = [];
  readonly records = new Map<string, TenantRecord>();
  readonly errors = new Map<string, RepositoryError>();

  loadTenant(tenantId: string): Promise<TenantRecord | undefined> {
    this.loads.push(tenantId);
    const error = this.errors.get(tenantId);
    if (error) return Promise.reject(error);
    return Promise.resolve(this.records.get(tenantId));
  }
}

class ControlledWorkers implements Pick<ActiveTenantWorkerService, 'bootActiveTenants'> {
  bootCalls = 0;
  readonly starts: ActiveTenantWorker[] = [];

  bootActiveTenants(tenants: readonly ActiveTenantWorker[]): Promise<void> {
    this.bootCalls += 1;
    this.starts.push(...tenants);
    return Promise.resolve();
  }
}

void test('boots only canonical active tenants loaded through exact tenant-scoped repository calls', async () => {
  const repository = new ControlledRepository();
  repository.records.set(tenantOne, activeTenant(tenantOne, 'ops_example_boot_one'));
  repository.records.set(tenantTwo, activeTenant(tenantTwo, 'ops_example_boot_two'));
  const workers = new ControlledWorkers();
  const candidates = [worker(tenantOne, 1), worker(tenantTwo, 2)];

  const evidence = await createActiveTenantBootService({ repository, workers }).boot(candidates);

  assert.deepEqual(repository.loads, [tenantOne, tenantTwo]);
  assert.equal(workers.bootCalls, 1);
  assert.deepEqual(workers.starts, candidates);
  assert.deepEqual(evidence, {
    started: 2,
    inactive: 0,
    malformed: 0,
    unavailable: 0,
    unauthorized: 0,
  });
  assert.equal(Object.isFrozen(evidence), true);
});

void test('rejects unsafe tenant discovery outcomes without starting workers or exposing details', async () => {
  const inactiveId = '00000000-0000-4000-8000-000000001211';
  const malformedId = '00000000-0000-4000-8000-000000001212';
  const unavailableId = '00000000-0000-4000-8000-000000001213';
  const unauthorizedId = '00000000-0000-4000-8000-000000001214';
  const repository = new ControlledRepository();
  repository.records.set(inactiveId, {
    ...activeTenant(inactiveId, 'ops_example_inactive'),
    status: 'INACTIVE',
  });
  repository.errors.set(malformedId, new RepositoryError('DATABASE_ROW_INVALID'));
  repository.errors.set(unavailableId, new RepositoryError('DATABASE_UNAVAILABLE'));
  repository.errors.set(unauthorizedId, new RepositoryError('TENANT_ACCESS_DENIED'));
  const workers = new ControlledWorkers();

  const evidence = await createActiveTenantBootService({ repository, workers }).boot([
    worker(inactiveId, 11),
    worker(malformedId, 12),
    worker(unavailableId, 13),
    worker(unauthorizedId, 14),
  ]);

  assert.equal(workers.bootCalls, 0);
  assert.deepEqual(workers.starts, []);
  assert.deepEqual(evidence, {
    started: 0,
    inactive: 1,
    malformed: 1,
    unavailable: 1,
    unauthorized: 1,
  });
  assert.equal(Object.isFrozen(evidence), true);
});

function activeTenant(id: string, publicOpsId: string): TenantRecord {
  return Object.freeze({
    id,
    publicOpsId,
    status: 'ACTIVE',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  });
}

function worker(tenantId: string, suffix: number): ActiveTenantWorker {
  return Object.freeze({
    tenantId,
    childId: `child_example_boot_${suffix}`,
    correlationId: `corr_boot_${suffix}`,
    configVersion: 1,
  });
}
