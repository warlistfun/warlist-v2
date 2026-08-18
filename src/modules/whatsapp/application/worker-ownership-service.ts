import { WorkerRuntimeError, type WorkerCommandResult } from './worker-runtime-service';

export interface WorkerCommandPort {
  startWorker(input: VersionedWorkerCommand): Promise<WorkerCommandResult>;
  applyConfig(input: VersionedWorkerCommand): Promise<WorkerCommandResult>;
  stopWorker(input: WorkerCommand): Promise<WorkerCommandResult>;
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
  quarantined: boolean;
  stopPromise: Promise<WorkerCommandResult> | undefined;
  resolveStop: ((result: WorkerCommandResult) => void) | undefined;
  rejectStop: ((error: unknown) => void) | undefined;
}

export interface WorkerOwnershipService {
  startWorker(input: StartWorkerInput): Promise<WorkerCommandResult>;
  stopWorker(input: StopWorkerInput): Promise<WorkerCommandResult>;
  recordChildExit(tenantId: string, generation: number, childId: string): void;
  getState(tenantId: string): WorkerOwnershipState;
}

export function createWorkerOwnershipService(dependencies: {
  readonly commands: WorkerCommandPort;
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
    state.state = 'STARTING';
    state.desired = 'RUNNING';
    const command = commandFor(input, state);

    try {
      const result = await dependencies.commands.startWorker({
        ...command,
        configVersion: input.configVersion,
      });
      if (!owns(state, command) || state.state !== 'STARTING' || state.desired !== 'RUNNING') {
        throw notTerminalError();
      }
      state.state = 'RUNNING';
      return result;
    } catch (error) {
      if (owns(state, command) && !state.stopPromise) {
        state.state = 'STOPPING';
        state.desired = 'STOPPED';
        state.quarantined = true;
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
        resolve?.(result);
      },
      (error: unknown) => {
        if (!owns(state, command)) return;
        state.quarantined = true;
        state.stopPromise = undefined;
        state.resolveStop = undefined;
        state.rejectStop = undefined;
        rejectStop(error);
      },
    );
    return promise;
  }

  function recordChildExit(tenantId: string, generation: number, childId: string): void {
    const state = stateFor(tenantId);
    if (state.generation !== generation || state.childId !== childId) return;
    const resolveStop = state.resolveStop;
    release(state);
    resolveStop?.({ ok: true });
  }

  return {
    startWorker,
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
        if (owns(state, command)) release(state);
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
