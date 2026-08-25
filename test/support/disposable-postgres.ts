import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type test from 'node:test';

import { Client } from 'pg';

import { runPostgresMigrations } from '../../src/infrastructure/database/postgres-migrator';

const postgresBin = '/usr/lib/postgresql/16/bin';
const migrations = [
  {
    revision: 1,
    name: 'worker-lifecycle-states',
    sql: readFileSync(resolve('migrations/0001-worker-lifecycle-states.sql'), 'utf8'),
  },
  {
    revision: 2,
    name: 'business-foundation',
    sql: readFileSync(resolve('migrations/0002-business-foundation.sql'), 'utf8'),
  },
  {
    revision: 3,
    name: 'automation-config-sync-outbox',
    sql: readFileSync(resolve('migrations/0003-automation-config-sync-outbox.sql'), 'utf8'),
  },
  {
    revision: 4,
    name: 'delivery-attempt-foundation',
    sql: readFileSync(resolve('migrations/0004-delivery-attempt-foundation.sql'), 'utf8'),
  },
  {
    revision: 5,
    name: 'delivery-claim-lease',
    sql: readFileSync(resolve('migrations/0005-delivery-claim-lease.sql'), 'utf8'),
  },
  {
    revision: 6,
    name: 'delivery-settlement',
    sql: readFileSync(resolve('migrations/0006-delivery-settlement.sql'), 'utf8'),
  },
  {
    revision: 7,
    name: 'entitlement-ledger',
    sql: readFileSync(resolve('migrations/0007-entitlement-ledger.sql'), 'utf8'),
  },
  {
    revision: 8,
    name: 'delivery-confirmation',
    sql: readFileSync(resolve('migrations/0008-delivery-confirmation.sql'), 'utf8'),
  },
  {
    revision: 9,
    name: 'identity-tenant-enrollment',
    sql: readFileSync(resolve('migrations/0009-identity-tenant-enrollment.sql'), 'utf8'),
  },
  {
    revision: 10,
    name: 'worker-lifecycle-revision',
    sql: readFileSync(resolve('migrations/0010-worker-lifecycle-revision.sql'), 'utf8'),
  },
] as const;

export type DisposablePostgres = Readonly<{
  config: Readonly<{
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: false;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    statementTimeoutMillis: number;
  }>;
}>;

export async function createDisposablePostgres(
  t: test.TestContext,
  prefix = 'warlist-pg16-business-',
): Promise<DisposablePostgres> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dataDirectory = join(root, 'cluster');
  const host = join(root, 'socket');
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  let started = false;
  const client = new Client({ host, port, user: 'postgres', database: 'postgres' });

  t.after(async () => {
    await client.end().catch(() => undefined);
    if (started) runTool('pg_ctl', ['--pgdata', dataDirectory, '--wait', '--mode', 'fast', 'stop']);
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(host);
  runTool('initdb', [
    '--no-sync',
    '--auth=trust',
    '--username=postgres',
    '--pgdata',
    dataDirectory,
  ]);
  runTool('pg_ctl', [
    '--pgdata',
    dataDirectory,
    '--wait',
    '--options',
    `-k ${host} -p ${port}`,
    'start',
  ]);
  started = true;
  await client.connect();
  await runPostgresMigrations({ client, migrations });

  return {
    config: {
      host,
      port,
      user: 'postgres',
      password: '',
      database: 'postgres',
      ssl: false,
      max: 4,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 5_000,
      statementTimeoutMillis: 2_000,
    },
  };
}

function runTool(name: string, args: readonly string[]): void {
  const result = spawnSync(join(postgresBin, name), args, {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}`);
}
