import type { IdGeneratorPort, WorkerRuntimePort } from '../../../app/ports';
import {
  IPC_PROTOCOL_VERSION,
  decodeChildMessage,
  type ChildMessage,
  type ParentCommandType,
  type ParentMessage,
} from '../../../interfaces/worker-ipc/contract';
import type { WorkerDiagnosticsService } from './worker-diagnostics-service';

export type CancelScheduledTask = () => void;

export interface ScheduleTaskPort {
  schedule(delayMs: number, task: () => void): CancelScheduledTask;
}

export interface WorkerCommandTransportPort {
  start(handler: (message: unknown) => void, signal: AbortSignal): Promise<void>;
  stop(signal: AbortSignal): Promise<void>;
  isReady(): Promise<boolean>;
  send(message: ParentMessage): Promise<void>;
}

interface WorkerIdentity {
  readonly tenantId: string;
  readonly generation: number;
  readonly childId: string;
  readonly correlationId: string;
}

interface VersionedWorkerIdentity extends WorkerIdentity {
  readonly configVersion: number;
}

export interface WorkerCommandResult {
  readonly ok: true;
}

export type PendingWorkerCommandDebug = Readonly<{
  commandType: ParentCommandType;
  correlationId: string;
  tenantId: string;
  generation: number;
  childId: string;
}>;

export type WorkerRuntimeDebugSnapshot = Readonly<{
  pendingCommands: readonly PendingWorkerCommandDebug[];
}>;

export type WorkerRuntimeErrorCode =
  | 'WA_RUNTIME_UNAVAILABLE'
  | 'WORKER_COMMAND_REJECTED'
  | 'WORKER_INTERNAL_ERROR'
  | 'WORKER_COMMAND_TIMEOUT'
  | 'WORKER_RUNTIME_START_TIMEOUT'
  | 'WORKER_RUNTIME_STOP_TIMEOUT'
  | 'WORKER_CHILD_EXITED'
  | 'WORKER_OWNERSHIP_QUARANTINED'
  | 'WA_RUNTIME_STOPPED';

export class WorkerRuntimeError extends Error {
  constructor(
    readonly code: WorkerRuntimeErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WorkerRuntimeError';
  }
}

interface Dependencies {
  readonly transport: WorkerCommandTransportPort;
  readonly scheduler: ScheduleTaskPort;
  readonly idGenerator: IdGeneratorPort;
  readonly commandTimeoutMs: number;
  readonly diagnostics: WorkerDiagnosticsService;
}

interface PendingCommand {
  readonly message: ParentMessage;
  readonly key: string;
  readonly promise: Promise<WorkerCommandResult>;
  readonly resolve: (result: WorkerCommandResult) => void;
  readonly reject: (error: WorkerRuntimeError) => void;
  cancelTimeout?: CancelScheduledTask;
}

export interface WorkerRuntimeService extends WorkerRuntimePort {
  startWorker(input: VersionedWorkerIdentity): Promise<WorkerCommandResult>;
  applyConfig(input: VersionedWorkerIdentity): Promise<WorkerCommandResult>;
  stopWorker(input: WorkerIdentity): Promise<WorkerCommandResult>;
  invalidateWorker(input: WorkerIdentity): void;
  getDebugSnapshot(): WorkerRuntimeDebugSnapshot;
}

export function createWorkerRuntimeService(dependencies: Dependencies): WorkerRuntimeService {
  if (!Number.isSafeInteger(dependencies.commandTimeoutMs) || dependencies.commandTimeoutMs < 1) {
    throw new Error('commandTimeoutMs must be a positive integer');
  }

  const queues = new Map<string, Promise<void>>();
  const pendingByRequest = new Map<string, PendingCommand>();
  const pendingByKey = new Map<string, PendingCommand>();
  let running = false;
  let cleanupIncomplete = false;
  let lifecycleEpoch = 0;
  let transition = Promise.resolve();

  function enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  function runBoundedLifecycle(
    operation: (signal: AbortSignal) => Promise<void>,
    timeoutCode: 'WORKER_RUNTIME_START_TIMEOUT' | 'WORKER_RUNTIME_STOP_TIMEOUT',
    timeoutMessage: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();
      const cancelTimeout = dependencies.scheduler.schedule(dependencies.commandTimeoutMs, () => {
        if (settled) return;
        settled = true;
        controller.abort();
        reject(new WorkerRuntimeError(timeoutCode, timeoutMessage, true));
      });
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        if (error === undefined) resolve();
        else reject(error instanceof Error ? error : new Error('Worker runtime lifecycle failed'));
      };
      try {
        void operation(controller.signal).then(
          () => finish(),
          (error: unknown) => finish(error),
        );
      } catch (error) {
        finish(error);
      }
    });
  }

  function command(
    type: ParentCommandType,
    input: WorkerIdentity,
    configVersion?: number,
  ): Promise<WorkerCommandResult> {
    if (!running) return Promise.reject(stoppedError());
    const key = JSON.stringify([
      input.tenantId,
      type,
      input.generation,
      input.childId,
      configVersion ?? 'none',
    ]);
    const duplicate = pendingByKey.get(key);
    if (duplicate) return duplicate.promise;

    let resolve!: (result: WorkerCommandResult) => void;
    let reject!: (error: WorkerRuntimeError) => void;
    const promise = new Promise<WorkerCommandResult>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const requestId = dependencies.idGenerator.generate();
    const message = createMessage(type, input, requestId, configVersion);
    const pending: PendingCommand = { message, key, promise, resolve, reject };
    pendingByKey.set(key, pending);
    const commandEpoch = lifecycleEpoch;

    const previous = queues.get(input.tenantId) ?? Promise.resolve();
    const execution = previous
      .catch(() => undefined)
      .then(async () => {
        if (!running || commandEpoch !== lifecycleEpoch) throw stoppedError();
        if (pendingByKey.get(key) !== pending) return;
        pendingByRequest.set(requestId, pending);
        pending.cancelTimeout = dependencies.scheduler.schedule(
          dependencies.commandTimeoutMs,
          () => {
            settle(
              pending,
              new WorkerRuntimeError('WORKER_COMMAND_TIMEOUT', 'Worker command timed out', true),
            );
          },
        );
        void dependencies.transport.send(message).catch(() => {
          settle(
            pending,
            new WorkerRuntimeError('WA_RUNTIME_UNAVAILABLE', 'Worker runtime is unavailable', true),
            'UNAVAILABLE',
          );
        });
        await promise.then(
          () => undefined,
          () => undefined,
        );
      })
      .catch((error: unknown) => {
        settle(pending, toRuntimeError(error));
      });
    queues.set(input.tenantId, execution);
    void execution.finally(() => {
      if (queues.get(input.tenantId) === execution) queues.delete(input.tenantId);
    });
    return promise;
  }

  function onMessage(input: unknown): void {
    let message: ChildMessage;
    try {
      message = decodeChildMessage(input);
    } catch {
      return;
    }
    if (message.type === 'CONNECTION_UPDATE') {
      recordConnectionDiagnostic(message);
      return;
    }
    const pending = pendingByRequest.get(message.requestId);
    if (!pending || !matches(pending.message, message)) return;

    if (message.type === 'COMMAND_ACK') {
      settle(pending);
      return;
    }
    settle(
      pending,
      new WorkerRuntimeError(
        message.payload.error.code,
        message.payload.error.message,
        message.payload.error.retryable,
      ),
      'REJECTED',
    );
  }

  function recordConnectionDiagnostic(
    message: Extract<ChildMessage, { type: 'CONNECTION_UPDATE' }>,
  ): void {
    try {
      const result = dependencies.diagnostics.recordConnection?.({
        state: message.payload.state,
        correlationId: message.correlationId,
        tenantId: message.tenantId,
        generation: message.generation,
        childId: message.childId,
      });
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch {
      return;
    }
  }

  function settle(
    pending: PendingCommand,
    error?: WorkerRuntimeError,
    errorOutcome?: 'REJECTED' | 'UNAVAILABLE',
  ): void {
    if (pendingByKey.get(pending.key) !== pending) return;
    pending.cancelTimeout?.();
    pendingByKey.delete(pending.key);
    pendingByRequest.delete(pending.message.requestId);
    if (error) {
      if (errorOutcome) recordDiagnostic(pending, errorOutcome);
      else if (error.code === 'WORKER_COMMAND_TIMEOUT') recordDiagnostic(pending, 'TIMED_OUT');
      else if (error.code === 'WA_RUNTIME_STOPPED') recordDiagnostic(pending, 'RUNTIME_STOPPED');
      else recordDiagnostic(pending, 'UNAVAILABLE');
      pending.reject(error);
    } else {
      recordDiagnostic(pending, 'ACKNOWLEDGED');
      pending.resolve({ ok: true });
    }
  }

  function recordDiagnostic(
    pending: PendingCommand,
    outcome: 'ACKNOWLEDGED' | 'REJECTED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'RUNTIME_STOPPED',
  ): void {
    try {
      const result = dependencies.diagnostics.recordCommand({
        outcome,
        commandType: pending.message.type,
        correlationId: pending.message.correlationId,
        tenantId: pending.message.tenantId,
        generation: pending.message.generation,
        childId: pending.message.childId,
      });
      if (result) void Promise.resolve(result).catch(() => undefined);
    } catch {
      return;
    }
  }

  return {
    start(): Promise<void> {
      return enqueueLifecycle(async () => {
        if (running) return;
        if (cleanupIncomplete) throw new Error('Worker runtime cleanup is incomplete');
        cleanupIncomplete = true;
        const startEpoch = lifecycleEpoch;
        await runBoundedLifecycle(
          (signal) =>
            dependencies.transport.start((message) => {
              if (startEpoch === lifecycleEpoch) onMessage(message);
            }, signal),
          'WORKER_RUNTIME_START_TIMEOUT',
          'Worker runtime start timed out',
        );
        running = true;
        cleanupIncomplete = false;
      });
    },
    stop(): Promise<void> {
      return enqueueLifecycle(async () => {
        if (!running && pendingByKey.size === 0 && !cleanupIncomplete) return;
        running = false;
        lifecycleEpoch += 1;
        for (const pending of [...pendingByKey.values()]) settle(pending, stoppedError());
        try {
          await runBoundedLifecycle(
            (signal) => dependencies.transport.stop(signal),
            'WORKER_RUNTIME_STOP_TIMEOUT',
            'Worker runtime stop timed out',
          );
          cleanupIncomplete = false;
        } catch (error) {
          cleanupIncomplete = true;
          throw error;
        }
      });
    },
    async isReady(): Promise<boolean> {
      return running && !cleanupIncomplete && dependencies.transport.isReady();
    },
    startWorker(input): Promise<WorkerCommandResult> {
      return command('START_WORKER', input, input.configVersion);
    },
    applyConfig(input): Promise<WorkerCommandResult> {
      return command('APPLY_CONFIG', input, input.configVersion);
    },
    stopWorker(input): Promise<WorkerCommandResult> {
      return command('STOP_WORKER', input);
    },
    invalidateWorker(input): void {
      for (const pending of [...pendingByKey.values()]) {
        if (
          pending.message.tenantId === input.tenantId &&
          pending.message.generation === input.generation &&
          pending.message.childId === input.childId
        ) {
          settle(
            pending,
            new WorkerRuntimeError('WORKER_CHILD_EXITED', 'Worker child exited', true),
          );
        }
      }
    },
    getDebugSnapshot(): WorkerRuntimeDebugSnapshot {
      const pendingCommands = [...pendingByKey.values()].map(({ message }) =>
        Object.freeze({
          commandType: message.type,
          correlationId: message.correlationId,
          tenantId: message.tenantId,
          generation: message.generation,
          childId: message.childId,
        }),
      );
      return Object.freeze({ pendingCommands: Object.freeze(pendingCommands) });
    },
  };
}

function createMessage(
  type: ParentCommandType,
  input: WorkerIdentity,
  requestId: string,
  configVersion?: number,
): ParentMessage {
  const identity = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    requestId,
    correlationId: input.correlationId,
    tenantId: input.tenantId,
    generation: input.generation,
    childId: input.childId,
  } as const;
  if (type === 'STOP_WORKER') return { ...identity, type, payload: {} };
  if (configVersion === undefined) throw new Error('configVersion is required');
  return { ...identity, type, payload: { configVersion } };
}

function matches(
  parent: ParentMessage,
  child: Exclude<ChildMessage, { type: 'CONNECTION_UPDATE' }>,
): boolean {
  const identityMatches =
    parent.requestId === child.requestId &&
    parent.correlationId === child.correlationId &&
    parent.tenantId === child.tenantId &&
    parent.generation === child.generation &&
    parent.childId === child.childId &&
    parent.type === child.payload.commandType;
  if (!identityMatches || child.type === 'COMMAND_ERROR') return identityMatches;
  if (parent.type === 'STOP_WORKER') return child.payload.commandType === 'STOP_WORKER';
  return (
    child.payload.commandType !== 'STOP_WORKER' &&
    parent.payload.configVersion === child.payload.configVersion
  );
}

function stoppedError(): WorkerRuntimeError {
  return new WorkerRuntimeError('WA_RUNTIME_STOPPED', 'Worker runtime is stopped', true);
}

function toRuntimeError(error: unknown): WorkerRuntimeError {
  return error instanceof WorkerRuntimeError
    ? error
    : new WorkerRuntimeError('WORKER_INTERNAL_ERROR', 'Worker command failed', true);
}
