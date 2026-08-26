import type {
  ChildMessage,
  ParentMessage,
  WorkerConnectionState,
} from '../../../interfaces/worker-ipc/contract';
import { decodeParentMessage } from '../../../interfaces/worker-ipc/contract';
import type { CancelScheduledTask, ScheduleTaskPort } from '../application/worker-runtime-service';
import type { LocalCredentialDirectoryHandle } from './local-whatsapp-credential-directory';
import { createLocalWhatsAppCredentialDirectory } from './local-whatsapp-credential-directory';

export interface BaileysSocketPort {
  readonly ev: {
    on(event: 'creds.update' | 'connection.update', listener: (update?: unknown) => void): void;
    removeAllListeners(): void;
  };
  end(): void;
}

export interface BaileysSocketFactoryPort {
  create(directory: string): Promise<{
    readonly socket: BaileysSocketPort;
    readonly saveCredentials: () => Promise<void>;
    readonly loggedOutStatusCode: number;
  }>;
}

interface CredentialDirectoryPort {
  prepare(tenantId: string): Promise<LocalCredentialDirectoryHandle>;
}

interface Dependencies {
  readonly credentialDirectory: CredentialDirectoryPort;
  readonly socketFactory: BaileysSocketFactoryPort;
  readonly scheduler: ScheduleTaskPort;
  readonly reconnectDelayMs: number;
  readonly send: (message: ChildMessage) => void;
}

export interface BaileysWorkerChild {
  handle(message: unknown): Promise<void>;
  stop(): Promise<void>;
}

interface ActiveWorker {
  readonly start: Extract<ParentMessage, { type: 'START_WORKER' }>;
  readonly directory: string;
  epoch: number;
  socket: BaileysSocketPort | undefined;
  cancelReconnect: CancelScheduledTask | undefined;
  stopped: boolean;
}

export function createBaileysWorkerChild(dependencies: Dependencies): BaileysWorkerChild {
  if (!Number.isSafeInteger(dependencies.reconnectDelayMs) || dependencies.reconnectDelayMs < 1) {
    throw new Error('reconnectDelayMs must be a positive integer');
  }

  let active: ActiveWorker | undefined;
  let transition = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  async function connect(worker: ActiveWorker): Promise<void> {
    const epoch = ++worker.epoch;
    worker.cancelReconnect?.();
    worker.cancelReconnect = undefined;
    disposeSocket(worker);
    emitConnection(worker, 'CONNECTING');

    const created = await dependencies.socketFactory.create(worker.directory);
    if (active !== worker || worker.stopped || worker.epoch !== epoch) {
      created.socket.ev.removeAllListeners();
      created.socket.end();
      return;
    }

    worker.socket = created.socket;
    created.socket.ev.on('creds.update', () => {
      if (active !== worker || worker.stopped || worker.epoch !== epoch) return;
      void created.saveCredentials().catch(() => {
        if (active === worker && !worker.stopped && worker.epoch === epoch) {
          emitConnection(worker, 'CREDENTIALS_SAVE_FAILED');
        }
      });
    });
    created.socket.ev.on('connection.update', (input) => {
      if (active !== worker || worker.stopped || worker.epoch !== epoch) return;
      const update = decodeConnectionUpdate(input);
      if (update.connection === 'open') {
        worker.cancelReconnect?.();
        worker.cancelReconnect = undefined;
        emitConnection(worker, 'OPEN');
        return;
      }
      if (update.connection !== 'close') return;

      disposeSocket(worker);
      if (update.statusCode === created.loggedOutStatusCode) {
        emitConnection(worker, 'LOGGED_OUT');
        return;
      }

      emitConnection(worker, 'CLOSED_RETRYING');
      worker.cancelReconnect = dependencies.scheduler.schedule(
        dependencies.reconnectDelayMs,
        () => {
          worker.cancelReconnect = undefined;
          if (active !== worker || worker.stopped || worker.epoch !== epoch) return;
          void connect(worker).catch(() => {
            if (active === worker && !worker.stopped) emitConnection(worker, 'CLOSED_RETRYING');
          });
        },
      );
    });
  }

  async function handleCommand(message: ParentMessage): Promise<void> {
    if (message.type === 'START_WORKER') {
      if (active) {
        sendError(message, 'WORKER_COMMAND_REJECTED');
        return;
      }
      try {
        const { directory } = await dependencies.credentialDirectory.prepare(message.tenantId);
        const worker: ActiveWorker = {
          start: message,
          directory,
          epoch: 0,
          socket: undefined,
          cancelReconnect: undefined,
          stopped: false,
        };
        active = worker;
        await connect(worker);
        if (active !== worker || worker.stopped) throw new Error('worker start was superseded');
        sendAcknowledgement(message);
      } catch {
        stopActive();
        sendError(message, 'WA_RUNTIME_UNAVAILABLE');
      }
      return;
    }

    if (!active || !sameWorker(active.start, message)) {
      sendError(message, 'WORKER_COMMAND_REJECTED');
      return;
    }

    if (message.type === 'APPLY_CONFIG') {
      sendError(message, 'WORKER_COMMAND_REJECTED');
      return;
    }

    const worker = active;
    stopActive();
    emitConnection(worker, 'STOPPED');
    sendAcknowledgement(message);
  }

  function stopActive(): void {
    const worker = active;
    if (!worker) return;
    active = undefined;
    worker.stopped = true;
    worker.epoch += 1;
    worker.cancelReconnect?.();
    worker.cancelReconnect = undefined;
    disposeSocket(worker);
  }

  function emitConnection(worker: ActiveWorker, state: WorkerConnectionState): void {
    dependencies.send({
      protocolVersion: worker.start.protocolVersion,
      requestId: worker.start.requestId,
      correlationId: worker.start.correlationId,
      tenantId: worker.start.tenantId,
      generation: worker.start.generation,
      childId: worker.start.childId,
      type: 'CONNECTION_UPDATE',
      payload: { state },
    });
  }

  function sendAcknowledgement(message: ParentMessage): void {
    const identity = messageIdentity(message);
    dependencies.send(
      message.type === 'STOP_WORKER'
        ? { ...identity, type: 'COMMAND_ACK', payload: { commandType: message.type } }
        : {
            ...identity,
            type: 'COMMAND_ACK',
            payload: { commandType: message.type, configVersion: message.payload.configVersion },
          },
    );
  }

  function sendError(
    message: ParentMessage,
    code: 'WA_RUNTIME_UNAVAILABLE' | 'WORKER_COMMAND_REJECTED',
  ): void {
    dependencies.send({
      ...messageIdentity(message),
      type: 'COMMAND_ERROR',
      payload: {
        commandType: message.type,
        error:
          code === 'WA_RUNTIME_UNAVAILABLE'
            ? {
                code,
                message: 'Worker runtime is unavailable',
                retryable: true,
              }
            : {
                code,
                message: 'Worker command was rejected',
                retryable: false,
              },
      },
    });
  }

  return {
    handle(input): Promise<void> {
      let message: ParentMessage;
      try {
        message = decodeParentMessage(input);
      } catch {
        return Promise.resolve();
      }
      return enqueue(() => handleCommand(message));
    },
    stop(): Promise<void> {
      return enqueue(() => {
        stopActive();
        return Promise.resolve();
      });
    },
  };
}

function disposeSocket(worker: ActiveWorker): void {
  const socket = worker.socket;
  worker.socket = undefined;
  if (!socket) return;
  socket.ev.removeAllListeners();
  socket.end();
}

function sameWorker(start: ParentMessage, command: ParentMessage): boolean {
  return (
    start.tenantId === command.tenantId &&
    start.generation === command.generation &&
    start.childId === command.childId
  );
}

function messageIdentity(message: ParentMessage) {
  return {
    protocolVersion: message.protocolVersion,
    requestId: message.requestId,
    correlationId: message.correlationId,
    tenantId: message.tenantId,
    generation: message.generation,
    childId: message.childId,
  } as const;
}

function decodeConnectionUpdate(input: unknown): {
  readonly connection?: 'open' | 'close';
  readonly statusCode?: number;
} {
  const connection = ownValue(input, 'connection');
  const error = ownValue(ownValue(input, 'lastDisconnect'), 'error');
  const statusCode = ownValue(ownValue(error, 'output'), 'statusCode');
  return {
    ...(connection === 'open' || connection === 'close' ? { connection } : {}),
    ...(Number.isSafeInteger(statusCode) ? { statusCode: statusCode as number } : {}),
  };
}

function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

const concreteSocketFactory: BaileysSocketFactoryPort = {
  async create(directory) {
    const baileys = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await baileys.useMultiFileAuthState(directory);
    const socket = baileys.default({
      auth: state,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      syncFullHistory: false,
    });
    return {
      loggedOutStatusCode: baileys.DisconnectReason.loggedOut,
      saveCredentials: saveCreds,
      socket: {
        ev: {
          on(event, listener): void {
            socket.ev.on(event, listener);
          },
          removeAllListeners(): void {
            socket.ev.removeAllListeners('creds.update');
            socket.ev.removeAllListeners('connection.update');
          },
        },
        end(): void {
          socket.end(undefined);
        },
      },
    };
  },
};

const reconnectScheduler: ScheduleTaskPort = {
  schedule(delayMs, task) {
    const handle = setTimeout(task, delayMs);
    return () => clearTimeout(handle);
  },
};

export function runBaileysWorkerChildProcess(credentialRoot: string): void {
  if (typeof process.send !== 'function') throw new Error('Worker IPC channel is unavailable');
  const child = createBaileysWorkerChild({
    credentialDirectory: createLocalWhatsAppCredentialDirectory({ root: credentialRoot }),
    socketFactory: concreteSocketFactory,
    scheduler: reconnectScheduler,
    reconnectDelayMs: 2_000,
    send(message) {
      if (process.connected) process.send?.(message);
    },
  });
  process.on('message', (message) => {
    void child.handle(message);
  });
  process.once('disconnect', () => {
    void child.stop();
  });
}

if (require.main === module) {
  const credentialRoot = process.argv[2];
  if (!credentialRoot) throw new Error('Credential root is required');
  runBaileysWorkerChildProcess(credentialRoot);
}
