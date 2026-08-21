import type {
  AutomationConfigSyncRecord,
  BusinessRepositoryPort,
} from '../../../app/business-repository';
import type { ClockPort, IdGeneratorPort } from '../../../app/ports';
import type { WorkerConfigUpdate } from '../../whatsapp/application/active-tenant-worker-service';
import {
  WorkerRuntimeError,
  type WorkerCommandResult,
} from '../../whatsapp/application/worker-runtime-service';

const delayMs = 60_000;

export function createAutomationConfigSyncDispatcher(dependencies: {
  readonly repository: BusinessRepositoryPort;
  readonly worker: Readonly<{
    applyConfig(input: WorkerConfigUpdate): Promise<WorkerCommandResult>;
  }>;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}): Readonly<{ dispatchOne(): Promise<AutomationConfigSyncRecord | undefined> }> {
  return Object.freeze({
    async dispatchOne(): Promise<AutomationConfigSyncRecord | undefined> {
      const now = dependencies.clock.now();
      const claimToken = dependencies.idGenerator.generate();
      const [claimed] = await dependencies.repository.claimDueAutomationConfigSyncs({
        limit: 1,
        now: now.toISOString(),
        leaseUntil: new Date(now.getTime() + delayMs).toISOString(),
        claimToken,
      });
      if (!claimed) return undefined;

      try {
        await dependencies.worker.applyConfig({
          tenantId: claimed.tenantId,
          correlationId: claimToken,
          configVersion: claimed.configRevision,
        });
        return dependencies.repository.markAutomationConfigSyncApplied({
          tenantId: claimed.tenantId,
          configRevision: claimed.configRevision,
          claimToken,
        });
      } catch (error) {
        const failure = toFailure(error);
        return dependencies.repository.recordAutomationConfigSyncFailure({
          tenantId: claimed.tenantId,
          configRevision: claimed.configRevision,
          claimToken,
          retryable: failure.retryable,
          failureCode: failure.code,
          nextAttemptAt: failure.retryable ? new Date(now.getTime() + delayMs).toISOString() : null,
        });
      }
    },
  });
}

function toFailure(error: unknown): Readonly<{ code: string; retryable: boolean }> {
  return error instanceof WorkerRuntimeError
    ? { code: error.code, retryable: error.retryable }
    : { code: 'WORKER_INTERNAL_ERROR', retryable: true };
}
