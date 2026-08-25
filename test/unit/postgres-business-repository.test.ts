import assert from 'node:assert/strict';
import test from 'node:test';

import { RepositoryError } from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { NoopLogger, NoopMetrics } from '../support/test-adapters';
import {
  MutableTenantAuthorization,
  verifyBusinessRepositoryContract,
} from '../support/business-repository-contract';

void test('pooled PostgreSQL adapter satisfies the shared business repository contract', async (t) => {
  const database = await createDisposablePostgres(t);
  const authorization = new MutableTenantAuthorization();
  const repository = createPostgresBusinessRepository({
    config: database.config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });

  await verifyBusinessRepositoryContract(t, repository, authorization);
});

void test('pooled PostgreSQL atomically saves config syncs, fences settlements, and recovers expired leases', async (t) => {
  const database = await createDisposablePostgres(t);
  const authorization = new MutableTenantAuthorization();
  const tenantId = '00000000-0000-4000-8000-000000000701';
  authorization.allowed.add(tenantId);
  const repository = createPostgresBusinessRepository({
    config: database.config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
  await repository.start();
  t.after(() => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_pg_outbox' });

  const committed = await repository.compareAndSaveConfigWithSync(
    { tenantId, configuration: { revision: 1 } },
    null,
  );
  assert.equal(committed.config.revision, 1);
  assert.equal((await repository.readAutomationConfigSync(tenantId, 1))?.status, 'PENDING');
  await assert.rejects(
    repository.compareAndSaveConfigWithSync({ tenantId, configuration: { revision: 2 } }, null),
    { code: 'CONFIG_VERSION_CONFLICT' },
  );
  assert.equal(await repository.readAutomationConfigSync(tenantId, 2), undefined);

  const [firstClaim] = await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now: '2026-08-21T12:00:00.000Z',
    leaseUntil: '2026-08-21T12:01:00.000Z',
    claimToken: 'claim_pg_one',
  });
  await assert.rejects(
    repository.markAutomationConfigSyncApplied({
      tenantId,
      configRevision: 1,
      claimToken: 'claim_stale',
    }),
    { code: 'AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT' },
  );
  await repository.recordAutomationConfigSyncFailure({
    tenantId,
    configRevision: 1,
    claimToken: 'claim_pg_one',
    retryable: true,
    failureCode: 'WA_RUNTIME_UNAVAILABLE',
    nextAttemptAt: '2026-08-21T12:02:00.000Z',
  });
  const [retryClaim] = await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now: '2026-08-21T12:02:00.000Z',
    leaseUntil: '2026-08-21T12:03:00.000Z',
    claimToken: 'claim_pg_two',
  });
  assert.deepEqual(retryClaim, {
    ...firstClaim,
    status: 'IN_FLIGHT',
    attempts: 2,
    claimToken: 'claim_pg_two',
    leaseUntil: '2026-08-21T12:03:00.000Z',
    failureCode: null,
    nextAttemptAt: null,
  });
  await repository.recordAutomationConfigSyncFailure({
    tenantId,
    configRevision: 1,
    claimToken: 'claim_pg_two',
    retryable: false,
    failureCode: 'WORKER_COMMAND_REJECTED',
    nextAttemptAt: null,
  });
  assert.deepEqual(
    await repository.claimDueAutomationConfigSyncs({
      limit: 1,
      now: '2026-08-21T12:04:00.000Z',
      leaseUntil: '2026-08-21T12:05:00.000Z',
      claimToken: 'claim_pg_three',
    }),
    [],
  );

  await repository.compareAndSaveConfigWithSync({ tenantId, configuration: { revision: 2 } }, 1);
  await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now: '2026-08-21T12:06:00.000Z',
    leaseUntil: '2026-08-21T12:07:00.000Z',
    claimToken: 'claim_expired',
  });
  const [reclaimed] = await repository.claimDueAutomationConfigSyncs({
    limit: 1,
    now: '2026-08-21T12:07:00.000Z',
    leaseUntil: '2026-08-21T12:08:00.000Z',
    claimToken: 'claim_reclaimed',
  });
  assert.deepEqual(reclaimed, {
    tenantId,
    configRevision: 2,
    status: 'IN_FLIGHT',
    attempts: 2,
    claimToken: 'claim_reclaimed',
    leaseUntil: '2026-08-21T12:08:00.000Z',
    failureCode: null,
    nextAttemptAt: null,
  });
});

void test('pooled PostgreSQL rejects a claim row with mismatched operation and attempt fences', async (t) => {
  const tenantId = '00000000-0000-4000-8000-000000000901';
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createPostgresBusinessRepository({
    config: syntheticConfig(),
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
    poolFactory: () => ({
      query: () =>
        Promise.resolve({
          rowCount: 1,
          rows: [
            {
              operation_id: '00000000-0000-4000-8000-000000000902',
              tenant_id: tenantId,
              operation_key: 'automation:message_example_claim_validation',
              operation_status: 'CLAIMED',
              claim_owner: 'claim_owner_validation',
              claim_fence: 2,
              claim_lease_until: new Date('2030-08-22T07:01:00.000Z'),
              worker_generation: 3,
              worker_child_id: 'child_example_3',
              operation_schema_version: 1,
              operation_revision: 2,
              operation_created_at: new Date('2030-08-22T07:00:00.000Z'),
              operation_updated_at: new Date('2030-08-22T07:00:00.000Z'),
              attempt_id: '00000000-0000-4000-8000-000000000903',
              attempt_number: 2,
              attempt_status: 'PREPARED',
              attempt_claim_fence: 1,
              attempt_schema_version: 1,
              attempt_revision: 1,
              attempt_created_at: new Date('2030-08-22T07:00:00.000Z'),
              attempt_updated_at: new Date('2030-08-22T07:00:00.000Z'),
            },
          ],
        }),
      end: () => Promise.resolve(),
    }),
  });
  await repository.start();
  t.after(() => repository.stop());

  await assert.rejects(
    repository.claimDelivery({
      tenantId,
      operationId: '00000000-0000-4000-8000-000000000902',
      attemptId: '00000000-0000-4000-8000-000000000903',
      claimOwner: 'claim_owner_validation',
      workerGeneration: 3,
      childId: 'child_example_3',
    }),
    { code: 'DATABASE_ROW_INVALID' },
  );
});

void test('pooled PostgreSQL lifecycle is bounded, safe, and cleanup-retryable', async () => {
  const events: string[] = [];
  const logs: Array<Readonly<{ message: string; context?: Readonly<Record<string, unknown>> }>> =
    [];
  const metrics: string[] = [];
  let closeAttempts = 0;
  let queryFailure: Error | undefined;
  let poolOptions: Readonly<Record<string, unknown>> | undefined;
  const pool = {
    query(): Promise<{ rowCount: number; rows: readonly unknown[] }> {
      if (queryFailure) return Promise.reject(queryFailure);
      return Promise.resolve({ rowCount: 1, rows: [{}] });
    },
    end(): Promise<void> {
      closeAttempts += 1;
      events.push(`end:${closeAttempts}`);
      return closeAttempts === 1
        ? Promise.reject(new Error('synthetic sensitive marker cleanup failure'))
        : Promise.resolve();
    },
  };
  const repository = createPostgresBusinessRepository({
    config: syntheticConfig(),
    authorization: { assertAuthorized: () => undefined },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, context) => logs.push(context ? { message, context } : { message }),
      error: () => undefined,
    },
    metrics: { increment: (name) => metrics.push(name) },
    poolFactory: (options) => {
      poolOptions = options;
      events.push('pool');
      return pool;
    },
  });

  assert.equal(await repository.isReady(), false);
  await repository.start();
  await repository.start();
  assert.equal(await repository.isReady(), true);
  assert.equal(events.filter((event) => event === 'pool').length, 1);
  assert.deepEqual(poolOptions, expectPoolOptions());
  await assert.rejects(
    repository.loadTenant('00000000-0000-4000-8000-000000000101'),
    (error: unknown) => error instanceof RepositoryError && error.code === 'DATABASE_ROW_INVALID',
  );

  queryFailure = Object.assign(new Error('raw SQL and connection secret must not leak'), {
    code: '57P01',
  });
  assert.equal(await repository.isReady(), false);
  await assert.rejects(
    repository.loadTenant('00000000-0000-4000-8000-000000000101'),
    (error: unknown) =>
      error instanceof RepositoryError &&
      error.code === 'DATABASE_UNAVAILABLE' &&
      error.message === 'Database is unavailable',
  );
  queryFailure = Object.assign(new Error('raw statement timeout must not leak'), {
    code: '57014',
  });
  await assert.rejects(
    repository.loadTenant('00000000-0000-4000-8000-000000000101'),
    (error: unknown) =>
      error instanceof RepositoryError &&
      error.code === 'DATABASE_TIMEOUT' &&
      error.message === 'Database request timed out',
  );
  assert.doesNotMatch(
    JSON.stringify({ logs, metrics }),
    /raw SQL|connection secret|raw statement timeout|sensitive marker/,
  );
  assert.equal(
    metrics.every((name) => /^database_[a-z_]+$/.test(name)),
    true,
  );
  assert.equal(
    logs.every(
      ({ message, context }) =>
        message === 'Database operation failed' &&
        Object.keys(context ?? {}).every((key) => key === 'code'),
    ),
    true,
  );

  queryFailure = undefined;
  await assert.rejects(
    repository.stop(),
    (error: unknown) =>
      error instanceof RepositoryError && error.code === 'DATABASE_CLEANUP_INCOMPLETE',
  );
  assert.equal(await repository.isReady(), false);
  await assert.rejects(
    repository.start(),
    (error: unknown) =>
      error instanceof RepositoryError && error.code === 'DATABASE_CLEANUP_INCOMPLETE',
  );
  await repository.stop();
  await repository.start();
  await repository.stop();
  await repository.stop();
  assert.equal(events.filter((event) => event === 'pool').length, 2);
});

void test('pooled PostgreSQL rejects invalid configuration before creating a pool', () => {
  let created = false;
  assert.throws(
    () =>
      createPostgresBusinessRepository({
        config: { ...syntheticConfig(), max: 21 },
        authorization: { assertAuthorized: () => undefined },
        logger: new NoopLogger(),
        metrics: new NoopMetrics(),
        poolFactory: () => {
          created = true;
          throw new Error('must not create pool');
        },
      }),
    (error: unknown) =>
      error instanceof RepositoryError && error.code === 'INVALID_REPOSITORY_INPUT',
  );
  assert.equal(created, false);
});

function syntheticConfig(): Readonly<Record<string, unknown>> {
  return {
    host: '/tmp/warlist-example-socket',
    port: 25_432,
    user: 'postgres',
    password: '',
    database: 'postgres',
    ssl: false,
    max: 4,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 5_000,
    statementTimeoutMillis: 2_000,
  };
}

function expectPoolOptions(): Readonly<Record<string, unknown>> {
  return {
    host: '/tmp/warlist-example-socket',
    port: 25_432,
    user: 'postgres',
    password: '',
    database: 'postgres',
    ssl: false,
    max: 4,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 5_000,
    statement_timeout: 2_000,
    application_name: 'warlist-v2',
  };
}
