import {
  RepositoryError,
  type DeliveryClaimRecord,
  type DeliveryClaimRepositoryPort,
} from '../../../app/business-repository';

type Authority = Readonly<{
  operationId: string;
  attemptId: string;
  claimFence: number;
  claimOwner: string;
  leaseUntil: string;
  workerGeneration: number;
  childId: string;
}>;

export function createDeliveryManualRecoveryService(dependencies: {
  readonly repository: DeliveryClaimRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
}): Readonly<{ resolve(authority: Authority): Promise<DeliveryClaimRecord> }> {
  return Object.freeze({
    resolve(authority) {
      if (!isAuthority(authority))
        return Promise.reject(new RepositoryError('INVALID_REPOSITORY_INPUT'));
      return dependencies.repository.recoverAmbiguousDelivery({
        tenantId: dependencies.trustedTenant.tenantId,
        ...authority,
      });
    },
  });
}

function isAuthority(value: unknown): value is Authority {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).length === 7 &&
    typeof input.operationId === 'string' &&
    typeof input.attemptId === 'string' &&
    typeof input.claimFence === 'number' &&
    Number.isSafeInteger(input.claimFence) &&
    input.claimFence > 0 &&
    typeof input.claimOwner === 'string' &&
    typeof input.leaseUntil === 'string' &&
    typeof input.workerGeneration === 'number' &&
    Number.isSafeInteger(input.workerGeneration) &&
    input.workerGeneration > 0 &&
    typeof input.childId === 'string'
  );
}
