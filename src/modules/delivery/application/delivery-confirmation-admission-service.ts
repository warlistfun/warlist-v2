import {
  RepositoryError,
  type DeliveryConfirmationAdmissionRecord,
  type DeliveryConfirmationAdmissionRepositoryPort,
} from '../../../app/business-repository';

type ConfirmationInput = Readonly<{
  tenantId: string;
  confirmationMessageId: string;
  publicOpsId: string;
  workerGeneration: number;
  childId: string;
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
    Object.keys(input).length === 5 &&
    Object.hasOwn(input, 'tenantId') &&
    Object.hasOwn(input, 'confirmationMessageId') &&
    Object.hasOwn(input, 'publicOpsId') &&
    Object.hasOwn(input, 'workerGeneration') &&
    Object.hasOwn(input, 'childId') &&
    isUuid(input.tenantId) &&
    isIdentifier(input.confirmationMessageId) &&
    isIdentifier(input.publicOpsId) &&
    isPositiveInteger(input.workerGeneration) &&
    isIdentifier(input.childId)
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
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
