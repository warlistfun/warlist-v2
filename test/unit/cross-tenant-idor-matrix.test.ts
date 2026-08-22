import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryBusinessRepository } from '../../src/app/business-repository';
import {
  createPrincipalTenantAuthorization,
  PrincipalError,
} from '../../src/modules/identity/application/authenticated-principal';

const userOne = '00000000-0000-4000-8000-000000000811';
const systemUser = '00000000-0000-4000-8000-000000000812';
const tenantOne = '00000000-0000-4000-8000-000000000821';
const tenantTwo = '00000000-0000-4000-8000-000000000822';

void test('cross-tenant IDOR matrix denies principal one access to existing tenant two state', async () => {
  let authorization = createPrincipalTenantAuthorization({
    userId: systemUser,
    memberships: [
      { tenantId: tenantOne, role: 'OWNER' },
      { tenantId: tenantTwo, role: 'OWNER' },
    ],
  });
  const repository = createInMemoryBusinessRepository({
    authorization: { assertAuthorized: (tenantId) => authorization.assertAuthorized(tenantId) },
  });
  await repository.start();
  await repository.createTenant({ id: tenantOne, publicOpsId: 'ops_example_one' });
  await repository.createTenant({ id: tenantTwo, publicOpsId: 'ops_example_two' });
  await repository.compareAndSaveConfig(
    { tenantId: tenantTwo, configuration: { enabled: true } },
    null,
  );
  await repository.appendAuditEvent({
    id: '00000000-0000-4000-8000-000000000831',
    tenantId: tenantTwo,
    correlationId: 'cross_tenant_matrix',
    actorType: 'SYSTEM',
    actorId: null,
    action: 'TENANT_CREATED',
    targetType: 'TENANT',
    targetId: tenantTwo,
  });
  authorization = createPrincipalTenantAuthorization({
    userId: userOne,
    memberships: [{ tenantId: tenantOne, role: 'OWNER' }],
  });

  for (const request of [
    () => repository.loadTenant(tenantTwo),
    () => repository.loadConfig(tenantTwo),
    () =>
      repository.prepareDelivery({
        id: '00000000-0000-4000-8000-000000000832',
        tenantId: tenantTwo,
        operationKey: 'automation:example',
      }),
    () => repository.readAuditEvents(tenantTwo, 1),
  ]) {
    await assert.rejects(
      request(),
      (error: unknown) => error instanceof PrincipalError && error.code === 'TENANT_ACCESS_DENIED',
    );
  }

  assert.equal((await repository.loadTenant(tenantOne))?.id, tenantOne);
  await repository.stop();
});

void test('principal authorization snapshots membership before caller mutation', () => {
  const principal = {
    userId: userOne,
    memberships: [{ tenantId: tenantOne, role: 'OWNER' }],
  };
  const authorization = createPrincipalTenantAuthorization(principal);
  principal.memberships.push({ tenantId: tenantTwo, role: 'OWNER' });

  assert.throws(
    () => authorization.assertAuthorized(tenantTwo),
    (error: unknown) => error instanceof PrincipalError && error.code === 'TENANT_ACCESS_DENIED',
  );
});

void test('cross-tenant IDOR matrix fails closed for forged and non-owner principals', () => {
  for (const principal of [
    { userId: userOne, memberships: [{ tenantId: tenantOne, role: 'ADMIN' }] },
    { userId: userOne, memberships: [{ tenantId: tenantOne, role: 'OWNER' }], tenantId: tenantTwo },
  ]) {
    assert.throws(
      () => createPrincipalTenantAuthorization(principal).assertAuthorized(tenantOne),
      (error: unknown) =>
        error instanceof PrincipalError && error.code === 'INVALID_AUTHENTICATED_PRINCIPAL',
    );
  }
});
