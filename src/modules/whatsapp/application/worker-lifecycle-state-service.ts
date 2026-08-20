export type WorkerLifecycleSnapshot = Readonly<{
  tenantId: string;
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';
  generation: number;
  childId: string | null;
  quarantined: boolean;
}>;

export interface WorkerLifecycleStateRepositoryPort {
  load(tenantId: string): Promise<WorkerLifecycleSnapshot | undefined>;
  save(snapshot: WorkerLifecycleSnapshot): Promise<void>;
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
      if (current && snapshot.generation < current.generation) {
        return Promise.reject(new Error('stale lifecycle state'));
      }
      snapshots.set(snapshot.tenantId, freezeSnapshot(snapshot));
      return Promise.resolve();
    },
  };
}

function freezeSnapshot(snapshot: WorkerLifecycleSnapshot): WorkerLifecycleSnapshot {
  return Object.freeze({ ...snapshot });
}
