import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { Client } from 'pg';

import { runPostgresMigrations } from '../../src/infrastructure/database/postgres-migrator';

const postgresBin = '/usr/lib/postgresql/16/bin';
const lifecycleMigration = resolve('migrations/0001-worker-lifecycle-states.sql');
const businessMigration = resolve('migrations/0002-business-foundation.sql');
const migrations = [
  { revision: 1, name: 'worker-lifecycle-states', sql: readFileSync(lifecycleMigration, 'utf8') },
  { revision: 2, name: 'business-foundation', sql: readFileSync(businessMigration, 'utf8') },
] as const;

void test('versioned migrator rejects out-of-order revisions before querying PostgreSQL', async () => {
  const queries: string[] = [];
  const client = {
    query(text: string): Promise<{ rowCount: number; rows: readonly unknown[] }> {
      queries.push(text);
      return Promise.resolve({ rowCount: 0, rows: [] });
    },
  };

  await assert.rejects(
    runPostgresMigrations({
      client,
      migrations: [
        { revision: 2, name: 'second', sql: 'SELECT 2' },
        { revision: 1, name: 'first', sql: 'SELECT 1' },
      ],
    }),
    /invalid PostgreSQL migration list/,
  );
  assert.deepEqual(queries, []);
});

void test('versioned migrator rejects duplicate names before querying PostgreSQL', async () => {
  const queries: string[] = [];
  const client = {
    query(text: string): Promise<{ rowCount: number; rows: readonly unknown[] }> {
      queries.push(text);
      return Promise.resolve({ rowCount: 0, rows: [] });
    },
  };

  await assert.rejects(
    runPostgresMigrations({
      client,
      migrations: [
        { revision: 1, name: 'duplicate', sql: 'SELECT 1' },
        { revision: 2, name: 'duplicate', sql: 'SELECT 2' },
      ],
    }),
    /invalid PostgreSQL migration list/,
  );
  assert.deepEqual(queries, []);
});

void test('versioned migrator applies ordered migrations once and reruns safely', async (t) => {
  const database = await createDisposableDatabase(t);

  await runPostgresMigrations({ client: database.client, migrations });
  await runPostgresMigrations({ client: database.client, migrations });

  const applied = await database.client.query<{
    revision: number;
    name: string;
    checksum: string;
  }>('SELECT revision, name, checksum FROM schema_migrations ORDER BY revision');
  assert.deepEqual(
    applied.rows.map(({ revision, name, checksum }) => ({
      revision,
      name,
      checksumLength: checksum.length,
    })),
    [
      { revision: 1, name: 'worker-lifecycle-states', checksumLength: 64 },
      { revision: 2, name: 'business-foundation', checksumLength: 64 },
    ],
  );
});

void test('concurrent versioned migrators serialize one unapplied revision', async (t) => {
  const database = await createDisposableDatabase(t);
  await runPostgresMigrations({ client: database.client, migrations: [] });
  const concurrentMigration = [
    {
      revision: 1,
      name: 'concurrency-probe',
      sql: 'CREATE TABLE IF NOT EXISTS concurrency_probe (id integer PRIMARY KEY)',
    },
  ] as const;

  await Promise.all([
    runPostgresMigrations({ client: database.client, migrations: concurrentMigration }),
    runPostgresMigrations({ client: database.secondClient, migrations: concurrentMigration }),
  ]);
  const applied = await database.client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM schema_migrations WHERE revision = 1',
  );
  assert.equal(applied.rows[0]?.count, '1');
});

void test('versioned migrator rejects applied migration checksum drift', async (t) => {
  const database = await createDisposableDatabase(t);
  await runPostgresMigrations({ client: database.client, migrations });
  const changed = migrations.map((migration) =>
    migration.revision === 2 ? { ...migration, sql: `${migration.sql}\nSELECT 1;` } : migration,
  );

  await assert.rejects(
    runPostgresMigrations({ client: database.client, migrations: changed }),
    /migration revision 2 does not match applied checksum/,
  );
  const applied = await database.client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM schema_migrations',
  );
  assert.equal(applied.rows[0]?.count, '2');
});

void test('versioned migrator rolls back the migration batch when a revision fails', async (t) => {
  const database = await createDisposableDatabase(t);
  const failingMigrations = [
    { revision: 1, name: 'rollback-probe', sql: 'CREATE TABLE rollback_probe (id integer)' },
    { revision: 2, name: 'synthetic-failure', sql: 'SELECT * FROM missing_synthetic_table' },
  ] as const;

  await assert.rejects(
    runPostgresMigrations({ client: database.client, migrations: failingMigrations }),
    /missing_synthetic_table/,
  );
  const probe = await database.client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.rollback_probe')::text AS table_name",
  );
  assert.equal(probe.rows[0]?.table_name, null);
  const ledger = await database.client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS table_name",
  );
  assert.equal(ledger.rows[0]?.table_name, null);
});

void test('canonical tenant foundation exposes bounded identity, revision, and timestamp columns', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const columns = await database.client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants'
     ORDER BY ordinal_position`,
  );
  assert.deepEqual(
    columns.rows.map(({ column_name }) => column_name),
    ['id', 'public_ops_id', 'status', 'schema_version', 'revision', 'created_at', 'updated_at'],
  );
});

void test('canonical tenant foundation enforces identity, lifecycle, revision, and timestamp invariants', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));
  await database.client.query(
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000001', 'ops_example_one')`,
  );

  const invalidInserts = [
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000002', 'ops_example_one')`,
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000003', 'ops identifier with spaces')`,
    `INSERT INTO tenants (id, public_ops_id, status)
     VALUES ('00000000-0000-4000-8000-000000000004', 'ops_example_four', 'UNKNOWN')`,
    `INSERT INTO tenants (id, public_ops_id, schema_version)
     VALUES ('00000000-0000-4000-8000-000000000005', 'ops_example_five', 0)`,
    `INSERT INTO tenants (id, public_ops_id, revision)
     VALUES ('00000000-0000-4000-8000-000000000006', 'ops_example_six', 0)`,
    `INSERT INTO tenants (id, public_ops_id, created_at, updated_at)
     VALUES ('00000000-0000-4000-8000-000000000007', 'ops_example_seven', now(), now() - interval '1 second')`,
  ];
  for (const sql of invalidInserts) {
    await assert.rejects(database.client.query(sql), /violates (unique|check) constraint/);
  }
});

void test('canonical config foundation exposes tenant-owned versioned business state', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const columns = await database.client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automation_configs'
     ORDER BY ordinal_position`,
  );
  assert.deepEqual(
    columns.rows.map(({ column_name }) => column_name),
    ['tenant_id', 'configuration', 'schema_version', 'revision', 'created_at', 'updated_at'],
  );
});

void test('canonical config foundation enforces ownership, object shape, revision, and timestamps', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));
  await database.client.query(
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000010', 'ops_example_config')`,
  );
  await database.client.query(
    `INSERT INTO automation_configs (tenant_id, configuration)
     VALUES ('00000000-0000-4000-8000-000000000010', '{"enabled": false}')`,
  );

  const invalidMutations = [
    `INSERT INTO automation_configs (tenant_id)
     VALUES ('00000000-0000-4000-8000-000000000011')`,
    `UPDATE automation_configs
     SET configuration = '[]'
     WHERE tenant_id = '00000000-0000-4000-8000-000000000010'`,
    `UPDATE automation_configs
     SET schema_version = 0
     WHERE tenant_id = '00000000-0000-4000-8000-000000000010'`,
    `UPDATE automation_configs
     SET revision = 0
     WHERE tenant_id = '00000000-0000-4000-8000-000000000010'`,
    `UPDATE automation_configs
     SET updated_at = created_at - interval '1 second'
     WHERE tenant_id = '00000000-0000-4000-8000-000000000010'`,
  ];
  for (const sql of invalidMutations) {
    await assert.rejects(database.client.query(sql), /violates (foreign key|check) constraint/);
  }
});

void test('canonical delivery foundation exposes tenant-owned deterministic prepared operation identity', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const columns = await database.client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'delivery_operations'
     ORDER BY ordinal_position`,
  );
  assert.deepEqual(
    columns.rows.map(({ column_name }) => column_name),
    [
      'id',
      'tenant_id',
      'operation_key',
      'status',
      'schema_version',
      'revision',
      'created_at',
      'updated_at',
    ],
  );
});

void test('canonical delivery foundation enforces ownership, idempotency, prepared state, and revision', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));
  await database.client.query(
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000020', 'ops_example_delivery')`,
  );
  await database.client.query(
    `INSERT INTO delivery_operations (id, tenant_id, operation_key)
     VALUES (
       '00000000-0000-4000-8000-000000000021',
       '00000000-0000-4000-8000-000000000020',
       'automation:message_example_1'
     )`,
  );

  const invalidMutations = [
    `INSERT INTO delivery_operations (id, tenant_id, operation_key)
     VALUES (
       '00000000-0000-4000-8000-000000000022',
       '00000000-0000-4000-8000-000000000099',
       'automation:message_example_2'
     )`,
    `INSERT INTO delivery_operations (id, tenant_id, operation_key)
     VALUES (
       '00000000-0000-4000-8000-000000000023',
       '00000000-0000-4000-8000-000000000020',
       'automation:message_example_1'
     )`,
    `UPDATE delivery_operations SET operation_key = 'invalid key with spaces'`,
    `UPDATE delivery_operations SET status = 'CLAIMED'`,
    `UPDATE delivery_operations SET schema_version = 0`,
    `UPDATE delivery_operations SET revision = 0`,
    `UPDATE delivery_operations SET updated_at = created_at - interval '1 second'`,
  ];
  for (const sql of invalidMutations) {
    await assert.rejects(
      database.client.query(sql),
      /violates (foreign key|unique|check) constraint/,
    );
  }
});

void test('canonical audit foundation exposes only bounded actor, action, target metadata', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const columns = await database.client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audit_events'
     ORDER BY ordinal_position`,
  );
  assert.deepEqual(
    columns.rows.map(({ column_name }) => column_name),
    [
      'id',
      'tenant_id',
      'correlation_id',
      'actor_type',
      'actor_id',
      'action',
      'target_type',
      'target_id',
      'created_at',
    ],
  );
  assert.equal(
    columns.rows.some(({ column_name }) =>
      /(credential|session|auth|qr|secret|payload|provider|jid|key|blob)/i.test(column_name),
    ),
    false,
  );
});

void test('canonical audit foundation enforces tenant ownership and bounded safe identifiers', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));
  await database.client.query(
    `INSERT INTO tenants (id, public_ops_id)
     VALUES ('00000000-0000-4000-8000-000000000030', 'ops_example_audit')`,
  );
  await database.client.query(
    `INSERT INTO audit_events (
       id, tenant_id, correlation_id, actor_type, actor_id, action, target_type, target_id
     ) VALUES (
       '00000000-0000-4000-8000-000000000031',
       '00000000-0000-4000-8000-000000000030',
       'correlation_example_1',
       'SYSTEM',
       'worker_example_1',
       'CONFIG_CREATED',
       'AUTOMATION_CONFIG',
       'config_example_1'
     )`,
  );

  const invalidMutations = [
    `INSERT INTO audit_events (
       id, tenant_id, correlation_id, actor_type, action, target_type
     ) VALUES (
       '00000000-0000-4000-8000-000000000032',
       '00000000-0000-4000-8000-000000000099',
       'correlation_example_2',
       'SYSTEM',
       'CONFIG_CREATED',
       'AUTOMATION_CONFIG'
     )`,
    `UPDATE audit_events SET correlation_id = 'invalid correlation'`,
    `UPDATE audit_events SET actor_type = 'invalid-type'`,
    `UPDATE audit_events SET actor_id = 'invalid actor'`,
    `UPDATE audit_events SET action = 'invalid-action'`,
    `UPDATE audit_events SET target_type = 'invalid-type'`,
    `UPDATE audit_events SET target_id = 'invalid target'`,
  ];
  for (const sql of invalidMutations) {
    await assert.rejects(database.client.query(sql), /violates (foreign key|check) constraint/);
  }
});

void test('canonical business foundation adds bounded tenant delivery and audit indexes', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const indexes = await database.client.query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN (
         'delivery_operations_tenant_status_idx',
         'audit_events_tenant_created_idx'
       )
     ORDER BY indexname`,
  );
  assert.deepEqual(
    indexes.rows.map(({ indexname }) => indexname),
    ['audit_events_tenant_created_idx', 'delivery_operations_tenant_status_idx'],
  );
});

void test('versioned migrator adopts an existing idempotent lifecycle schema', async (t) => {
  const database = await createDisposableDatabase(t);
  await database.client.query(readFileSync(lifecycleMigration, 'utf8'));

  await runPostgresMigrations({ client: database.client, migrations });

  const applied = await database.client.query<{ revision: number; name: string }>(
    'SELECT revision, name FROM schema_migrations ORDER BY revision',
  );
  assert.deepEqual(applied.rows, [
    { revision: 1, name: 'worker-lifecycle-states' },
    { revision: 2, name: 'business-foundation' },
  ]);
});

void test('canonical business foundation migration creates tenant, config, delivery, and audit tables', async (t) => {
  const database = await createDisposableDatabase(t);

  await database.client.query(readFileSync(businessMigration, 'utf8'));

  const tables = await database.client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('tenants', 'automation_configs', 'delivery_operations', 'audit_events')
     ORDER BY table_name`,
  );
  assert.deepEqual(
    tables.rows.map(({ table_name }) => table_name),
    ['audit_events', 'automation_configs', 'delivery_operations', 'tenants'],
  );
});

type DisposableDatabase = Readonly<{
  client: Client;
  secondClient: Client;
}>;

async function createDisposableDatabase(t: test.TestContext): Promise<DisposableDatabase> {
  const root = mkdtempSync(join(tmpdir(), 'warlist-pg16-schema-'));
  const dataDirectory = join(root, 'cluster');
  const socketDirectory = join(root, 'socket');
  const port = 20000 + Math.floor(Math.random() * 20000);
  let started = false;
  const connection = {
    host: socketDirectory,
    port,
    user: 'postgres',
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  };
  const client = new Client(connection);
  const secondClient = new Client(connection);
  t.after(async () => {
    await Promise.allSettled([client.end(), secondClient.end()]);
    if (started) {
      runPostgresTool('pg_ctl', ['--pgdata', dataDirectory, '--wait', '--mode', 'fast', 'stop']);
    }
    rmSync(root, { recursive: true, force: true });
  });
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
  await client.connect();
  await secondClient.connect();
  await Promise.all([
    client.query("SET statement_timeout = '5s'"),
    secondClient.query("SET statement_timeout = '5s'"),
  ]);
  return { client, secondClient };
}

function runPostgresTool(name: string, args: readonly string[]): void {
  const result = spawnSync(join(postgresBin, name), args, { encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr}`);
  }
}
