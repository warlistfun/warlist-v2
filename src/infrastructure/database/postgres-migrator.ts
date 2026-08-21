import { createHash } from 'node:crypto';

export type PostgresMigration = Readonly<{
  revision: number;
  name: string;
  sql: string;
}>;

interface QueryablePort {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rowCount: number | null;
    readonly rows: readonly unknown[];
  }>;
}

const migrationLock = 2_026_081_804;

export async function runPostgresMigrations(dependencies: {
  readonly client: QueryablePort;
  readonly migrations: readonly PostgresMigration[];
}): Promise<void> {
  validateMigrations(dependencies.migrations);
  await dependencies.client.query('BEGIN');
  try {
    await dependencies.client.query('SELECT pg_advisory_xact_lock($1::bigint)', [migrationLock]);
    await dependencies.client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      revision integer PRIMARY KEY CHECK (revision > 0),
      name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9-]+$'),
      checksum character(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await loadAppliedMigrations(dependencies.client);
    for (const migration of dependencies.migrations) {
      const checksum = sha256(migration.sql);
      const current = applied.get(migration.revision);
      if (current) {
        if (current.name !== migration.name || current.checksum !== checksum) {
          throw new Error(
            `migration revision ${migration.revision} does not match applied checksum`,
          );
        }
        continue;
      }
      await dependencies.client.query(migration.sql);
      await dependencies.client.query(
        'INSERT INTO schema_migrations (revision, name, checksum) VALUES ($1, $2, $3)',
        [migration.revision, migration.name, checksum],
      );
    }
    await dependencies.client.query('COMMIT');
  } catch (error) {
    try {
      await dependencies.client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'PostgreSQL migration and rollback failed');
    }
    throw error;
  }
}

function validateMigrations(migrations: readonly PostgresMigration[]): void {
  let previousRevision = 0;
  const names = new Set<string>();
  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.revision) ||
      migration.revision <= previousRevision ||
      !/^[a-z0-9-]+$/.test(migration.name) ||
      migration.sql.trim().length === 0 ||
      names.has(migration.name)
    ) {
      throw new Error('invalid PostgreSQL migration list');
    }
    previousRevision = migration.revision;
    names.add(migration.name);
  }
}

async function loadAppliedMigrations(
  client: QueryablePort,
): Promise<Map<number, Readonly<{ name: string; checksum: string }>>> {
  const result = await client.query(
    'SELECT revision, name, checksum FROM schema_migrations ORDER BY revision',
  );
  const applied = new Map<number, Readonly<{ name: string; checksum: string }>>();
  for (const row of result.rows) {
    if (!isRecord(row)) {
      throw new Error('invalid schema migration row');
    }
    const { revision, name, checksum } = row;
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision <= 0 ||
      typeof name !== 'string' ||
      !/^[a-z0-9-]+$/.test(name) ||
      typeof checksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      applied.has(revision)
    ) {
      throw new Error('invalid schema migration row');
    }
    applied.set(revision, { name, checksum });
  }
  return applied;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
