import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { Client } from 'pg';

import {
  createPostgresWorkerLifecycleStateRepository,
  type TenantAuthorizationPort,
} from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';

const postgresBin = '/usr/lib/postgresql/16/bin';
const migration = resolve('migrations/0001-worker-lifecycle-states.sql');
const businessMigration = resolve('migrations/0002-business-foundation.sql');
const attemptMigration = resolve('migrations/0004-delivery-attempt-foundation.sql');
const claimMigration = resolve('migrations/0005-delivery-claim-lease.sql');
const tenantOne = '00000000-0000-4000-8000-000000000901';
const tenantTwo = '00000000-0000-4000-8000-000000000902';

void test('PostgreSQL repository fences lifecycle writes and authorizes tenant access', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));
  await database.client.query(readFileSync(attemptMigration, 'utf8'));
  await database.client.query(readFileSync(claimMigration, 'utf8'));
  await database.client.query(
    `INSERT INTO tenants (id, public_ops_id) VALUES ($1, 'ops_example_worker_state')`,
    [tenantOne],
  );
  const allowed = new Set([tenantOne]);
  const authorization: TenantAuthorizationPort = {
    assertAuthorized(tenantId): void {
      if (!allowed.has(tenantId)) {
        throw new Error('tenant access denied');
      }
    },
  };
  const first = createPostgresWorkerLifecycleStateRepository({
    client: database.client,
    authorization,
  });
  const second = createPostgresWorkerLifecycleStateRepository({
    client: database.secondClient,
    authorization,
  });
  const current = {
    tenantId: tenantOne,
    state: 'RUNNING' as const,
    generation: 3,
    childId: 'child_example_3',
    quarantined: false,
  };

  await first.compareAndSave(current, null);
  const writers = await Promise.allSettled([
    first.compareAndSave({ ...current, generation: 4, childId: 'child_example_4' }, 3),
    second.compareAndSave({ ...current, generation: 5, childId: 'child_example_5' }, 3),
  ]);
  assert.equal(writers.filter((writer) => writer.status === 'fulfilled').length, 1);
  assert.equal(writers.filter((writer) => writer.status === 'rejected').length, 1);
  const generation = (await first.load(tenantOne))?.generation;
  assert.ok(generation === 4 || generation === 5);

  await assert.rejects(first.save({ ...current, generation: 2 }), /stale lifecycle state/);
  assert.equal((await first.load(tenantOne))?.generation, generation);

  await assert.rejects(first.load(tenantTwo), /tenant access denied/);
  await assert.rejects(first.save({ ...current, tenantId: tenantTwo }), /tenant access denied/);
  await assert.rejects(
    first.save({ ...current, tenantId: 'tenant.invalid' }),
    /invalid tenant identifier/,
  );
  const count = await database.client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM tenant_worker_ownerships',
  );
  assert.equal(count.rows[0]?.count, '1');
});

void test('disposable PostgreSQL cleanup stops and removes artifacts after client close failure', async () => {
  const events: string[] = [];
  const closeFailure = new Error('synthetic client close failed');

  await assert.rejects(
    cleanupDisposableDatabase({
      clients: [
        {
          end: () => {
            events.push('first-client');
            return Promise.resolve();
          },
        },
        {
          end: () => {
            events.push('second-client');
            return Promise.reject(closeFailure);
          },
        },
      ],
      started: true,
      dataDirectory: '/tmp/warlist-pg16-example/cluster',
      root: '/tmp/warlist-pg16-example',
      runTool: (name, args) => events.push(`${name}:${args.join(' ')}`),
      removeDirectory: (path) => events.push(`remove:${path}`),
    }),
    closeFailure,
  );

  assert.deepEqual(events, [
    'first-client',
    'second-client',
    'pg_ctl:--pgdata /tmp/warlist-pg16-example/cluster --wait --mode fast stop',
    'remove:/tmp/warlist-pg16-example',
  ]);
});

void test('disposable PostgreSQL cleanup preserves a client close failure when cluster stop fails', async () => {
  const closeFailure = new Error('synthetic client close failed');
  const events: string[] = [];

  await assert.rejects(
    cleanupDisposableDatabase({
      clients: [{ end: () => Promise.reject(closeFailure) }],
      started: true,
      dataDirectory: '/tmp/warlist-pg16-example/cluster',
      root: '/tmp/warlist-pg16-example',
      runTool: () => {
        events.push('stop');
        throw new Error('synthetic cluster stop failed');
      },
      removeDirectory: () => events.push('remove'),
    }),
    closeFailure,
  );

  assert.deepEqual(events, ['stop', 'remove']);
});

void test('PostgreSQL 16 synthetic backup restores lifecycle state into a fresh disposable cluster', async (t) => {
  const source = await createDisposableDatabase(t);
  const target = await createDisposableDatabase(t);
  await source.client.query(readFileSync(migration, 'utf8'));
  await target.client.query(readFileSync(migration, 'utf8'));
  await source.client.query(
    `INSERT INTO worker_lifecycle_states
       (tenant_id, state, generation, child_id, quarantined)
     VALUES ('tenant_example_backup', 'STOPPING', 8, 'child_example_8', true)`,
  );
  const dump = join(source.root, 'synthetic.dump');

  runPostgresTool('pg_dump', [
    '--format=custom',
    '--file',
    dump,
    '--host',
    source.socketDirectory,
    '--port',
    String(source.port),
    '--username',
    'postgres',
    '--table',
    'worker_lifecycle_states',
    'postgres',
  ]);
  runPostgresTool('pg_restore', [
    '--clean',
    '--if-exists',
    '--host',
    target.socketDirectory,
    '--port',
    String(target.port),
    '--username',
    'postgres',
    '--dbname',
    'postgres',
    dump,
  ]);

  assert.deepEqual(
    (await target.client.query('SELECT tenant_id, generation FROM worker_lifecycle_states')).rows,
    [{ tenant_id: 'tenant_example_backup', generation: 8 }],
  );
});

type DisposableDatabase = Readonly<{
  client: Client;
  secondClient: Client;
  root: string;
  socketDirectory: string;
  port: number;
}>;

async function createDisposableDatabase(t: test.TestContext): Promise<DisposableDatabase> {
  const root = mkdtempSync(join(tmpdir(), 'warlist-pg16-'));
  const dataDirectory = join(root, 'cluster');
  const socketDirectory = join(root, 'socket');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const clients: Client[] = [];
  let started = false;
  t.after(() =>
    cleanupDisposableDatabase({
      clients,
      started,
      dataDirectory,
      root,
      runTool: runPostgresTool,
      removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
    }),
  );
  mkdirSync(socketDirectory);
  runPostgresTool('initdb', [
    '--no-sync',
    '--auth=trust',
    '--username=postgres',
    '--pgdata',
    dataDirectory,
  ]);
  const start = spawnSync(
    join(postgresBin, 'pg_ctl'),
    ['--pgdata', dataDirectory, '--wait', '--options', `-k ${socketDirectory} -p ${port}`, 'start'],
    { stdio: 'ignore', timeout: 10_000 },
  );
  if (start.status !== 0) {
    throw new Error('disposable PostgreSQL startup failed');
  }
  started = true;
  const connection = {
    host: socketDirectory,
    port,
    user: 'postgres',
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  };
  const client = new Client(connection);
  const secondClient = new Client(connection);
  clients.push(client, secondClient);
  await client.connect();
  await secondClient.connect();
  await Promise.all([
    client.query("SET statement_timeout = '5s'"),
    secondClient.query("SET statement_timeout = '5s'"),
  ]);
  await client.query(readFileSync(migration, 'utf8'));
  return { client, secondClient, root, socketDirectory, port };
}

type DisposableDatabaseCleanup = Readonly<{
  clients: ReadonlyArray<{ end(): Promise<void> }>;
  started: boolean;
  dataDirectory: string;
  root: string;
  runTool(name: string, args: readonly string[]): void;
  removeDirectory(path: string): void;
}>;

async function cleanupDisposableDatabase({
  clients,
  started,
  dataDirectory,
  root,
  runTool,
  removeDirectory,
}: DisposableDatabaseCleanup): Promise<void> {
  const closeResults = await Promise.allSettled(clients.map((client) => client.end()));
  const closeFailure = closeResults.find((result) => result.status === 'rejected');
  let cleanupFailure: unknown;
  if (started) {
    try {
      runTool('pg_ctl', ['--pgdata', dataDirectory, '--wait', '--mode', 'fast', 'stop']);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    removeDirectory(root);
  } catch (error) {
    cleanupFailure ??= error;
  }
  if (closeFailure?.status === 'rejected') {
    throw closeFailure.reason;
  }
  if (cleanupFailure instanceof Error) {
    throw cleanupFailure;
  }
  if (cleanupFailure !== undefined) {
    throw new Error('disposable PostgreSQL cleanup failed');
  }
}

function runPostgresTool(name: string, args: readonly string[]): void {
  const result = spawnSync(join(postgresBin, name), args, { encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr}`);
  }
}
