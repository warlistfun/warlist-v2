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
  type DeliveryClaimRecord,
  type DeliveryClaimRepositoryPort,
  type DeliveryRecord,
  type EntitlementBalance,
  type EntitlementEntryType,
  type EntitlementLedgerEntry,
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
}): BusinessRepositoryPort & DeliveryClaimRepositoryPort {
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
         RETURNING id, tenant_id, operation_key, status, claim_owner, claim_fence,
                   claim_lease_until, worker_generation, worker_child_id, schema_version, revision,
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
        `SELECT id, tenant_id, operation_key, status, claim_owner, claim_fence,
                claim_lease_until, worker_generation, worker_child_id, schema_version, revision,
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
         RETURNING id, tenant_id, operation_id, attempt_number, status, claim_fence,
                   schema_version, revision,
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
        `SELECT id, tenant_id, operation_id, attempt_number, status, claim_fence, provider_message_id,
                schema_version, revision,
                created_at, updated_at
         FROM delivery_attempts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, attemptId],
      );
      return parseOptional(result, parseDeliveryAttempt);
    },
    async claimDelivery(input): Promise<DeliveryClaimRecord> {
      authorize(input.tenantId);
      if (!isDeliveryClaimInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `WITH recovered AS (
           UPDATE delivery_operations
           SET status = 'AMBIGUOUS', revision = revision + 1, updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND status = 'SENDING'
             AND claim_lease_until <= $5::timestamptz
         ), current_worker AS (
           SELECT tenant_id
           FROM tenant_worker_ownerships
           WHERE tenant_id = $1 AND state = 'RUNNING' AND quarantined = false
             AND generation = $7 AND child_id = $8
           FOR SHARE
         ), claimed AS (
           UPDATE delivery_operations AS operation
           SET status = 'CLAIMED', claim_owner = $4,
               claim_fence = operation.claim_fence + 1,
               claim_lease_until = $6::timestamptz,
               worker_generation = $7, worker_child_id = $8,
               revision = operation.revision + 1, updated_at = now()
           FROM current_worker
           WHERE operation.tenant_id = current_worker.tenant_id
             AND operation.tenant_id = $1 AND operation.id = $2
             AND (operation.status = 'PREPARED'
               OR (operation.status = 'CLAIMED'
                 AND operation.claim_lease_until <= $5::timestamptz))
           RETURNING operation.*
         ), created_attempt AS (
           INSERT INTO delivery_attempts
             (id, tenant_id, operation_id, attempt_number, claim_fence)
           SELECT $3, claimed.tenant_id, claimed.id,
                  COALESCE((SELECT max(attempt_number) + 1 FROM delivery_attempts
                            WHERE tenant_id = claimed.tenant_id AND operation_id = claimed.id), 1),
                  claimed.claim_fence
           FROM claimed
           RETURNING *
         )
         SELECT claimed.id AS operation_id, claimed.tenant_id, claimed.operation_key,
                claimed.status AS operation_status, claimed.claim_owner, claimed.claim_fence,
                claimed.claim_lease_until, claimed.worker_generation, claimed.worker_child_id,
                claimed.schema_version AS operation_schema_version,
                claimed.revision AS operation_revision,
                claimed.created_at AS operation_created_at,
                claimed.updated_at AS operation_updated_at,
                created_attempt.id AS attempt_id, created_attempt.attempt_number,
                created_attempt.status AS attempt_status,
                created_attempt.claim_fence AS attempt_claim_fence,
                created_attempt.schema_version AS attempt_schema_version,
                created_attempt.revision AS attempt_revision,
                created_attempt.created_at AS attempt_created_at,
                created_attempt.updated_at AS attempt_updated_at
         FROM claimed JOIN created_attempt ON created_attempt.operation_id = claimed.id`,
        [
          input.tenantId,
          input.operationId,
          input.attemptId,
          input.claimOwner,
          input.now,
          input.leaseUntil,
          input.workerGeneration,
          input.childId,
        ],
        (error) =>
          postgresCode(error) === '23505'
            ? new RepositoryError('DELIVERY_CLAIM_CONFLICT')
            : undefined,
      );
      if (result.rowCount !== 1) throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
      return parseSingle(result, parseDeliveryClaim);
    },
    async beginDelivery(input): Promise<DeliveryClaimRecord> {
      authorize(input.tenantId);
      if (!isDeliverySettlementInput({ ...input, outcome: 'AMBIGUOUS', providerMessageId: null })) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const result = await query(
        `WITH begun_operation AS (
          UPDATE delivery_operations AS operation
          SET status = 'SENDING', revision = operation.revision + 1, updated_at = now()
          FROM delivery_attempts AS attempt, tenant_worker_ownerships AS worker
          WHERE operation.tenant_id = $1 AND operation.id = $2 AND operation.status = 'CLAIMED'
            AND operation.claim_fence = $4 AND operation.worker_generation = $5 AND operation.worker_child_id = $6
            AND worker.tenant_id = operation.tenant_id
            AND worker.state = 'RUNNING' AND worker.quarantined = false
            AND worker.generation = $5 AND worker.child_id = $6
            AND attempt.tenant_id = operation.tenant_id AND attempt.operation_id = operation.id
            AND attempt.id = $3 AND attempt.status = 'PREPARED' AND attempt.claim_fence = operation.claim_fence
          RETURNING operation.*
        )
         SELECT operation.id AS operation_id, operation.tenant_id, operation.operation_key,
                operation.status AS operation_status, operation.claim_owner, operation.claim_fence,
                operation.claim_lease_until, operation.worker_generation, operation.worker_child_id,
                operation.schema_version AS operation_schema_version, operation.revision AS operation_revision,
                operation.created_at AS operation_created_at, operation.updated_at AS operation_updated_at,
                attempt.id AS attempt_id, attempt.attempt_number, attempt.status AS attempt_status,
                attempt.claim_fence AS attempt_claim_fence, attempt.provider_message_id,
                attempt.schema_version AS attempt_schema_version, attempt.revision AS attempt_revision,
                attempt.created_at AS attempt_created_at, attempt.updated_at AS attempt_updated_at
         FROM begun_operation AS operation JOIN delivery_attempts AS attempt
           ON attempt.tenant_id = operation.tenant_id AND attempt.operation_id = operation.id AND attempt.id = $3`,
        [
          input.tenantId,
          input.operationId,
          input.attemptId,
          input.claimFence,
          input.workerGeneration,
          input.childId,
        ],
      );
      if (result.rowCount !== 1) throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
      return parseSingle(result, parseDeliveryClaim);
    },
    async settleDelivery(input): Promise<DeliveryClaimRecord> {
      authorize(input.tenantId);
      if (!isDeliverySettlementInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const result = await query(
        `WITH settled_operation AS (
          UPDATE delivery_operations AS operation
          SET status = $7, revision = operation.revision + 1, updated_at = now()
          FROM delivery_attempts AS attempt, tenant_worker_ownerships AS worker
          WHERE operation.tenant_id = $1 AND operation.id = $2 AND operation.status = 'SENDING'
            AND operation.claim_fence = $4 AND operation.worker_generation = $5 AND operation.worker_child_id = $6
            AND worker.tenant_id = operation.tenant_id
            AND worker.state = 'RUNNING' AND worker.quarantined = false
            AND worker.generation = $5 AND worker.child_id = $6
            AND attempt.tenant_id = operation.tenant_id AND attempt.operation_id = operation.id
            AND attempt.id = $3 AND attempt.status = 'PREPARED' AND attempt.claim_fence = operation.claim_fence
          RETURNING operation.*
        ), settled_attempt AS (
          UPDATE delivery_attempts AS attempt
          SET status = $7, provider_message_id = $8, revision = attempt.revision + 1, updated_at = now()
          FROM settled_operation AS operation
          WHERE attempt.tenant_id = operation.tenant_id AND attempt.operation_id = operation.id
            AND attempt.id = $3 AND attempt.status = 'PREPARED' AND attempt.claim_fence = operation.claim_fence
          RETURNING attempt.*
        )
         SELECT operation.id AS operation_id, operation.tenant_id, operation.operation_key,
                operation.status AS operation_status, operation.claim_owner, operation.claim_fence,
                operation.claim_lease_until, operation.worker_generation, operation.worker_child_id,
                operation.schema_version AS operation_schema_version, operation.revision AS operation_revision,
                operation.created_at AS operation_created_at, operation.updated_at AS operation_updated_at,
                attempt.id AS attempt_id, attempt.attempt_number, attempt.status AS attempt_status,
                attempt.claim_fence AS attempt_claim_fence, attempt.provider_message_id,
                attempt.schema_version AS attempt_schema_version, attempt.revision AS attempt_revision,
                attempt.created_at AS attempt_created_at, attempt.updated_at AS attempt_updated_at
         FROM settled_operation AS operation JOIN settled_attempt AS attempt ON attempt.operation_id = operation.id`,
        [
          input.tenantId,
          input.operationId,
          input.attemptId,
          input.claimFence,
          input.workerGeneration,
          input.childId,
          input.outcome,
          input.providerMessageId,
        ],
      );
      if (result.rowCount !== 1) throw new RepositoryError('DELIVERY_CLAIM_CONFLICT');
      return parseSingle(result, parseDeliveryClaim);
    },
    async appendEntitlementLedgerEntry(input): Promise<EntitlementLedgerEntry> {
      authorize(input.tenantId);
      if (!isEntitlementLedgerInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const values = [
        input.id,
        input.tenantId,
        input.entryType,
        input.units,
        input.businessKey,
        input.correlationId,
      ];
      const inserted = await query(
        `INSERT INTO entitlement_ledger (id, tenant_id, entry_type, units, business_key, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id, tenant_id, entry_type, units, business_key, correlation_id, created_at`,
        values,
        (error) => {
          const code = postgresCode(error);
          if (code === '23503') return new RepositoryError('TENANT_NOT_FOUND');
          return undefined;
        },
      );
      if (inserted.rowCount === 1) return parseSingle(inserted, parseEntitlementLedgerEntry);
      const existing = await query(
        `SELECT id, tenant_id, entry_type, units, business_key, correlation_id, created_at
         FROM entitlement_ledger WHERE tenant_id = $1 AND business_key = $2`,
        [input.tenantId, input.businessKey],
      );
      const entry =
        existing.rowCount === 1 ? parseSingle(existing, parseEntitlementLedgerEntry) : undefined;
      if (!entry || !sameEntitlementLedgerEntry(entry, input))
        throw new RepositoryError('ENTITLEMENT_BUSINESS_KEY_CONFLICT');
      return entry;
    },
    async readEntitlementBalance(tenantId): Promise<EntitlementBalance> {
      authorize(tenantId);
      const result = await query(
        `SELECT $1::uuid AS tenant_id, COALESCE(sum(units), 0)::bigint AS units
         FROM entitlement_ledger WHERE tenant_id = $1`,
        [tenantId],
      );
      return parseSingle(result, parseEntitlementBalance);
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
  const claimOwner = nullableIdentifier(row.claim_owner);
  const claimFence = nonNegativeInteger(row.claim_fence);
  const leaseUntil = nullableTimestamp(row.claim_lease_until);
  const workerGeneration = nullablePositiveInteger(row.worker_generation);
  const childId = nullableIdentifier(row.worker_child_id);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isIdentifier(row.operation_key, false) ||
    !isDeliveryStatus(row.status) ||
    claimOwner === undefined ||
    claimFence === undefined ||
    leaseUntil === undefined ||
    workerGeneration === undefined ||
    childId === undefined ||
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
    claimOwner,
    claimFence,
    leaseUntil,
    workerGeneration,
    childId,
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
  const claimFence = nullablePositiveInteger(row.claim_fence);
  const providerMessageId =
    row.provider_message_id === undefined ? null : nullableIdentifier(row.provider_message_id);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isUuid(row.operation_id) ||
    !attemptNumber ||
    !isDeliveryAttemptStatus(row.status) ||
    claimFence === undefined ||
    providerMessageId === undefined ||
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
    claimFence,
    providerMessageId,
    schemaVersion,
    revision,
    createdAt,
    updatedAt,
  });
}

function parseDeliveryClaim(row: unknown): DeliveryClaimRecord | undefined {
  if (!isRecord(row)) return undefined;
  const operation = parseDelivery({
    id: row.operation_id,
    tenant_id: row.tenant_id,
    operation_key: row.operation_key,
    status: row.operation_status,
    claim_owner: row.claim_owner,
    claim_fence: row.claim_fence,
    claim_lease_until: row.claim_lease_until,
    worker_generation: row.worker_generation,
    worker_child_id: row.worker_child_id,
    schema_version: row.operation_schema_version,
    revision: row.operation_revision,
    created_at: row.operation_created_at,
    updated_at: row.operation_updated_at,
  });
  const attempt = parseDeliveryAttempt({
    id: row.attempt_id,
    tenant_id: row.tenant_id,
    operation_id: row.operation_id,
    attempt_number: row.attempt_number,
    status: row.attempt_status,
    claim_fence: row.attempt_claim_fence,
    provider_message_id: row.provider_message_id,
    schema_version: row.attempt_schema_version,
    revision: row.attempt_revision,
    created_at: row.attempt_created_at,
    updated_at: row.attempt_updated_at,
  });
  if (
    !operation ||
    (operation.status !== 'CLAIMED' &&
      operation.status !== 'SENDING' &&
      operation.status !== 'SENT' &&
      operation.status !== 'AMBIGUOUS') ||
    operation.claimOwner === null ||
    operation.claimFence < 1 ||
    operation.leaseUntil === null ||
    operation.workerGeneration === null ||
    operation.childId === null ||
    !attempt ||
    attempt.claimFence !== operation.claimFence
  )
    return undefined;
  return Object.freeze({ operation, attempt });
}

function parseEntitlementLedgerEntry(row: unknown): EntitlementLedgerEntry | undefined {
  if (!isRecord(row)) return undefined;
  const units = nonZeroInteger(row.units);
  const createdAt = timestamp(row.created_at);
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenant_id) ||
    !isEntitlementEntryType(row.entry_type) ||
    units === undefined ||
    !isIdentifier(row.business_key, false) ||
    !isIdentifier(row.correlation_id, false) ||
    !createdAt
  )
    return undefined;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    entryType: row.entry_type,
    units,
    businessKey: row.business_key,
    correlationId: row.correlation_id,
    createdAt,
  });
}

function sameEntitlementLedgerEntry(
  entry: EntitlementLedgerEntry,
  input: Readonly<Omit<EntitlementLedgerEntry, 'createdAt'>>,
): boolean {
  return (
    entry.id === input.id &&
    entry.tenantId === input.tenantId &&
    entry.entryType === input.entryType &&
    entry.units === input.units &&
    entry.businessKey === input.businessKey &&
    entry.correlationId === input.correlationId
  );
}

function parseEntitlementBalance(row: unknown): EntitlementBalance | undefined {
  if (!isRecord(row)) return undefined;
  const units = safeInteger(row.units);
  return isUuid(row.tenant_id) && units !== undefined
    ? Object.freeze({ tenantId: row.tenant_id, units })
    : undefined;
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

function isEntitlementLedgerInput(
  value: unknown,
): value is Readonly<Omit<EntitlementLedgerEntry, 'createdAt'>> {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.tenantId) &&
    isEntitlementEntryType(value.entryType) &&
    nonZeroInteger(value.units) !== undefined &&
    isIdentifier(value.businessKey, false) &&
    isIdentifier(value.correlationId, false)
  );
}

function isEntitlementEntryType(value: unknown): value is EntitlementEntryType {
  return (
    value === 'CREDIT_PAYMENT' ||
    value === 'CREDIT_COUPON' ||
    value === 'DEBIT_CONFIRMED_DELIVERY' ||
    value === 'ADJUSTMENT'
  );
}

function isDeliveryStatus(value: unknown): value is DeliveryRecord['status'] {
  return (
    value === 'PREPARED' ||
    value === 'CLAIMED' ||
    value === 'SENDING' ||
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

function isDeliverySettlementInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    isUuid(value.operationId) &&
    isUuid(value.attemptId) &&
    isPositiveInteger(value.claimFence) &&
    isPositiveInteger(value.workerGeneration) &&
    isIdentifier(value.childId, false) &&
    (value.outcome === 'SENT' || value.outcome === 'AMBIGUOUS') &&
    (value.providerMessageId === null || isIdentifier(value.providerMessageId, false))
  );
}

function isDeliveryClaimInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    isUuid(value.operationId) &&
    isUuid(value.attemptId) &&
    isIdentifier(value.claimOwner, false) &&
    timestamp(value.now) !== undefined &&
    timestamp(value.leaseUntil) !== undefined &&
    Date.parse(value.leaseUntil as string) > Date.parse(value.now as string) &&
    isPositiveInteger(value.workerGeneration) &&
    isIdentifier(value.childId, false)
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

function safeInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) ? number : undefined;
}

function nonNegativeOrNegativeInteger(value: unknown): number | undefined {
  const number = safeInteger(value);
  return number !== undefined && Math.abs(number) <= 1_000_000 ? number : undefined;
}

function nonZeroInteger(value: unknown): number | undefined {
  const number = nonNegativeOrNegativeInteger(value);
  return number === 0 || number === undefined ? undefined : number;
}

function nullablePositiveInteger(value: unknown): number | null | undefined {
  return value === null ? null : positiveInteger(value);
}

function nullableIdentifier(value: unknown): string | null | undefined {
  return value === null ? null : isIdentifier(value, false) ? value : undefined;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : timestamp(value);
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
