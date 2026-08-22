import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrincipalError,
  deriveTenantAccess,
  decodeAuthenticatedPrincipal,
} from '../../src/modules/identity/application/authenticated-principal';

const userId = '00000000-0000-4000-8000-000000000801';
const tenantOne = '00000000-0000-4000-8000-000000000802';
const tenantTwo = '00000000-0000-4000-8000-000000000803';

void test('derives immutable owner tenant access only from an authenticated principal', () => {
  const principal = decodeAuthenticatedPrincipal({
    userId,
    memberships: [{ tenantId: tenantOne, role: 'OWNER' }],
  });

  assert.equal(deriveTenantAccess(principal, tenantOne).tenantId, tenantOne);
  assert.equal(Object.isFrozen(principal), true);
  assert.equal(Object.isFrozen(principal.memberships), true);
});

void test('rejects a client attempt to switch an authenticated principal to another tenant', () => {
  const principal = decodeAuthenticatedPrincipal({
    userId,
    memberships: [{ tenantId: tenantOne, role: 'OWNER' }],
  });

  assert.throws(
    () => deriveTenantAccess(principal, tenantTwo),
    (error: unknown) => error instanceof PrincipalError && error.code === 'TENANT_ACCESS_DENIED',
  );
});

void test('rejects a forged principal before deriving tenant authority', () => {
  assert.throws(
    () =>
      deriveTenantAccess(
        { userId, memberships: [{ tenantId: tenantOne, role: 'ADMIN' }] },
        tenantOne,
      ),
    (error: unknown) =>
      error instanceof PrincipalError && error.code === 'INVALID_AUTHENTICATED_PRINCIPAL',
  );
});

void test('rejects accessor-backed and hidden principal authority without reading it', () => {
  const marker = 'untrusted-principal-content';
  const accessor = { tenantId: tenantOne };
  Object.defineProperty(accessor, 'role', {
    enumerable: true,
    get(): never {
      throw new Error(marker);
    },
  });
  const hidden = { tenantId: tenantOne, role: 'OWNER' };
  Object.defineProperty(hidden, 'rawPayload', { value: marker });
  const inherited = Object.create({ tenantId: tenantOne, role: 'OWNER' }) as object;
  const topLevelAccessor = { userId };
  Object.defineProperty(topLevelAccessor, 'memberships', {
    enumerable: true,
    get(): never {
      throw new Error(marker);
    },
  });

  for (const candidate of [
    { userId, memberships: [accessor] },
    { userId, memberships: [hidden] },
    { userId, memberships: [inherited] },
    topLevelAccessor,
  ]) {
    assert.throws(
      () => decodeAuthenticatedPrincipal(candidate),
      (error: unknown) =>
        error instanceof PrincipalError &&
        error.code === 'INVALID_AUTHENTICATED_PRINCIPAL' &&
        !error.message.includes(marker),
    );
  }
});

for (const [name, value] of [
  ['missing principal', undefined],
  ['client-selected tenant only', { tenantId: tenantOne }],
  ['unknown membership role', { userId, memberships: [{ tenantId: tenantOne, role: 'ADMIN' }] }],
  [
    'unexpected principal property',
    {
      userId,
      memberships: [{ tenantId: tenantOne, role: 'OWNER' }],
      tenantId: tenantOne,
    },
  ],
  [
    'duplicate tenant membership',
    {
      userId,
      memberships: [
        { tenantId: tenantOne, role: 'OWNER' },
        { tenantId: tenantOne, role: 'OWNER' },
      ],
    },
  ],
] as const) {
  void test(`rejects ${name} without deriving tenant authority`, () => {
    assert.throws(
      () => decodeAuthenticatedPrincipal(value),
      (error: unknown) =>
        error instanceof PrincipalError && error.code === 'INVALID_AUTHENTICATED_PRINCIPAL',
    );
  });
}
