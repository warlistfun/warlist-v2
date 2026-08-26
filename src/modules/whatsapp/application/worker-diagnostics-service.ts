import type { WorkerConnectionState } from '../../../interfaces/worker-ipc/contract';

export type WorkerCommandType = 'START_WORKER' | 'APPLY_CONFIG' | 'STOP_WORKER';

export type WorkerCommandOutcome =
  'ACKNOWLEDGED' | 'REJECTED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'RUNTIME_STOPPED';

export type WorkerOwnershipState = 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED';

export type WorkerCommandDiagnostic = Readonly<{
  outcome: WorkerCommandOutcome;
  commandType: WorkerCommandType;
  correlationId: string;
  tenantId: string;
  generation: number;
  childId: string;
}>;

export type WorkerOwnershipDiagnostic = Readonly<{
  state: WorkerOwnershipState;
  quarantined: boolean;
  correlationId: string;
  tenantId: string;
  generation: number;
  childId: string;
}>;

export type WorkerConnectionDiagnostic = Readonly<{
  state: WorkerConnectionState;
  correlationId: string;
  tenantId: string;
  generation: number;
  childId: string;
}>;

export type WorkerDiagnosticEvent = Readonly<
  | (WorkerCommandDiagnostic & {
      kind: 'COMMAND';
    })
  | (WorkerOwnershipDiagnostic & {
      kind: 'OWNERSHIP';
    })
  | (WorkerConnectionDiagnostic & {
      kind: 'CONNECTION';
    })
>;

export interface WorkerDiagnosticsPort {
  record(event: WorkerDiagnosticEvent): void | PromiseLike<void>;
}

export interface WorkerDiagnosticsService {
  recordCommand(event: WorkerCommandDiagnostic): void | PromiseLike<void>;
  recordOwnership(event: WorkerOwnershipDiagnostic): void | PromiseLike<void>;
  recordConnection?(event: WorkerConnectionDiagnostic): void | PromiseLike<void>;
}

export function createWorkerDiagnosticsService(dependencies: {
  readonly sink: WorkerDiagnosticsPort;
}): WorkerDiagnosticsService {
  return {
    recordCommand(event): void {
      try {
        const { outcome, commandType, correlationId, tenantId, generation, childId } = event;
        if (
          !isCommandOutcome(outcome) ||
          !isCommandType(commandType) ||
          !isIdentifier(correlationId) ||
          !isIdentifier(tenantId) ||
          !Number.isSafeInteger(generation) ||
          generation < 1 ||
          !isIdentifier(childId)
        ) {
          return;
        }
        emit(
          Object.freeze({
            kind: 'COMMAND',
            outcome,
            commandType,
            correlationId,
            tenantId,
            generation,
            childId,
          }),
        );
      } catch {
        return;
      }
    },
    recordOwnership(event): void {
      try {
        const { state, quarantined, correlationId, tenantId, generation, childId } = event;
        if (
          !isOwnershipState(state) ||
          typeof quarantined !== 'boolean' ||
          !isIdentifier(correlationId) ||
          !isIdentifier(tenantId) ||
          !Number.isSafeInteger(generation) ||
          generation < 1 ||
          !isIdentifier(childId)
        ) {
          return;
        }
        emit(
          Object.freeze({
            kind: 'OWNERSHIP',
            state,
            quarantined,
            correlationId,
            tenantId,
            generation,
            childId,
          }),
        );
      } catch {
        return;
      }
    },
    recordConnection(event): void {
      try {
        const { state, correlationId, tenantId, generation, childId } = event;
        if (
          !isConnectionState(state) ||
          !isIdentifier(correlationId) ||
          !isIdentifier(tenantId) ||
          !Number.isSafeInteger(generation) ||
          generation < 1 ||
          !isIdentifier(childId)
        ) {
          return;
        }
        emit(
          Object.freeze({
            kind: 'CONNECTION',
            state,
            correlationId,
            tenantId,
            generation,
            childId,
          }),
        );
      } catch {
        return;
      }
    },
  };

  function emit(event: WorkerDiagnosticEvent): void {
    try {
      const result = dependencies.sink.record(event);
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch {
      return;
    }
  }
}

function isCommandOutcome(value: unknown): value is WorkerCommandOutcome {
  return (
    value === 'ACKNOWLEDGED' ||
    value === 'REJECTED' ||
    value === 'TIMED_OUT' ||
    value === 'UNAVAILABLE' ||
    value === 'RUNTIME_STOPPED'
  );
}

function isCommandType(value: unknown): value is WorkerCommandType {
  return value === 'START_WORKER' || value === 'APPLY_CONFIG' || value === 'STOP_WORKER';
}

function isOwnershipState(value: unknown): value is WorkerOwnershipState {
  return value === 'STARTING' || value === 'RUNNING' || value === 'STOPPING' || value === 'STOPPED';
}

function isConnectionState(value: unknown): value is WorkerConnectionState {
  return (
    value === 'CONNECTING' ||
    value === 'OPEN' ||
    value === 'CLOSED_RETRYING' ||
    value === 'LOGGED_OUT' ||
    value === 'CREDENTIALS_SAVE_FAILED' ||
    value === 'STOPPED'
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  );
}
