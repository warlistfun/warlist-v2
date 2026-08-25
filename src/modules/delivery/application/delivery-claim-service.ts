import type {
  DeliveryClaimRecord,
  DeliveryClaimRepositoryPort,
} from '../../../app/business-repository';
import type { IdGeneratorPort } from '../../../app/ports';

export function createDeliveryClaimService(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly ownerId: string;
  readonly idGenerator: IdGeneratorPort;
}): Readonly<{
  claim(
    input: Readonly<{ operationId: string; workerGeneration: number; childId: string }>,
  ): Promise<DeliveryClaimRecord>;
}> {
  return Object.freeze({
    claim(input): Promise<DeliveryClaimRecord> {
      return dependencies.repository.claimDelivery({
        tenantId: dependencies.trustedTenant.tenantId,
        operationId: input.operationId,
        attemptId: dependencies.idGenerator.generate(),
        claimOwner: dependencies.ownerId,
        workerGeneration: input.workerGeneration,
        childId: input.childId,
      });
    },
  });
}
