import { RepositoryError, type BusinessRepositoryPort } from '../../../app/business-repository';
import type { ActiveTenantWorker, ActiveTenantWorkerService } from './active-tenant-worker-service';

export type ActiveTenantBootEvidence = Readonly<{
  started: number;
  inactive: number;
  malformed: number;
  unavailable: number;
  unauthorized: number;
}>;

export function createActiveTenantBootService(dependencies: {
  readonly repository: Pick<BusinessRepositoryPort, 'loadTenant'>;
  readonly workers: Pick<ActiveTenantWorkerService, 'bootActiveTenants'>;
}): Readonly<{
  boot(candidates: readonly ActiveTenantWorker[]): Promise<ActiveTenantBootEvidence>;
}> {
  return Object.freeze({
    async boot(candidates): Promise<ActiveTenantBootEvidence> {
      const active: ActiveTenantWorker[] = [];
      const counts = { inactive: 0, malformed: 0, unavailable: 0, unauthorized: 0 };
      for (const candidate of candidates) {
        try {
          const tenant = await dependencies.repository.loadTenant(candidate.tenantId);
          if (!tenant || tenant.id !== candidate.tenantId) counts.malformed += 1;
          else if (tenant.status !== 'ACTIVE') counts.inactive += 1;
          else active.push(candidate);
        } catch (error) {
          if (error instanceof RepositoryError && error.code === 'TENANT_ACCESS_DENIED') {
            counts.unauthorized += 1;
          } else if (error instanceof RepositoryError && error.code === 'DATABASE_ROW_INVALID') {
            counts.malformed += 1;
          } else {
            counts.unavailable += 1;
          }
        }
      }
      if (active.length > 0) await dependencies.workers.bootActiveTenants(active);
      return Object.freeze({ started: active.length, ...counts });
    },
  });
}
