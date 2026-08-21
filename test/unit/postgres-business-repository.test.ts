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
