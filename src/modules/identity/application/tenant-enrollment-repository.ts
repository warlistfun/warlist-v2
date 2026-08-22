export type EnrollmentGrant = Readonly<{
  id: string;
  purpose: 'TENANT_ENROLLMENT' | 'OTHER';
  expiresAt: string;
  usedAt?: string;
}>;

export type TenantEnrollment = Readonly<{
  userId: string;
  tenantId: string;
  publicOpsId: string;
  role: 'OWNER';
}>;

export class EnrollmentError extends Error {
  constructor(readonly code: 'ENROLLMENT_GRANT_UNAVAILABLE' | 'INVALID_ENROLLMENT_INPUT') {
    super(
      code === 'ENROLLMENT_GRANT_UNAVAILABLE'
        ? 'Enrollment grant is unavailable'
        : 'Invalid enrollment input',
    );
    this.name = 'EnrollmentError';
  }
}

export interface TenantEnrollmentRepositoryPort {
  enroll(
    input: Readonly<{
      grantId: string;
      userId: string;
      tenantId: string;
      publicOpsId: string;
      now: string;
    }>,
  ): Promise<TenantEnrollment>;
}

export function createInMemoryTenantEnrollmentRepository(
  seededGrants: readonly EnrollmentGrant[],
): TenantEnrollmentRepositoryPort & {
  readMemberships(
    tenantId: string,
  ): Promise<readonly Readonly<{ userId: string; role: 'OWNER' }>[]>;
} {
  const grants = new Map(seededGrants.map((grant) => [grant.id, { ...grant }]));
  const memberships = new Map<string, readonly Readonly<{ userId: string; role: 'OWNER' }>[]>();
  const tenants = new Set<string>();
  let transition = Promise.resolve();

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = transition.then(operation, operation);
    transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    enroll(input): Promise<TenantEnrollment> {
      return enqueue(() => {
        if (!isInput(input)) throw new EnrollmentError('INVALID_ENROLLMENT_INPUT');
        const grant = grants.get(input.grantId);
        if (
          !grant ||
          grant.purpose !== 'TENANT_ENROLLMENT' ||
          grant.usedAt !== undefined ||
          Date.parse(grant.expiresAt) <= Date.parse(input.now) ||
          tenants.has(input.tenantId)
        ) {
          throw new EnrollmentError('ENROLLMENT_GRANT_UNAVAILABLE');
        }
        const enrolled = Object.freeze({
          userId: input.userId,
          tenantId: input.tenantId,
          publicOpsId: input.publicOpsId,
          role: 'OWNER' as const,
        });
        grants.set(grant.id, { ...grant, usedAt: input.now });
        tenants.add(input.tenantId);
        memberships.set(
          input.tenantId,
          Object.freeze([Object.freeze({ userId: input.userId, role: 'OWNER' as const })]),
        );
        return enrolled;
      });
    },
    readMemberships(tenantId) {
      return Promise.resolve(memberships.get(tenantId) ?? Object.freeze([]));
    },
  };
}

function isInput(value: unknown): value is Readonly<{
  grantId: string;
  userId: string;
  tenantId: string;
  publicOpsId: string;
  now: string;
}> {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    isUuid(input.grantId) &&
    isUuid(input.userId) &&
    isUuid(input.tenantId) &&
    typeof input.publicOpsId === 'string' &&
    /^[a-z0-9_]{1,64}$/.test(input.publicOpsId) &&
    typeof input.now === 'string' &&
    Number.isFinite(Date.parse(input.now))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
