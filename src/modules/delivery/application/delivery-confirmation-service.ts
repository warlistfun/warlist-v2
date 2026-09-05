import type {
  DeliveryClaimRepositoryPort,
  DeliveryConfirmationRecord,
} from '../../../app/business-repository';
import type { ClockPort, IdGeneratorPort } from '../../../app/ports';
import { businessDateInWib } from '../../entitlements/application/daily-entitlement-rule';

export function createDeliveryConfirmationService(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}): Readonly<{
  confirm(
    authority: Readonly<{
      operationId: string;
      attemptId: string;
      claimFence: number;
      claimOwner: string;
      leaseUntil: string;
      workerGeneration: number;
      childId: string;
    }>,
  ): Promise<DeliveryConfirmationRecord & Readonly<{ businessDate: string }>>;
}> {
  return Object.freeze({
    async confirm(authority) {
      const businessDate = businessDateInWib(dependencies.clock.now().toISOString());
      const result = await dependencies.repository.confirmDelivery({
        tenantId: dependencies.trustedTenant.tenantId,
        ...authority,
        debitId: dependencies.idGenerator.generate(),
        businessKey: `delivery:${authority.operationId}`,
        correlationId: `delivery:${authority.operationId}`,
      });
      return Object.freeze({ ...result, businessDate });
    },
  });
}
