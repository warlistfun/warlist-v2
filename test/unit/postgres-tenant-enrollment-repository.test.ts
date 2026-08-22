import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import { EnrollmentError } from '../../src/modules/identity/application/tenant-enrollment-repository';
import { createPostgresTenantEnrollmentRepository } from '../../src/modules/identity/infrastructure/postgres-tenant-enrollment-repository';
import { createDisposablePostgres } from '../support/disposable-postgres';

const grantId = '00000000-0000-4000-8000-000000000801';
const now = '2026-08-22T12:00:00.000Z';

void test('PostgreSQL enrollment atomically consumes one grant and creates one owner membership', async (t) => {
  const database = await createDisposablePostgres(t);
  const seed = new Client(database.config);
  await seed.connect();
  await seed.query(
    `INSERT INTO enrollment_grants (id, purpose, expires_at, created_at)
     VALUES ($1, 'TENANT_ENROLLMENT', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    [grantId],
  );
  const repository = createPostgresTenantEnrollmentRepository({ config: database.config });
  await repository.start();
  t.after(() => repository.stop());
  t.after(() => seed.end());

  const results = await Promise.allSettled([
    repository.enroll({
      grantId,
      userId: '00000000-0000-4000-8000-000000000802',
      tenantId: '00000000-0000-4000-8000-000000000803',
      publicOpsId: 'ops_example_pg_race',
      now,
    }),
    repository.enroll({
      grantId,
      userId: '00000000-0000-4000-8000-000000000804',
      tenantId: '00000000-0000-4000-8000-000000000805',
      publicOpsId: 'ops_example_pg_race_two',
      now,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected?.status, 'rejected');
  assert.ok(rejected.reason instanceof EnrollmentError);
  assert.equal(rejected.reason.code, 'ENROLLMENT_GRANT_UNAVAILABLE');
  const memberships = await seed.query('SELECT tenant_id, user_id, role FROM tenant_memberships');
  assert.equal(memberships.rowCount, 1);
});

void test('PostgreSQL rejects expired, wrong-purpose, and used grants without tenant allocation', async (t) => {
  const database = await createDisposablePostgres(t);
  const seed = new Client(database.config);
  await seed.connect();
  const repository = createPostgresTenantEnrollmentRepository({ config: database.config });
  await repository.start();
  t.after(() => repository.stop());
  t.after(() => seed.end());

  const invalidGrants: readonly (readonly [string, string, string, string | null])[] = [
    ['00000000-0000-4000-8000-000000000811', 'TENANT_ENROLLMENT', '2026-08-22T11:59:59.999Z', null],
    ['00000000-0000-4000-8000-000000000812', 'OTHER', '2030-01-01T00:00:00.000Z', null],
    [
      '00000000-0000-4000-8000-000000000813',
      'TENANT_ENROLLMENT',
      '2030-01-01T00:00:00.000Z',
      '2026-08-22T11:00:00.000Z',
    ],
  ];
  for (const [id, purpose, expiresAt, usedAt] of invalidGrants) {
    await seed.query(
      `INSERT INTO enrollment_grants (id, purpose, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00.000Z')`,
      [id, purpose, expiresAt, usedAt],
    );
    await assert.rejects(
      repository.enroll({
        grantId: id,
        userId: '00000000-0000-4000-8000-000000000814',
        tenantId: '00000000-0000-4000-8000-000000000815',
        publicOpsId: `ops_example_reject_${id.at(-1)}`,
        now,
      }),
      (error: unknown) =>
        error instanceof EnrollmentError && error.code === 'ENROLLMENT_GRANT_UNAVAILABLE',
    );
  }
  assert.equal((await seed.query('SELECT * FROM tenant_memberships')).rowCount, 0);
  assert.equal((await seed.query('SELECT * FROM tenants')).rowCount, 0);
});
