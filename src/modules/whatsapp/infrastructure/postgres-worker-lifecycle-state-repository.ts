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
    }
    const values = [
      snapshot.tenantId,
      snapshot.state,
      snapshot.generation,
      snapshot.childId,
      snapshot.quarantined,
    ];
    const result = await dependencies.client.query(
      expectedSnapshot === undefined
        ? `INSERT INTO tenant_worker_ownerships
             (tenant_id, state, generation, child_id, quarantined)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id) DO UPDATE
             SET state = EXCLUDED.state,
                 generation = EXCLUDED.generation,
                 child_id = EXCLUDED.child_id,
                 quarantined = EXCLUDED.quarantined,
                 updated_at = now()
           WHERE tenant_worker_ownerships.generation < EXCLUDED.generation
              OR (tenant_worker_ownerships.generation = EXCLUDED.generation
                  AND tenant_worker_ownerships.state = EXCLUDED.state
                  AND tenant_worker_ownerships.child_id IS NOT DISTINCT FROM EXCLUDED.child_id
                  AND tenant_worker_ownerships.quarantined = EXCLUDED.quarantined)
           RETURNING tenant_id`
        : expectedSnapshot === null
          ? `INSERT INTO tenant_worker_ownerships
               (tenant_id, state, generation, child_id, quarantined)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id) DO NOTHING
             RETURNING tenant_id`
          : `UPDATE tenant_worker_ownerships
             SET state = $2,
                 generation = $3,
                 child_id = $4,
                 quarantined = $5,
                 updated_at = now()
             WHERE tenant_id = $1
               AND state = $6
               AND generation = $7
               AND child_id IS NOT DISTINCT FROM $8
               AND quarantined = $9
               AND generation <= $3
             RETURNING tenant_id`,
      expectedSnapshot
        ? [
            ...values,
            expectedSnapshot.state,
            expectedSnapshot.generation,
            expectedSnapshot.childId,
            expectedSnapshot.quarantined,
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
        `SELECT tenant_id, state, generation, child_id, quarantined
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
  const { tenant_id, state, generation, child_id, quarantined } = value;
  if (
    !isTenantId(tenant_id) ||
    !isState(state) ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    (child_id !== null && !isIdentifier(child_id)) ||
    typeof quarantined !== 'boolean'
  ) {
    return undefined;
  }
  return { tenantId: tenant_id, state, generation, childId: child_id, quarantined };
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
