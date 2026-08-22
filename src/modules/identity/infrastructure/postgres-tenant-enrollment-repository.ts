import { Pool } from 'pg';

import {
  EnrollmentError,
  type TenantEnrollment,
  type TenantEnrollmentRepositoryPort,
} from '../application/tenant-enrollment-repository';

type Config = Readonly<{
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statementTimeoutMillis: number;
}>;

export function createPostgresTenantEnrollmentRepository(
  dependencies: Readonly<{
    config: Config;
  }>,
): TenantEnrollmentRepositoryPort & { start(): Promise<void>; stop(): Promise<void> } {
  let pool: Pool | undefined;

  function activePool(): Pool {
    if (!pool) throw new EnrollmentError('ENROLLMENT_GRANT_UNAVAILABLE');
    return pool;
  }

  return {
    async start(): Promise<void> {
      if (pool) return;
      const candidate = new Pool({
        ...dependencies.config,
        statement_timeout: dependencies.config.statementTimeoutMillis,
      });
      try {
        await candidate.query('SELECT 1');
        pool = candidate;
      } catch {
        await candidate.end();
        throw new EnrollmentError('ENROLLMENT_GRANT_UNAVAILABLE');
      }
    },
    async stop(): Promise<void> {
      const current = pool;
      pool = undefined;
      await current?.end();
    },
    async enroll(input): Promise<TenantEnrollment> {
      if (!isInput(input)) throw new EnrollmentError('INVALID_ENROLLMENT_INPUT');
      const client = await activePool().connect();
      try {
        await client.query('BEGIN');
        const grant = await client.query(
          `UPDATE enrollment_grants
           SET used_at = $2::timestamptz
           WHERE id = $1::uuid AND purpose = 'TENANT_ENROLLMENT'
             AND used_at IS NULL AND expires_at > $2::timestamptz
           RETURNING id`,
          [input.grantId, input.now],
        );
        if (grant.rowCount !== 1) throw new EnrollmentError('ENROLLMENT_GRANT_UNAVAILABLE');
        await client.query('INSERT INTO users (id) VALUES ($1::uuid)', [input.userId]);
        await client.query('INSERT INTO tenants (id, public_ops_id) VALUES ($1::uuid, $2)', [
          input.tenantId,
          input.publicOpsId,
        ]);
        await client.query(
          `INSERT INTO tenant_memberships (tenant_id, user_id, role)
           VALUES ($1::uuid, $2::uuid, 'OWNER')`,
          [input.tenantId, input.userId],
        );
        await client.query('COMMIT');
        return Object.freeze({
          userId: input.userId,
          tenantId: input.tenantId,
          publicOpsId: input.publicOpsId,
          role: 'OWNER',
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (error instanceof EnrollmentError) throw error;
        throw new EnrollmentError('ENROLLMENT_GRANT_UNAVAILABLE');
      } finally {
        client.release();
      }
    },
  };
}

function isInput(value: unknown): value is Readonly<{
  grantId: string;
  userId: string;
  tenantId: string;
  publicOpsId: string;
  now: string;
}> {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    isUuid(input.grantId) &&
    isUuid(input.userId) &&
    isUuid(input.tenantId) &&
    typeof input.publicOpsId === 'string' &&
    /^[a-z0-9_]{1,64}$/.test(input.publicOpsId) &&
    typeof input.now === 'string' &&
    Number.isFinite(Date.parse(input.now))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
