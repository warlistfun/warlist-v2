export type AuthenticatedPrincipal = Readonly<{
  userId: string;
  memberships: readonly Readonly<{
    tenantId: string;
    role: 'OWNER';
  }>[];
}>;

export type TenantAccess = Readonly<{
  tenantId: string;
}>;

export class PrincipalError extends Error {
  constructor(readonly code: 'INVALID_AUTHENTICATED_PRINCIPAL' | 'TENANT_ACCESS_DENIED') {
    super(
      code === 'INVALID_AUTHENTICATED_PRINCIPAL'
        ? 'Invalid authenticated principal'
        : 'Tenant access denied',
    );
    this.name = 'PrincipalError';
  }
}

export function decodeAuthenticatedPrincipal(input: unknown): AuthenticatedPrincipal {
  const values = exactRecordValues(input, ['userId', 'memberships']);
  if (!values || !isUuid(values.userId) || !Array.isArray(values.memberships)) {
    throw new PrincipalError('INVALID_AUTHENTICATED_PRINCIPAL');
  }
  const memberships = values.memberships.map(decodeMembership);
  if (memberships.some((membership) => membership === undefined)) {
    throw new PrincipalError('INVALID_AUTHENTICATED_PRINCIPAL');
  }
  const decodedMemberships = memberships as Readonly<{ tenantId: string; role: 'OWNER' }>[];
  if (
    new Set(decodedMemberships.map(({ tenantId }) => tenantId)).size !== decodedMemberships.length
  ) {
    throw new PrincipalError('INVALID_AUTHENTICATED_PRINCIPAL');
  }
  return Object.freeze({ userId: values.userId, memberships: Object.freeze(decodedMemberships) });
}

export function deriveTenantAccess(principal: unknown, tenantId: string): TenantAccess {
  const authenticatedPrincipal = decodeAuthenticatedPrincipal(principal);
  if (
    !isUuid(tenantId) ||
    !authenticatedPrincipal.memberships.some((membership) => membership.tenantId === tenantId)
  ) {
    throw new PrincipalError('TENANT_ACCESS_DENIED');
  }
  return Object.freeze({ tenantId });
}

export function createPrincipalTenantAuthorization(principal: unknown): Readonly<{
  assertAuthorized(tenantId: string): void;
}> {
  const authenticatedPrincipal = decodeAuthenticatedPrincipal(principal);
  return Object.freeze({
    assertAuthorized(tenantId): void {
      if (
        !isUuid(tenantId) ||
        !authenticatedPrincipal.memberships.some((membership) => membership.tenantId === tenantId)
      ) {
        throw new PrincipalError('TENANT_ACCESS_DENIED');
      }
    },
  });
}

function decodeMembership(
  value: unknown,
): Readonly<{ tenantId: string; role: 'OWNER' }> | undefined {
  const values = exactRecordValues(value, ['tenantId', 'role']);
  if (!values || !isUuid(values.tenantId) || values.role !== 'OWNER') return undefined;
  return Object.freeze({ tenantId: values.tenantId, role: 'OWNER' });
}

function exactRecordValues(
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      !keys.every((key) => typeof key === 'string' && expected.includes(key))
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
