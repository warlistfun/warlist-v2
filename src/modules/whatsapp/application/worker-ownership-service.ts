import { WorkerRuntimeError, type WorkerCommandResult } from './worker-runtime-service';
import type { WorkerDiagnosticsService } from './worker-diagnostics-service';

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
      };
      states.set(tenantId, state);
    }
    return state;
  }

  async function startWorker(input: StartWorkerInput): Promise<WorkerCommandResult> {
    const state = stateFor(input.tenantId);
    if (state.quarantined || state.state !== 'STOPPED') {
      throw new WorkerRuntimeError(
        'WORKER_OWNERSHIP_QUARANTINED',
        'Worker ownership is not terminal',
        true,
      );
    }

    state.generation += 1;
    state.childId = input.childId;
    state.correlationId = input.correlationId;
    state.state = 'STARTING';
    state.desired = 'RUNNING';
    const command = commandFor(input, state);
    recordOwnership(state, command);

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
      return result;
    } catch (error) {
      if (owns(state, command) && !state.stopPromise) {
        state.state = 'STOPPING';
        state.desired = 'STOPPED';
        state.quarantined = true;
        recordOwnership(state, command);
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
    void dependencies.commands.stopWorker(command).then(
      (result) => {
        if (!owns(state, command)) return;
        const resolve = state.resolveStop;
        release(state);
        recordOwnership(state, command);
        resolve?.(result);
      },
      (error: unknown) => {
        if (!owns(state, command)) return;
        state.quarantined = true;
        state.stopPromise = undefined;
        state.resolveStop = undefined;
        state.rejectStop = undefined;
        recordOwnership(state, command);
        rejectStop(error);
      },
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
    const command: WorkerCommand = {
      tenantId,
      generation,
      childId,
      correlationId,
    };
    const resolveStop = state.resolveStop;
    dependencies.commands.invalidateWorker(command);
    release(state);
    recordOwnership(state, command);
    resolveStop?.({ ok: true });
  }

  return {
    startWorker,
    applyConfig(input: ApplyConfigInput): Promise<WorkerCommandResult> {
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
      (result) => {
        if (owns(state, command)) {
          release(state);
          recordOwnership(state, command);
        }
        resolveStop(result);
      },
      (error: unknown) => {
        if (!owns(state, command)) return;
        state.stopPromise = undefined;
        state.resolveStop = undefined;
        state.rejectStop = undefined;
        rejectStop(error);
      },
    );
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
