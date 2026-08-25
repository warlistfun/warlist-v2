export type WorkerLifecycleSnapshot = Readonly<{
  tenantId: string;
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';
  generation: number;
  childId: string | null;
  quarantined: boolean;
  revision: number;
}>;

export interface WorkerLifecycleStateRepositoryPort {
  load(tenantId: string): Promise<WorkerLifecycleSnapshot | undefined>;
  save(snapshot: WorkerLifecycleSnapshot): Promise<void>;
  compareAndSave(
    snapshot: WorkerLifecycleSnapshot,
    expectedSnapshot: WorkerLifecycleSnapshot | null,
  ): Promise<void>;
}

export interface WorkerLifecycleStateService {
  recover(tenantId: string): Promise<WorkerLifecycleSnapshot | undefined>;
  save(snapshot: WorkerLifecycleSnapshot): Promise<void>;
}

export function createWorkerLifecycleStateService(dependencies: {
  readonly repository: WorkerLifecycleStateRepositoryPort;
}): WorkerLifecycleStateService {
  return {
    recover(tenantId): Promise<WorkerLifecycleSnapshot | undefined> {
      return dependencies.repository.load(tenantId);
    },
    save(snapshot): Promise<void> {
      return dependencies.repository.save(snapshot);
    },
  };
}

export function createInMemoryWorkerLifecycleStateRepository(): WorkerLifecycleStateRepositoryPort {
  const snapshots = new Map<string, WorkerLifecycleSnapshot>();

  return {
    load(tenantId): Promise<WorkerLifecycleSnapshot | undefined> {
      const snapshot = snapshots.get(tenantId);
      return Promise.resolve(snapshot && freezeSnapshot(snapshot));
    },
    save(snapshot): Promise<void> {
      const current = snapshots.get(snapshot.tenantId);
      if (!current && snapshot.revision !== 1) {
        return Promise.reject(new Error('stale lifecycle revision'));
      }
      if (current && !canUnconditionalSave(snapshot, current)) {
        return Promise.reject(new Error('stale lifecycle state'));
      }
      snapshots.set(snapshot.tenantId, freezeSnapshot(snapshot));
      return Promise.resolve();
    },
    compareAndSave(snapshot, expectedSnapshot): Promise<void> {
      const current = snapshots.get(snapshot.tenantId);
      if (sameSnapshot(current, snapshot)) return Promise.resolve();
      if (!sameSnapshot(current, expectedSnapshot)) {
        return Promise.reject(new Error('lifecycle state transition mismatch'));
      }
      if (current && snapshot.generation < current.generation) {
        return Promise.reject(new Error('stale lifecycle state'));
      }
      if (!validNextRevision(snapshot, current)) {
        return Promise.reject(new Error('stale lifecycle revision'));
      }
      snapshots.set(snapshot.tenantId, freezeSnapshot(snapshot));
      return Promise.resolve();
    },
  };
}

function canUnconditionalSave(
  snapshot: WorkerLifecycleSnapshot,
  current: WorkerLifecycleSnapshot,
): boolean {
  return (
    sameSnapshot(snapshot, current) ||
    (snapshot.generation > current.generation && validNextRevision(snapshot, current))
  );
}

function validNextRevision(
  snapshot: WorkerLifecycleSnapshot,
  current: WorkerLifecycleSnapshot | undefined,
): boolean {
  return current ? snapshot.revision === current.revision + 1 : snapshot.revision === 1;
}

function sameSnapshot(
  current: WorkerLifecycleSnapshot | undefined,
  expected: WorkerLifecycleSnapshot | null,
): boolean {
  if (current === undefined || expected === null) return current === undefined && expected === null;
  return (
    current.tenantId === expected.tenantId &&
    current.state === expected.state &&
    current.generation === expected.generation &&
    current.childId === expected.childId &&
    current.quarantined === expected.quarantined &&
    current.revision === expected.revision
  );
}

function freezeSnapshot(snapshot: WorkerLifecycleSnapshot): WorkerLifecycleSnapshot {
  return Object.freeze({ ...snapshot });
}
