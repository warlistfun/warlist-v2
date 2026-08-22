import { Pool } from 'pg';
import { deserialize, serialize } from 'node:v8';

import type { LoggerPort, MetricsPort } from '../../app/ports';
import {
  RepositoryError,
  type AuditEvent,
  type AutomationConfigSyncRecord,
  type AutomationConfigSyncStatus,
  type BusinessRepositoryPort,
  type ConfigRecord,
  type DeliveryAttemptRecord,
  type DeliveryRecord,
  type TenantAuthorizationPort,
  type TenantRecord,
} from '../../app/business-repository';

type QueryResult = Readonly<{ rowCount: number | null; rows: readonly unknown[] }>;

interface PoolPort {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

type PoolOptions = Readonly<{
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
  application_name: string;
}>;

export type PostgresBusinessRepositoryConfig = Readonly<{
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

export function createPostgresBusinessRepository(dependencies: {
  readonly config: unknown;
  readonly authorization: TenantAuthorizationPort;
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly poolFactory?: (options: PoolOptions) => PoolPort;
}): BusinessRepositoryPort {
  const config = parseConfig(dependencies.config);
  const poolFactory = dependencies.poolFactory ?? defaultPoolFactory;
  let pool: PoolPort | undefined;
  let state: 'STOPPED' | 'STARTED' | 'CLEANUP_FAILED' = 'STOPPED';
  let ready = false;
  let transition = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  function authorize(tenantId: string): void {
    if (!isUuid(tenantId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
    dependencies.authorization.assertAuthorized(tenantId);
  }

  function activePool(): PoolPort {
    if (state !== 'STARTED' || !pool) throw new RepositoryError('DATABASE_UNAVAILABLE');
    return pool;
  }

  async function query(
    text: string,
    values?: readonly unknown[],
    expectedError?: (error: unknown) => RepositoryError | undefined,
  ): Promise<QueryResult> {
    try {
      const result = await activePool().query(text, values);
      ready = true;
      metric('database_query_total');
      return result;
    } catch (error) {
      const expected = !(error instanceof RepositoryError) && expectedError?.(error);
      if (expected) {
        ready = true;
        metric('database_query_total');
        throw expected;
      }
      ready = false;
      const mapped = error instanceof RepositoryError ? error : mapDatabaseError(error);
      metric('database_query_failed_total');
      warn(mapped);
      throw mapped;
    }
  }

  async function tenantExists(tenantId: string): Promise<boolean> {
    const result = await query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
    return result.rowCount === 1;
  }

  return {
    start(): Promise<void> {
      return enqueue(async () => {
        if (state === 'STARTED') return;
        if (state === 'CLEANUP_FAILED') {
          throw new RepositoryError('DATABASE_CLEANUP_INCOMPLETE');
        }
        const candidate = poolFactory(toPoolOptions(config));
        pool = candidate;
        try {
          await candidate.query('SELECT 1');
          state = 'STARTED';
          ready = true;
          metric('database_connection_ready_total');
        } catch (error) {
          ready = false;
          const mapped = mapDatabaseError(error);
          warn(mapped);
          try {
            await candidate.end();
            pool = undefined;
            state = 'STOPPED';
          } catch {
            state = 'CLEANUP_FAILED';
            throw new RepositoryError('DATABASE_CLEANUP_INCOMPLETE');
          }
          throw mapped;
        }
      });
    },
    stop(): Promise<void> {
      return enqueue(async () => {
        if (state === 'STOPPED' && !pool) return;
        ready = false;
        try {
          await pool?.end();
          pool = undefined;
          state = 'STOPPED';
        } catch {
          state = 'CLEANUP_FAILED';
          const error = new RepositoryError('DATABASE_CLEANUP_INCOMPLETE');
          warn(error);
          throw error;
        }
      });
    },
    async isReady(): Promise<boolean> {
      if (state !== 'STARTED' || !pool) return false;
      try {
        await pool.query('SELECT 1');
        ready = true;
        metric('database_readiness_success_total');
      } catch (error) {
        ready = false;
        metric('database_readiness_failure_total');
        warn(mapDatabaseError(error));
      }
      return ready;
    },
    async createTenant(input): Promise<TenantRecord> {
      authorize(input.id);
      if (!isPublicOpsId(input.publicOpsId)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `INSERT INTO tenants (id, public_ops_id)
         VALUES ($1, $2)
         RETURNING id, public_ops_id, status, schema_version, revision, created_at, updated_at`,
        [input.id, input.publicOpsId],
        (error) =>
          postgresCode(error) === '23505'
            ? new RepositoryError('TENANT_ALREADY_EXISTS')
            : undefined,
      );
      return parseSingle(result, parseTenant);
    },
    async loadTenant(tenantId): Promise<TenantRecord | undefined> {
      authorize(tenantId);
      const result = await query(
        `SELECT id, public_ops_id, status, schema_version, revision, created_at, updated_at
         FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return parseOptional(result, parseTenant);
    },
    async loadConfig(tenantId): Promise<ConfigRecord | undefined> {
      authorize(tenantId);
      const result = await query(
        `SELECT tenant_id, configuration, schema_version, revision, created_at, updated_at
         FROM automation_configs WHERE tenant_id = $1`,
        [tenantId],
      );
      return parseOptional(result, parseConfigRecord);
    },
    async compareAndSaveConfig(input, expectedRevision): Promise<ConfigRecord> {
      authorize(input.tenantId);
      if (!isJsonObject(input.configuration) || !isExpectedRevision(expectedRevision)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const serialized = JSON.stringify(input.configuration);
      const result =
        expectedRevision === null
          ? await query(
              `INSERT INTO automation_configs (tenant_id, configuration)
               SELECT id, $2::jsonb FROM tenants WHERE id = $1
               ON CONFLICT (tenant_id) DO NOTHING
               RETURNING tenant_id, configuration, schema_version, revision, created_at, updated_at`,
              [input.tenantId, serialized],
            )
          : await query(
              `UPDATE automation_configs
               SET configuration = $2::jsonb, revision = revision + 1, updated_at = now()
               WHERE tenant_id = $1 AND revision = $3
               RETURNING tenant_id, configuration, schema_version, revision, created_at, updated_at`,
              [input.tenantId, serialized, expectedRevision],
            );
      if (result.rowCount !== 1) {
        if (!(await tenantExists(input.tenantId))) throw new RepositoryError('TENANT_NOT_FOUND');
        throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      }
      return parseSingle(result, parseConfigRecord);
    },
    async compareAndSaveConfigWithSync(input, expectedRevision) {
      authorize(input.tenantId);
      if (!isJsonObject(input.configuration) || !isExpectedRevision(expectedRevision)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `WITH saved AS (
           ${
             expectedRevision === null
               ? `INSERT INTO automation_configs (tenant_id, configuration)
                  SELECT id, $2::jsonb FROM tenants WHERE id = $1
                  ON CONFLICT (tenant_id) DO NOTHING
                  RETURNING tenant_id, configuration, schema_version, revision, created_at, updated_at`
               : `UPDATE automation_configs
                  SET configuration = $2::jsonb, revision = revision + 1, updated_at = now()
                  WHERE tenant_id = $1 AND revision = $3
                  RETURNING tenant_id, configuration, schema_version, revision, created_at, updated_at`
           }
         ), sync AS (
           INSERT INTO automation_config_sync_outbox (tenant_id, config_revision)
           SELECT tenant_id, revision FROM saved
           RETURNING tenant_id, config_revision, status, attempts, claim_token, lease_until, failure_code, next_attempt_at
         )
         SELECT row_to_json(saved) AS config, row_to_json(sync) AS sync FROM saved JOIN sync USING (tenant_id)`,
        expectedRevision === null
          ? [input.tenantId, JSON.stringify(input.configuration)]
          : [input.tenantId, JSON.stringify(input.configuration), expectedRevision],
      );
      if (result.rowCount !== 1) {
        if (!(await tenantExists(input.tenantId))) throw new RepositoryError('TENANT_NOT_FOUND');
        throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      }
      const row = result.rows[0];
      if (!isRecord(row)) throw new RepositoryError('DATABASE_ROW_INVALID');
      const config = parseConfigRecord(row.config);
      const sync = parseAutomationConfigSync(row.sync);
      if (!config || !sync) throw new RepositoryError('DATABASE_ROW_INVALID');
      return Object.freeze({ config, sync });
    },
    async readAutomationConfigSync(tenantId, configRevision) {
      authorize(tenantId);
      if (!isPositiveInteger(configRevision)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `SELECT tenant_id, config_revision, status, attempts, claim_token, lease_until, failure_code, next_attempt_at
         FROM automation_config_sync_outbox WHERE tenant_id = $1 AND config_revision = $2`,
        [tenantId, configRevision],
      );
      return parseOptional(result, parseAutomationConfigSync);
    },
    async claimDueAutomationConfigSyncs(input) {
      if (!isClaimInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `WITH due AS (
           SELECT tenant_id, config_revision FROM automation_config_sync_outbox
           WHERE status = 'PENDING'
              OR (status = 'RETRYABLE_FAILURE' AND next_attempt_at <= $2::timestamptz)
              OR (status = 'IN_FLIGHT' AND lease_until <= $2::timestamptz)
           ORDER BY tenant_id, config_revision
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE automation_config_sync_outbox outbox
         SET status = 'IN_FLIGHT', attempts = attempts + 1, claim_token = $3,
             lease_until = $4::timestamptz, failure_code = NULL, next_attempt_at = NULL
         FROM due
         WHERE (outbox.tenant_id, outbox.config_revision) = (due.tenant_id, due.config_revision)
         RETURNING outbox.tenant_id, outbox.config_revision, outbox.status, outbox.attempts,
                   outbox.claim_token, outbox.lease_until, outbox.failure_code, outbox.next_attempt_at`,
        [input.limit, input.now, input.claimToken, input.leaseUntil],
      );
      return Object.freeze(result.rows.map((row) => parseRow(row, parseAutomationConfigSync)));
    },
    async markAutomationConfigSyncApplied(input) {
      authorize(input.tenantId);
      if (!isSettlementInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `UPDATE automation_config_sync_outbox
         SET status = 'APPLIED', claim_token = NULL, lease_until = NULL
         WHERE tenant_id = $1 AND config_revision = $2 AND status = 'IN_FLIGHT' AND claim_token = $3
         RETURNING tenant_id, config_revision, status, attempts, claim_token, lease_until, failure_code, next_attempt_at`,
        [input.tenantId, input.configRevision, input.claimToken],
      );
      if (result.rowCount !== 1) throw new RepositoryError('AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT');
      return parseSingle(result, parseAutomationConfigSync);
    },
    async recordAutomationConfigSyncFailure(input) {
      authorize(input.tenantId);
      if (!isFailureInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `UPDATE automation_config_sync_outbox
         SET status = $4, claim_token = NULL, lease_until = NULL, failure_code = $5,
             next_attempt_at = $6::timestamptz
         WHERE tenant_id = $1 AND config_revision = $2 AND status = 'IN_FLIGHT' AND claim_token = $3
         RETURNING tenant_id, config_revision, status, attempts, claim_token, lease_until, failure_code, next_attempt_at`,
        [
          input.tenantId,
          input.configRevision,
          input.claimToken,
          input.retryable ? 'RETRYABLE_FAILURE' : 'NON_RETRYABLE_FAILURE',
          input.failureCode,
          input.nextAttemptAt,
        ],
      );
      if (result.rowCount !== 1) throw new RepositoryError('AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT');
      return parseSingle(result, parseAutomationConfigSync);
    },
    async prepareDelivery(input): Promise<DeliveryRecord> {
      authorize(input.tenantId);
      if (!isUuid(input.id) || !isIdentifier(input.operationKey, false)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `INSERT INTO delivery_operations (id, tenant_id, operation_key)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id, operation_key, status, schema_version, revision,
                   created_at, updated_at`,
        [input.id, input.tenantId, input.operationKey],
        (error) => {
          const code = postgresCode(error);
          if (code === '23505') return new RepositoryError('DELIVERY_ALREADY_EXISTS');
          if (code === '23503') return new RepositoryError('TENANT_NOT_FOUND');
          return undefined;
        },
      );
      return parseSingle(result, parseDelivery);
    },
    async loadDelivery(tenantId, deliveryId): Promise<DeliveryRecord | undefined> {
      authorize(tenantId);
      if (!isUuid(deliveryId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `SELECT id, tenant_id, operation_key, status, schema_version, revision,
                created_at, updated_at
         FROM delivery_operations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, deliveryId],
      );
      return parseOptional(result, parseDelivery);
    },
    async createDeliveryAttempt(input): Promise<DeliveryAttemptRecord> {
      authorize(input.tenantId);
      if (
        !isUuid(input.id) ||
        !isUuid(input.operationId) ||
        !isPositiveInteger(input.attemptNumber)
      ) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `INSERT INTO delivery_attempts (id, tenant_id, operation_id, attempt_number)
         SELECT $1, $2, id, $4 FROM delivery_operations WHERE tenant_id = $2 AND id = $3
         RETURNING id, tenant_id, operation_id, attempt_number, status, schema_version, revision,
                   created_at, updated_at`,
        [input.id, input.tenantId, input.operationId, input.attemptNumber],
        (error) =>
          postgresCode(error) === '23505'
            ? new RepositoryError('DELIVERY_ALREADY_EXISTS')
            : undefined,
      );
      if (result.rowCount !== 1) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      return parseSingle(result, parseDeliveryAttempt);
    },
    async loadDeliveryAttempt(tenantId, attemptId): Promise<DeliveryAttemptRecord | undefined> {
      authorize(tenantId);
      if (!isUuid(attemptId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `SELECT id, tenant_id, operation_id, attempt_number, status, schema_version, revision,
                created_at, updated_at
         FROM delivery_attempts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, attemptId],
      );
      return parseOptional(result, parseDeliveryAttempt);
    },
    async appendAuditEvent(input): Promise<AuditEvent> {
      authorize(input.tenantId);
      if (!isAuditInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `INSERT INTO audit_events
           (id, tenant_id, correlation_id, actor_type, actor_id, action, target_type, target_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tenant_id, correlation_id, actor_type, actor_id, action,
                   target_type, target_id, created_at`,
        [
          input.id,
          input.tenantId,
          input.correlationId,
          input.actorType,
          input.actorId,
          input.action,
          input.targetType,
          input.targetId,
        ],
        (error) => {
          const code = postgresCode(error);
          if (code === '23505') return new RepositoryError('AUDIT_EVENT_ALREADY_EXISTS');
          if (code === '23503') return new RepositoryError('TENANT_NOT_FOUND');
          return undefined;
        },
      );
      return parseSingle(result, parseAuditEvent);
    },
    async readAuditEvents(tenantId, limit): Promise<readonly AuditEvent[]> {
      authorize(tenantId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `SELECT id, tenant_id, correlation_id, actor_type, actor_id, action,
                target_type, target_id, created_at
         FROM audit_events
         WHERE tenant_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [tenantId, limit],
      );
      return Object.freeze(result.rows.map((row) => parseRow(row, parseAuditEvent)));
    },
  };

  function metric(name: string): void {
    try {
      dependencies.metrics.increment(name);
    } catch {
      // Telemetry is best-effort and cannot alter repository behavior.
    }
  }

  function warn(error: RepositoryError): void {
    try {
      dependencies.logger.warn('Database operation failed', { code: error.code });
    } catch {
      // Logging is best-effort and must not leak or replace the safe error.
    }
  }
}

function defaultPoolFactory(options: PoolOptions): PoolPort {
  const pool = new Pool(options);
  return {
    query(text, values): Promise<QueryResult> {
      return values ? pool.query(text, [...values]) : pool.query(text);
    },
    end(): Promise<void> {
      return pool.end();
    },
  };
}

function parseConfig(input: unknown): PostgresBusinessRepositoryConfig {
  if (!isRecord(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
  const {
    host,
    port,
    user,
    password,
    database,
    ssl,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    statementTimeoutMillis,
  } = input;
  if (
    !isNonEmptyString(host, 255) ||
    !isIntegerBetween(port, 1, 65_535) ||
    !isNonEmptyString(user, 128) ||
    typeof password !== 'string' ||
    password.length > 4_096 ||
    !isNonEmptyString(database, 128) ||
    typeof ssl !== 'boolean' ||
    !isIntegerBetween(max, 1, 20) ||
    !isIntegerBetween(connectionTimeoutMillis, 100, 10_000) ||
    !isIntegerBetween(idleTimeoutMillis, 100, 60_000) ||
    !isIntegerBetween(statementTimeoutMillis, 100, 30_000)
  ) {
    throw new RepositoryError('INVALID_REPOSITORY_INPUT');
  }
  return {
    host,
    port,
    user,
    password,
    database,
    ssl,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    statementTimeoutMillis,
  };
}

function toPoolOptions(config: PostgresBusinessRepositoryConfig): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    max: config.max,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    application_name: 'warlist-v2',
  };
}

function mapDatabaseError(error: unknown): RepositoryError {
  return new RepositoryError(
    postgresCode(error) === '57014' ? 'DATABASE_TIMEOUT' : 'DATABASE_UNAVAILABLE',
  );
}

function postgresCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function parseSingle<T>(result: QueryResult, parser: (row: unknown) => T | undefined): T {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new RepositoryError('DATABASE_ROW_INVALID');
  }
  return parseRow(result.rows[0], parser);
}

function parseOptional<T>(
  result: QueryResult,
  parser: (row: unknown) => T | undefined,
): T | undefined {
  if (result.rowCount === 0 && result.rows.length === 0) return undefined;
  return parseSingle(result, parser);
}

function parseRow<T>(row: unknown, parser: (row: unknown) => T | undefined): T {
  const parsed = parser(row);
  if (!parsed) throw new RepositoryError('DATABASE_ROW_INVALID');
  return parsed;
}

function parseTenant(row: unknown): TenantRecord | undefined {
  if (!isRecord(row)) return undefined;
  const revision = positiveInteger(row.revision);
  const schemaVersion = positiveInteger(row.schema_version);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (
    !isUuid(row.id) ||
    !isPublicOpsId(row.public_ops_id) ||
    !isTenantStatus(row.status) ||
    !revision ||
    !schemaVersion ||
    !createdAt ||
    !updatedAt ||
    updatedAt < createdAt
  ) {
    return undefined;
  }
  return Object.freeze({
    id: row.id,
    publicOpsId: row.public_ops_id,
    status: row.status,
    schemaVersion,
    revision,
    createdAt,
    updatedAt,
  });
}

function parseConfigRecord(row: unknown): ConfigRecord | undefined {
  if (!isRecord(row)) return undefined;
  const revision = positiveInteger(row.revision);
  const schemaVersion = positiveInteger(row.schema_version);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (
    !isUuid(row.tenant_id) ||
    !isJsonObject(row.configuration) ||
    !revision ||
    !schemaVersion ||
    !createdAt ||
    !updatedAt ||
    updatedAt < createdAt
  ) {
    return undefined;
  }
  return Object.freeze({
    tenantId: row.tenant_id,
    configuration: cloneAndFreezeJson(row.configuration),
    schemaVersion,
    revision,
    createdAt,
    updatedAt,
  });
}

function parseAutomationConfigSync(row: unknown): AutomationConfigSyncRecord | undefined {
  if (!isRecord(row)) return undefined;
  const configRevision = positiveInteger(row.config_revision);
  const attempts = nonNegativeInteger(row.attempts);
  const claimToken =
    row.claim_token === null
      ? null
      : isIdentifier(row.claim_token, false)
        ? row.claim_token
        : undefined;
  const leaseUntil = row.lease_until === null ? null : timestamp(row.lease_until);
  const failureCode =
    row.failure_code === null
      ? null
      : isIdentifier(row.failure_code, true)
        ? row.failure_code
        : undefined;
  const nextAttemptAt = row.next_attempt_at === null ? null : timestamp(row.next_attempt_at);
  if (
    !isUuid(row.tenant_id) ||
    !configRevision ||
    !isAutomationConfigSyncStatus(row.status) ||
    attempts === undefined ||
    claimToken === undefined ||
    leaseUntil === undefined ||
    failureCode === undefined ||
    nextAttemptAt === undefined
  )
    return undefined;
  return Object.freeze({
    tenantId: row.tenant_id,
    configRevision,
    status: row.status,
    attempts,
    claimToken,
    leaseUntil,
    failureCode,
    nextAttemptAt,
  });
}

function parseDelivery(row: unknown): DeliveryRecord | undefined {
  if (!isRecord(row)) return undefined;
  const revision = positiveInteger(row.revision);
  const schemaVersion = positiveInteger(row.schema_version);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isIdentifier(row.operation_key, false) ||
    !isDeliveryStatus(row.status) ||
    !revision ||
    !schemaVersion ||
    !createdAt ||
    !updatedAt ||
    updatedAt < createdAt
  ) {
    return undefined;
  }
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    operationKey: row.operation_key,
    status: row.status,
    schemaVersion,
    revision,
    createdAt,
    updatedAt,
  });
}

function parseDeliveryAttempt(row: unknown): DeliveryAttemptRecord | undefined {
  if (!isRecord(row)) return undefined;
  const attemptNumber = positiveInteger(row.attempt_number);
  const revision = positiveInteger(row.revision);
  const schemaVersion = positiveInteger(row.schema_version);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isUuid(row.operation_id) ||
    !attemptNumber ||
    !isDeliveryAttemptStatus(row.status) ||
    !revision ||
    !schemaVersion ||
    !createdAt ||
    !updatedAt ||
    updatedAt < createdAt
  )
    return undefined;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    operationId: row.operation_id,
    attemptNumber,
    status: row.status,
    schemaVersion,
    revision,
    createdAt,
    updatedAt,
  });
}

function parseAuditEvent(row: unknown): AuditEvent | undefined {
  if (!isRecord(row)) return undefined;
  const createdAt = timestamp(row.created_at);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isIdentifier(row.correlation_id, false) ||
    !isIdentifier(row.actor_type, true) ||
    (row.actor_id !== null && !isIdentifier(row.actor_id, false)) ||
    !isIdentifier(row.action, true) ||
    !isIdentifier(row.target_type, true) ||
    (row.target_id !== null && !isIdentifier(row.target_id, false)) ||
    !createdAt
  ) {
    return undefined;
  }
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    correlationId: row.correlation_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt,
  });
}

function isAuditInput(value: Readonly<Omit<AuditEvent, 'createdAt'>>): boolean {
  return (
    isUuid(value.id) &&
    isUuid(value.tenantId) &&
    isIdentifier(value.correlationId, false) &&
    isIdentifier(value.actorType, true) &&
    (value.actorId === null || isIdentifier(value.actorId, false)) &&
    isIdentifier(value.action, true) &&
    isIdentifier(value.targetType, true) &&
    (value.targetId === null || isIdentifier(value.targetId, false))
  );
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value) || !isJsonValue(value, 0)) return false;
  try {
    return serialize(value).byteLength <= 65_536;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function cloneAndFreezeJson(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze(deserialize(serialize(value)) as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isPublicOpsId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value);
}

function isIdentifier(value: unknown, upperCase: boolean): value is string {
  return (
    typeof value === 'string' &&
    (upperCase ? /^[A-Z][A-Z0-9_]{0,63}$/ : /^[a-z0-9_:-]{1,160}$/).test(value)
  );
}

function isTenantStatus(value: unknown): value is TenantRecord['status'] {
  return value === 'ACTIVE' || value === 'INACTIVE' || value === 'DELETING' || value === 'DELETED';
}

function isDeliveryStatus(value: unknown): value is DeliveryRecord['status'] {
  return (
    value === 'PREPARED' ||
    value === 'CLAIMED' ||
    value === 'SENT' ||
    value === 'AMBIGUOUS' ||
    value === 'CONFIRMED'
  );
}

function isDeliveryAttemptStatus(value: unknown): value is DeliveryAttemptRecord['status'] {
  return value === 'PREPARED' || value === 'SENT' || value === 'AMBIGUOUS';
}

function isExpectedRevision(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && typeof value === 'number' && value > 0);
}

function isClaimInput(
  value: unknown,
): value is Readonly<{ limit: number; now: string; leaseUntil: string; claimToken: string }> {
  return (
    isRecord(value) &&
    isIntegerBetween(value.limit, 1, 100) &&
    timestamp(value.now) !== undefined &&
    timestamp(value.leaseUntil) !== undefined &&
    Date.parse(value.leaseUntil as string) > Date.parse(value.now as string) &&
    isIdentifier(value.claimToken, false)
  );
}

function isSettlementInput(
  value: unknown,
): value is Readonly<{ tenantId: string; configRevision: number; claimToken: string }> {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    isPositiveInteger(value.configRevision) &&
    isIdentifier(value.claimToken, false)
  );
}

function isFailureInput(value: unknown): value is Readonly<{
  tenantId: string;
  configRevision: number;
  claimToken: string;
  retryable: boolean;
  failureCode: string;
  nextAttemptAt: string | null;
}> {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    isPositiveInteger(value.configRevision) &&
    isIdentifier(value.claimToken, false) &&
    typeof value.retryable === 'boolean' &&
    isIdentifier(value.failureCode, true) &&
    (value.retryable ? timestamp(value.nextAttemptAt) !== undefined : value.nextAttemptAt === null)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isAutomationConfigSyncStatus(value: unknown): value is AutomationConfigSyncStatus {
  return (
    value === 'PENDING' ||
    value === 'IN_FLIGHT' ||
    value === 'APPLIED' ||
    value === 'RETRYABLE_FAILURE' ||
    value === 'NON_RETRYABLE_FAILURE'
  );
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
    ? number
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}
