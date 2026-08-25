import type {
  WorkerLifecycleSnapshot,
  WorkerLifecycleStateRepositoryPort,
} from '../application/worker-lifecycle-state-service';

export interface TenantAuthorizationPort {
  assertAuthorized(tenantId: string): void;
}

interface QueryablePort {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rowCount: number | null;
    readonly rows: readonly unknown[];
  }>;
}

export function createPostgresWorkerLifecycleStateRepository(dependencies: {
  readonly client: QueryablePort;
  readonly authorization: TenantAuthorizationPort;
}): WorkerLifecycleStateRepositoryPort {
  function authorizeTenant(tenantId: string): void {
    if (!isTenantId(tenantId)) {
      throw new Error('invalid tenant identifier');
    }
    dependencies.authorization.assertAuthorized(tenantId);
  }

  function validateSnapshot(snapshot: WorkerLifecycleSnapshot): void {
    authorizeTenant(snapshot.tenantId);
    if (
      !isState(snapshot.state) ||
      !Number.isSafeInteger(snapshot.generation) ||
      snapshot.generation < 0 ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 1 ||
      (snapshot.childId !== null && !isIdentifier(snapshot.childId)) ||
      typeof snapshot.quarantined !== 'boolean'
    ) {
      throw new Error('invalid lifecycle snapshot');
    }
  }

  async function write(
    snapshot: WorkerLifecycleSnapshot,
    expectedSnapshot?: WorkerLifecycleSnapshot | null,
  ): Promise<void> {
    validateSnapshot(snapshot);
    if (expectedSnapshot) {
      validateSnapshot(expectedSnapshot);
      if (expectedSnapshot.tenantId !== snapshot.tenantId) {
        throw new Error('invalid expected lifecycle snapshot');
      }
      if (snapshot.generation < expectedSnapshot.generation) {
        throw new Error('stale lifecycle state');
      }
      if (
        !sameSnapshot(snapshot, expectedSnapshot) &&
        snapshot.revision !== expectedSnapshot.revision + 1
      ) {
        throw new Error('stale lifecycle revision');
      }
    } else if (expectedSnapshot === null && snapshot.revision !== 1) {
      throw new Error('stale lifecycle revision');
    }
    const values = [
      snapshot.tenantId,
      snapshot.state,
      snapshot.generation,
      snapshot.childId,
      snapshot.quarantined,
      snapshot.revision,
    ];
    const result = await dependencies.client.query(
      expectedSnapshot === undefined
        ? `INSERT INTO tenant_worker_ownerships
             (tenant_id, state, generation, child_id, quarantined, revision)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE $6::bigint = 1
              OR EXISTS (
                SELECT 1 FROM tenant_worker_ownerships WHERE tenant_id = $1
              )
           ON CONFLICT (tenant_id) DO UPDATE
             SET state = EXCLUDED.state,
                 generation = EXCLUDED.generation,
                 child_id = EXCLUDED.child_id,
                 quarantined = EXCLUDED.quarantined,
                 revision = EXCLUDED.revision,
                 updated_at = now()
           WHERE (tenant_worker_ownerships.generation < EXCLUDED.generation
                  AND tenant_worker_ownerships.revision + 1 = EXCLUDED.revision)
              OR (tenant_worker_ownerships.state = EXCLUDED.state
                  AND tenant_worker_ownerships.generation = EXCLUDED.generation
                  AND tenant_worker_ownerships.child_id IS NOT DISTINCT FROM EXCLUDED.child_id
                  AND tenant_worker_ownerships.quarantined = EXCLUDED.quarantined
                  AND tenant_worker_ownerships.revision = EXCLUDED.revision)
           RETURNING tenant_id`
        : expectedSnapshot === null
          ? `INSERT INTO tenant_worker_ownerships
               (tenant_id, state, generation, child_id, quarantined, revision)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id) DO UPDATE SET revision = EXCLUDED.revision
             WHERE tenant_worker_ownerships.state = EXCLUDED.state
               AND tenant_worker_ownerships.generation = EXCLUDED.generation
               AND tenant_worker_ownerships.child_id IS NOT DISTINCT FROM EXCLUDED.child_id
               AND tenant_worker_ownerships.quarantined = EXCLUDED.quarantined
               AND tenant_worker_ownerships.revision = EXCLUDED.revision
             RETURNING tenant_id`
          : `UPDATE tenant_worker_ownerships
             SET state = $2,
                 generation = $3,
                 child_id = $4,
                 quarantined = $5,
                 revision = $6,
                 updated_at = now()
             WHERE tenant_id = $1
               AND ((state = $7
                     AND generation = $8
                     AND child_id IS NOT DISTINCT FROM $9
                     AND quarantined = $10
                     AND revision = $11
                     AND generation <= $3
                     AND revision + 1 = $6)
                    OR (state = $2
                        AND generation = $3
                        AND child_id IS NOT DISTINCT FROM $4
                        AND quarantined = $5
                        AND revision = $6))
             RETURNING tenant_id`,
      expectedSnapshot
        ? [
            ...values,
            expectedSnapshot.state,
            expectedSnapshot.generation,
            expectedSnapshot.childId,
            expectedSnapshot.quarantined,
            expectedSnapshot.revision,
          ]
        : values,
    );
    if (result.rowCount !== 1) {
      throw new Error(
        expectedSnapshot === undefined
          ? 'stale lifecycle state'
          : 'lifecycle state transition mismatch',
      );
    }
  }

  return {
    async load(tenantId): Promise<WorkerLifecycleSnapshot | undefined> {
      authorizeTenant(tenantId);
      const result = await dependencies.client.query(
        `SELECT tenant_id, state, generation, child_id, quarantined, revision::text AS revision
         FROM tenant_worker_ownerships
         WHERE tenant_id = $1`,
        [tenantId],
      );
      if (result.rowCount === 0) {
        return undefined;
      }
      const snapshot = parseSnapshot(result.rows[0]);
      if (!snapshot || snapshot.tenantId !== tenantId) {
        throw new Error('invalid lifecycle state row');
      }
      return Object.freeze({ ...snapshot });
    },
    save(snapshot): Promise<void> {
      return write(snapshot);
    },
    compareAndSave(snapshot, expectedSnapshot): Promise<void> {
      return write(snapshot, expectedSnapshot);
    },
  };
}

function parseSnapshot(value: unknown): WorkerLifecycleSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { tenant_id, state, generation, child_id, quarantined, revision } = value;
  const parsedRevision = parseRevision(revision);
  if (
    !isTenantId(tenant_id) ||
    !isState(state) ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    (child_id !== null && !isIdentifier(child_id)) ||
    typeof quarantined !== 'boolean' ||
    parsedRevision === undefined
  ) {
    return undefined;
  }
  return {
    tenantId: tenant_id,
    state,
    generation,
    childId: child_id,
    quarantined,
    revision: parsedRevision,
  };
}

function parseRevision(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : undefined;
}

function sameSnapshot(first: WorkerLifecycleSnapshot, second: WorkerLifecycleSnapshot): boolean {
  return (
    first.tenantId === second.tenantId &&
    first.state === second.state &&
    first.generation === second.generation &&
    first.childId === second.childId &&
    first.quarantined === second.quarantined &&
    first.revision === second.revision
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isTenantId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]{1,160}$/.test(value);
}

function isState(value: unknown): value is WorkerLifecycleSnapshot['state'] {
  return value === 'STOPPED' || value === 'STARTING' || value === 'RUNNING' || value === 'STOPPING';
}
