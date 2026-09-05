import { WorkerRuntimeError, type WorkerCommandResult } from './worker-runtime-service';
import type { WorkerDiagnosticsService } from './worker-diagnostics-service';
import type {
  WorkerLifecycleSnapshot,
  WorkerLifecycleStateRepositoryPort,
} from './worker-lifecycle-state-service';

export interface WorkerCommandPort {
  startWorker(input: VersionedWorkerCommand): Promise<WorkerCommandResult>;
  applyConfig(input: VersionedWorkerCommand): Promise<WorkerCommandResult>;
  stopWorker(input: WorkerCommand): Promise<WorkerCommandResult>;
  invalidateWorker(input: WorkerCommand): void;
}

interface StartWorkerInput {
  readonly tenantId: string;
  readonly childId: string;
  readonly correlationId: string;
  readonly configVersion: number;
}

interface StopWorkerInput {
  readonly tenantId: string;
  readonly correlationId: string;
}

interface ApplyConfigInput {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly configVersion: number;
}

interface WorkerCommand {
  readonly tenantId: string;
  readonly generation: number;
  readonly childId: string;
  readonly correlationId: string;
}

interface VersionedWorkerCommand extends WorkerCommand {
  readonly configVersion: number;
}

export type WorkerOwnershipState = Readonly<{
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';
  desired: 'STOPPED' | 'RUNNING';
  generation: number;
  childId: string | null;
  quarantined: boolean;
}>;

interface MutableOwnershipState {
  state: WorkerOwnershipState['state'];
  desired: WorkerOwnershipState['desired'];
  generation: number;
  childId: string | null;
  correlationId: string | null;
  quarantined: boolean;
  stopPromise: Promise<WorkerCommandResult> | undefined;
  resolveStop: ((result: WorkerCommandResult) => void) | undefined;
  rejectStop: ((error: unknown) => void) | undefined;
  persisted: WorkerLifecycleSnapshot | null;
  recovered: boolean;
}

export interface WorkerOwnershipService {
  startWorker(input: StartWorkerInput): Promise<WorkerCommandResult>;
  applyConfig(input: ApplyConfigInput): Promise<WorkerCommandResult>;
  stopWorker(input: StopWorkerInput): Promise<WorkerCommandResult>;
  recordChildExit(
    tenantId: string,
    generation: number,
    childId: string,
    correlationId: string,
  ): void;
  getState(tenantId: string): WorkerOwnershipState;
}

export function createWorkerOwnershipService(dependencies: {
  readonly commands: WorkerCommandPort;
  readonly diagnostics: WorkerDiagnosticsService;
  readonly persistence?: WorkerLifecycleStateRepositoryPort;
}): WorkerOwnershipService {
  const states = new Map<string, MutableOwnershipState>();

  function stateFor(tenantId: string): MutableOwnershipState {
    let state = states.get(tenantId);
    if (!state) {
      state = {
        state: 'STOPPED',
        desired: 'STOPPED',
        generation: 0,
        childId: null,
        correlationId: null,
        quarantined: false,
        stopPromise: undefined,
        resolveStop: undefined,
        rejectStop: undefined,
        persisted: null,
        recovered: false,
      };
      states.set(tenantId, state);
    }
    return state;
  }

  async function startWorker(input: StartWorkerInput): Promise<WorkerCommandResult> {
    const state = stateFor(input.tenantId);
    if (dependencies.persistence) await recover(state, input.tenantId);
    if (state.quarantined || state.state !== 'STOPPED') throw notTerminalError();

    const previous = ownershipSnapshot(state);
    state.generation += 1;
    state.childId = input.childId;
    state.correlationId = input.correlationId;
    state.state = 'STARTING';
    state.desired = 'RUNNING';
    const command = commandFor(input, state);
    recordOwnership(state, command);
    try {
      if (dependencies.persistence) await persist(state, command);
    } catch (error) {
      restoreOwnership(state, previous);
      throw error;
    }
    try {
      const result = await dependencies.commands.startWorker({
        ...command,
        configVersion: input.configVersion,
      });
      if (!owns(state, command) || state.state !== 'STARTING' || state.desired !== 'RUNNING') {
        throw notTerminalError();
      }
      state.state = 'RUNNING';
      recordOwnership(state, command);
      if (dependencies.persistence) await persist(state, command);
      return result;
    } catch (error) {
      if (owns(state, command) && !state.stopPromise) {
        state.state = 'STOPPING';
        state.desired = 'STOPPED';
        state.quarantined = true;
        recordOwnership(state, command);
        void persist(state, command).catch(() => undefined);
        beginCompensatingStop(state, command);
      }
      throw error;
    }
  }

  function stopWorker(input: StopWorkerInput): Promise<WorkerCommandResult> {
    const state = stateFor(input.tenantId);
    if (state.state === 'STOPPED' && !state.quarantined) return Promise.resolve({ ok: true });
    if (state.stopPromise) return state.stopPromise;
    if (state.childId === null) return Promise.reject(notTerminalError());

    state.desired = 'STOPPED';
    state.state = 'STOPPING';
    const command: WorkerCommand = {
      tenantId: input.tenantId,
      generation: state.generation,
      childId: state.childId,
      correlationId: input.correlationId,
    };
    state.correlationId = input.correlationId;
    recordOwnership(state, command);
    let resolveStop!: (result: WorkerCommandResult) => void;
    let rejectStop!: (error: unknown) => void;
    const promise = new Promise<WorkerCommandResult>((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    state.stopPromise = promise;
    state.resolveStop = resolveStop;
    state.rejectStop = rejectStop;

    if (!dependencies.persistence) {
      void dependencies.commands.stopWorker(command).then(
        (result) => settleStopped(state, command, result, resolveStop, rejectStop),
        (error: unknown) => failStop(state, command, error, rejectStop),
      );
      return promise;
    }
    void persist(state, command)
      .then(() => dependencies.commands.stopWorker(command))
      .then(
        (result) => settleStopped(state, command, result, resolveStop, rejectStop),
        (error: unknown) => failStop(state, command, error, rejectStop),
      );
    return promise;
  }

  function recordChildExit(
    tenantId: string,
    generation: number,
    childId: string,
    correlationId: string,
  ): void {
    const state = stateFor(tenantId);
    if (
      state.generation !== generation ||
      state.childId !== childId ||
      state.correlationId !== correlationId
    ) {
      return;
    }
    const command: WorkerCommand = { tenantId, generation, childId, correlationId };
    const resolveStop = state.resolveStop;
    const rejectStop = state.rejectStop;
    dependencies.commands.invalidateWorker(command);
    if (!dependencies.persistence) {
      release(state);
      recordOwnership(state, command);
      resolveStop?.({ ok: true });
      return;
    }
    void persistStopped(state, command).then(
      () => resolveStop?.({ ok: true }),
      (error: unknown) => rejectStop?.(error),
    );
  }

  return {
    startWorker,
    applyConfig(input): Promise<WorkerCommandResult> {
      const state = stateFor(input.tenantId);
      if (state.state !== 'RUNNING' || state.quarantined || state.childId === null) {
        return Promise.reject(notTerminalError());
      }
      return dependencies.commands.applyConfig({
        tenantId: input.tenantId,
        generation: state.generation,
        childId: state.childId,
        correlationId: input.correlationId,
        configVersion: input.configVersion,
      });
    },
    stopWorker,
    recordChildExit,
    getState(tenantId): WorkerOwnershipState {
      const state = stateFor(tenantId);
      return Object.freeze({
        state: state.state,
        desired: state.desired,
        generation: state.generation,
        childId: state.childId,
        quarantined: state.quarantined,
      });
    },
  };

  function beginCompensatingStop(state: MutableOwnershipState, command: WorkerCommand): void {
    let resolveStop!: (result: WorkerCommandResult) => void;
    let rejectStop!: (error: unknown) => void;
    const terminalEvidence = new Promise<WorkerCommandResult>((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    state.resolveStop = resolveStop;
    state.rejectStop = rejectStop;
    state.stopPromise = terminalEvidence;
    void terminalEvidence.catch(() => undefined);
    void dependencies.commands.stopWorker(command).then(
      (result) => settleStopped(state, command, result, resolveStop, rejectStop),
      (error: unknown) => failStop(state, command, error, rejectStop),
    );
  }

  async function recover(state: MutableOwnershipState, tenantId: string): Promise<void> {
    if (state.recovered) return;
    const persisted = await dependencies.persistence?.load(tenantId);
    if (persisted) {
      state.generation = persisted.generation;
      state.persisted = persisted;
      // A prior process cannot retain live child authority: the next STARTING CAS fences it.
      state.state = 'STOPPED';
      state.desired = 'STOPPED';
      state.childId = null;
      state.correlationId = null;
      state.quarantined = false;
    }
    state.recovered = true;
  }

  function persist(state: MutableOwnershipState, command: WorkerCommand): Promise<void> {
    if (!dependencies.persistence) return Promise.resolve();
    const snapshot: WorkerLifecycleSnapshot = Object.freeze({
      tenantId: command.tenantId,
      state: state.state,
      generation: state.generation,
      childId: state.childId,
      quarantined: state.quarantined,
      revision: (state.persisted?.revision ?? 0) + 1,
    });
    return dependencies.persistence.compareAndSave(snapshot, state.persisted).then(() => {
      state.persisted = snapshot;
    });
  }

  function persistStopped(state: MutableOwnershipState, command: WorkerCommand): Promise<void> {
    release(state);
    recordOwnership(state, command);
    return persist(state, command).catch((error: unknown) => {
      state.state = 'STOPPING';
      state.desired = 'STOPPED';
      state.childId = command.childId;
      state.quarantined = true;
      recordOwnership(state, command);
      throw error;
    });
  }

  function settleStopped(
    state: MutableOwnershipState,
    command: WorkerCommand,
    result: WorkerCommandResult,
    resolve: (result: WorkerCommandResult) => void,
    reject: (error: unknown) => void,
  ): void {
    if (!owns(state, command)) return;
    if (!dependencies.persistence) {
      release(state);
      recordOwnership(state, command);
      resolve(result);
      return;
    }
    void persistStopped(state, command).then(() => resolve(result), reject);
  }

  function failStop(
    state: MutableOwnershipState,
    command: WorkerCommand,
    error: unknown,
    reject: (error: unknown) => void,
  ): void {
    if (!owns(state, command)) return;
    state.quarantined = true;
    state.stopPromise = undefined;
    state.resolveStop = undefined;
    state.rejectStop = undefined;
    recordOwnership(state, command);
    reject(error);
  }

  function recordOwnership(state: MutableOwnershipState, command: WorkerCommand): void {
    try {
      const result = dependencies.diagnostics.recordOwnership({
        state: state.state,
        quarantined: state.quarantined,
        correlationId: command.correlationId,
        tenantId: command.tenantId,
        generation: command.generation,
        childId: command.childId,
      });
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch {
      return;
    }
  }
}

function commandFor(input: StartWorkerInput, state: MutableOwnershipState): WorkerCommand {
  return {
    tenantId: input.tenantId,
    generation: state.generation,
    childId: input.childId,
    correlationId: input.correlationId,
  };
}
function ownershipSnapshot(state: MutableOwnershipState): Readonly<{
  state: MutableOwnershipState['state'];
  desired: MutableOwnershipState['desired'];
  generation: number;
  childId: string | null;
  correlationId: string | null;
  quarantined: boolean;
}> {
  return {
    state: state.state,
    desired: state.desired,
    generation: state.generation,
    childId: state.childId,
    correlationId: state.correlationId,
    quarantined: state.quarantined,
  };
}

function restoreOwnership(
  state: MutableOwnershipState,
  previous: ReturnType<typeof ownershipSnapshot>,
): void {
  state.state = previous.state;
  state.desired = previous.desired;
  state.generation = previous.generation;
  state.childId = previous.childId;
  state.correlationId = previous.correlationId;
  state.quarantined = previous.quarantined;
}

function owns(state: MutableOwnershipState, command: WorkerCommand): boolean {
  return state.generation === command.generation && state.childId === command.childId;
}

function release(state: MutableOwnershipState): void {
  state.state = 'STOPPED';
  state.desired = 'STOPPED';
  state.childId = null;
  state.correlationId = null;
  state.quarantined = false;
  state.stopPromise = undefined;
  state.resolveStop = undefined;
  state.rejectStop = undefined;
}

function notTerminalError(): WorkerRuntimeError {
  return new WorkerRuntimeError(
    'WORKER_OWNERSHIP_QUARANTINED',
    'Worker ownership is not terminal',
    true,
  );
}
