import type {
  DeliveryClaimRecord,
  DeliveryClaimRepositoryPort,
} from '../../../app/business-repository';
import type { ClockPort, IdGeneratorPort } from '../../../app/ports';

const leaseMs = 60_000;

export function createDeliveryClaimService(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly ownerId: string;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}): Readonly<{
  claim(
    input: Readonly<{ operationId: string; workerGeneration: number; childId: string }>,
  ): Promise<DeliveryClaimRecord>;
}> {
  return Object.freeze({
    claim(input): Promise<DeliveryClaimRecord> {
      const now = dependencies.clock.now();
      return dependencies.repository.claimDelivery({
        tenantId: dependencies.trustedTenant.tenantId,
        operationId: input.operationId,
        attemptId: dependencies.idGenerator.generate(),
        claimOwner: dependencies.ownerId,
        now: now.toISOString(),
        leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
        workerGeneration: input.workerGeneration,
        childId: input.childId,
      });
    },
  });
}
