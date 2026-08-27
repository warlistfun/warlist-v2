import {
  RepositoryError,
  type DeliveryConfirmationAdmissionRecord,
  type DeliveryConfirmationAdmissionRepositoryPort,
} from '../../../app/business-repository';

type ConfirmationInput = Readonly<{
  tenantId: string;
  operationId: string;
  attemptId: string;
  providerMessageId: string;
}>;

export function createDeliveryConfirmationAdmissionService(dependencies: {
  readonly repository: DeliveryConfirmationAdmissionRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
}): Readonly<{ admit(input: unknown): Promise<DeliveryConfirmationAdmissionRecord> }> {
  return Object.freeze({
    admit(input) {
      if (!isConfirmationInput(input)) {
        return Promise.reject(new RepositoryError('INVALID_REPOSITORY_INPUT'));
      }
      if (input.tenantId !== dependencies.trustedTenant.tenantId) {
        return Promise.reject(new RepositoryError('TENANT_ACCESS_DENIED'));
      }
      return dependencies.repository.admitDeliveryConfirmation(input);
    },
  });
}

function isConfirmationInput(value: unknown): value is ConfirmationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).length === 4 &&
    Object.hasOwn(input, 'tenantId') &&
    Object.hasOwn(input, 'operationId') &&
    Object.hasOwn(input, 'attemptId') &&
    Object.hasOwn(input, 'providerMessageId') &&
    isUuid(input.tenantId) &&
    isUuid(input.operationId) &&
    isUuid(input.attemptId) &&
    isIdentifier(input.providerMessageId)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,160}$/.test(value);
}
