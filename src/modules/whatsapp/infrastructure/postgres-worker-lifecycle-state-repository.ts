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
    expectedGeneration?: number | null,
  ): Promise<void> {
    validateSnapshot(snapshot);
    const result = await dependencies.client.query(
      expectedGeneration === undefined
        ? `INSERT INTO worker_lifecycle_states
             (tenant_id, state, generation, child_id, quarantined)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id) DO UPDATE
             SET state = EXCLUDED.state,
                 generation = EXCLUDED.generation,
                 child_id = EXCLUDED.child_id,
                 quarantined = EXCLUDED.quarantined,
                 updated_at = now()
           WHERE worker_lifecycle_states.generation <= EXCLUDED.generation
           RETURNING tenant_id`
        : `INSERT INTO worker_lifecycle_states
             (tenant_id, state, generation, child_id, quarantined)
           SELECT $1, $2, $3, $4, $5
           WHERE $6::integer IS NULL
              OR EXISTS (
                SELECT 1
                FROM worker_lifecycle_states
                WHERE tenant_id = $1 AND generation = $6
              )
           ON CONFLICT (tenant_id) DO UPDATE
             SET state = EXCLUDED.state,
                 generation = EXCLUDED.generation,
                 child_id = EXCLUDED.child_id,
                 quarantined = EXCLUDED.quarantined,
                 updated_at = now()
           WHERE worker_lifecycle_states.generation = $6
           RETURNING tenant_id`,
      expectedGeneration === undefined
        ? [
            snapshot.tenantId,
            snapshot.state,
            snapshot.generation,
            snapshot.childId,
            snapshot.quarantined,
          ]
        : [
            snapshot.tenantId,
            snapshot.state,
            snapshot.generation,
            snapshot.childId,
            snapshot.quarantined,
            expectedGeneration,
          ],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        expectedGeneration === undefined
          ? 'stale lifecycle state'
          : 'lifecycle state generation mismatch',
      );
    }
  }

  return {
    async load(tenantId): Promise<WorkerLifecycleSnapshot | undefined> {
      authorizeTenant(tenantId);
      const result = await dependencies.client.query(
        `SELECT tenant_id, state, generation, child_id, quarantined
         FROM worker_lifecycle_states
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
    compareAndSave(snapshot, expectedGeneration): Promise<void> {
      if (
        expectedGeneration !== null &&
        (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)
      ) {
        return Promise.reject(new Error('invalid expected generation'));
      }
      return write(snapshot, expectedGeneration);
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
  return typeof value === 'string' && /^tenant_example_[a-z0-9_]+$/.test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
}

function isState(value: unknown): value is WorkerLifecycleSnapshot['state'] {
  return value === 'STOPPED' || value === 'STARTING' || value === 'RUNNING' || value === 'STOPPING';
}
