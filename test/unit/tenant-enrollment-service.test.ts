import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EnrollmentError,
  createInMemoryTenantEnrollmentRepository,
} from '../../src/modules/identity/application/tenant-enrollment-repository';
import { createTenantEnrollmentService } from '../../src/modules/identity/application/tenant-enrollment-service';

const grant = {
  id: '00000000-0000-4000-8000-000000000701',
  purpose: 'TENANT_ENROLLMENT' as const,
  expiresAt: '2030-01-01T00:00:00.000Z',
};

void test('consumes one valid enrollment grant to create its sole tenant owner', async () => {
  const repository = createInMemoryTenantEnrollmentRepository([grant]);
  const enroll = createTenantEnrollmentService({ repository });

  const enrolled = await enroll({
    grantId: grant.id,
    userId: '00000000-0000-4000-8000-000000000702',
    tenantId: '00000000-0000-4000-8000-000000000703',
    publicOpsId: 'ops_example_identity',
    now: '2026-08-22T12:00:00.000Z',
  });

  assert.deepEqual(enrolled, {
    userId: '00000000-0000-4000-8000-000000000702',
    tenantId: '00000000-0000-4000-8000-000000000703',
    publicOpsId: 'ops_example_identity',
    role: 'OWNER',
  });
  assert.deepEqual(await repository.readMemberships(enrolled.tenantId), [
    { userId: enrolled.userId, role: 'OWNER' },
  ]);
});

void test('allows exactly one concurrent consumption of the same enrollment grant', async () => {
  const repository = createInMemoryTenantEnrollmentRepository([grant]);
  const enroll = createTenantEnrollmentService({ repository });
  const input = {
    grantId: grant.id,
    publicOpsId: 'ops_example_race',
    now: '2026-08-22T12:00:00.000Z',
  };

  const results = await Promise.allSettled([
    enroll({
      ...input,
      userId: '00000000-0000-4000-8000-000000000711',
      tenantId: '00000000-0000-4000-8000-000000000712',
    }),
    enroll({
      ...input,
      userId: '00000000-0000-4000-8000-000000000713',
      tenantId: '00000000-0000-4000-8000-000000000714',
    }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected?.status, 'rejected');
  assert.ok(rejected.reason instanceof EnrollmentError);
  assert.equal(rejected.reason.code, 'ENROLLMENT_GRANT_UNAVAILABLE');
});

for (const [name, seededGrant, expectedCode] of [
  ['expired', { ...grant, expiresAt: '2026-08-22T11:59:59.999Z' }, 'ENROLLMENT_GRANT_UNAVAILABLE'],
  ['wrong purpose', { ...grant, purpose: 'OTHER' as const }, 'ENROLLMENT_GRANT_UNAVAILABLE'],
  [
    'already used',
    { ...grant, usedAt: '2026-08-22T11:00:00.000Z' },
    'ENROLLMENT_GRANT_UNAVAILABLE',
  ],
] as const) {
  void test(`rejects ${name} grant without allocating tenant membership`, async () => {
    const repository = createInMemoryTenantEnrollmentRepository([seededGrant]);
    const enroll = createTenantEnrollmentService({ repository });
    await assert.rejects(
      enroll({
        grantId: grant.id,
        userId: '00000000-0000-4000-8000-000000000721',
        tenantId: '00000000-0000-4000-8000-000000000722',
        publicOpsId: 'ops_example_rejected',
        now: '2026-08-22T12:00:00.000Z',
      }),
      (error: unknown) => error instanceof EnrollmentError && error.code === expectedCode,
    );
    assert.deepEqual(await repository.readMemberships('00000000-0000-4000-8000-000000000722'), []);
  });
}
