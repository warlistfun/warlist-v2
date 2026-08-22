import type {
  TenantEnrollment,
  TenantEnrollmentRepositoryPort,
} from './tenant-enrollment-repository';

export function createTenantEnrollmentService(
  dependencies: Readonly<{
    repository: TenantEnrollmentRepositoryPort;
  }>,
): (
  input: Readonly<{
    grantId: string;
    userId: string;
    tenantId: string;
    publicOpsId: string;
  }>,
) => Promise<TenantEnrollment> {
  return (input) => dependencies.repository.enroll(input);
}
