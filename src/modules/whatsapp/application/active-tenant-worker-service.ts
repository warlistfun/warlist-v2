import type { WorkerCommandResult } from './worker-runtime-service';

export interface WorkerLifecyclePort {
  startWorker(input: ActiveTenantWorker): Promise<WorkerCommandResult>;
  applyConfig(input: WorkerConfigUpdate): Promise<WorkerCommandResult>;
  stopWorker(input: WorkerStop): Promise<WorkerCommandResult>;
}

export interface ActiveTenantWorker {
  readonly tenantId: string;
  readonly childId: string;
  readonly correlationId: string;
  readonly configVersion: number;
}

export interface WorkerConfigUpdate {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly configVersion: number;
}

export interface WorkerStop {
  readonly tenantId: string;
  readonly correlationId: string;
}

export interface ActiveTenantWorkerService {
  bootActiveTenants(tenants: readonly ActiveTenantWorker[]): Promise<void>;
  applyConfig(input: WorkerConfigUpdate): Promise<WorkerCommandResult>;
  stopWorker(input: WorkerStop): Promise<WorkerCommandResult>;
}

export function createActiveTenantWorkerService(dependencies: {
  readonly lifecycle: WorkerLifecyclePort;
}): ActiveTenantWorkerService {
  return {
    async bootActiveTenants(tenants): Promise<void> {
      for (const tenant of tenants) await dependencies.lifecycle.startWorker(tenant);
    },
    applyConfig(input): Promise<WorkerCommandResult> {
      return dependencies.lifecycle.applyConfig(input);
    },
    stopWorker(input): Promise<WorkerCommandResult> {
      return dependencies.lifecycle.stopWorker(input);
    },
  };
}
