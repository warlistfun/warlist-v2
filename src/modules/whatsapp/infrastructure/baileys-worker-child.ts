import { createHash } from 'node:crypto';

import type {
  ChildMessage,
  ParentMessage,
  WorkerConnectionState,
  WorkerInboundTransportCode,
  WorkerPairingState,
} from '../../../interfaces/worker-ipc/contract';
import { decodeParentMessage } from '../../../interfaces/worker-ipc/contract';
import type { CancelScheduledTask, ScheduleTaskPort } from '../application/worker-runtime-service';
import type { LocalCredentialDirectoryHandle } from './local-whatsapp-credential-directory';
import { createLocalWhatsAppCredentialDirectory } from './local-whatsapp-credential-directory';

export interface BaileysSocketPort {
  readonly ev: {
    on(
      event: 'creds.update' | 'connection.update' | 'messages.upsert',
      listener: (update?: unknown) => void,
    ): void;
    removeAllListeners(): void;
  };
  requestPairingCode(target: string): Promise<string>;
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
  readonly now?: () => number;
}

export interface BaileysWorkerChild {
  handle(message: unknown): Promise<void>;
  stop(): Promise<void>;
}

interface ActivePairing {
  readonly target: string;
  state: WorkerPairingState;
  codeRequested: boolean;
}

interface ActiveWorker {
  readonly start: Extract<ParentMessage, { type: 'START_WORKER' }>;
  readonly directory: string;
  epoch: number;
  socket: BaileysSocketPort | undefined;
  cancelReconnect: CancelScheduledTask | undefined;
  openedAt: number | undefined;
  pairing: ActivePairing | undefined;
  pairingSignalReady: boolean;
  stopped: boolean;
}

export function createBaileysWorkerChild(dependencies: Dependencies): BaileysWorkerChild {
  if (!Number.isSafeInteger(dependencies.reconnectDelayMs) || dependencies.reconnectDelayMs < 1) {
    throw new Error('reconnectDelayMs must be a positive integer');
  }

  const now = dependencies.now ?? Date.now;
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
    worker.openedAt = undefined;
    worker.pairingSignalReady = false;
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
      if (hasPairingSignal(input)) worker.pairingSignalReady = true;
      requestPairingCode(worker, created.socket, epoch);
      const update = decodeConnectionUpdate(input);
      if (update.connection === 'open') {
        worker.cancelReconnect?.();
        worker.cancelReconnect = undefined;
        worker.openedAt = now();
        emitConnection(worker, 'OPEN');
        setPairingState(worker, 'OPEN');
        return;
      }
      if (update.connection !== 'close') return;

      setPairingState(worker, 'CLOSED');
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
    created.socket.ev.on('messages.upsert', (input) => {
      if (active !== worker || worker.stopped || worker.epoch !== epoch) return;
      handleInboundUpsert(worker, input, now());
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
          openedAt: undefined,
          pairing: undefined,
          pairingSignalReady: false,
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

    if (message.type === 'REQUEST_PAIRING') {
      if (active.pairing && active.pairing.target !== message.payload.pairingTarget) {
        sendError(message, 'WORKER_COMMAND_REJECTED');
        return;
      }
      if (!active.pairing) {
        active.pairing = {
          target: message.payload.pairingTarget,
          state: 'REQUESTED',
          codeRequested: false,
        };
        emitPairing(active, 'REQUESTED');
      }
      if (active.socket) requestPairingCode(active, active.socket, active.epoch);
      sendAcknowledgement(message);
      return;
    }

    const worker = active;
    setPairingState(worker, 'STOPPED');
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

  function handleInboundUpsert(worker: ActiveWorker, input: unknown, receivedAt: number): void {
    try {
      const type = ownValue(input, 'type');
      if (type !== 'notify') {
        emitInbound(worker, type === 'append' ? 'HISTORY_REPLAY' : 'INVALID_MESSAGE', null);
        return;
      }
      if (ownValue(input, 'requestId') !== undefined) {
        emitInbound(worker, 'HISTORY_REPLAY', null);
        return;
      }
      const messages = ownValue(input, 'messages');
      if (!isDenseBoundedArray(messages)) {
        emitInbound(worker, 'INVALID_MESSAGE', null);
        return;
      }
      for (let index = 0; index < messages.length; index += 1) {
        handleInboundMessage(worker, arrayValue(messages, index), receivedAt);
      }
    } catch {
      emitInbound(worker, 'INVALID_MESSAGE', null);
    }
  }

  function handleInboundMessage(worker: ActiveWorker, input: unknown, receivedAt: number): void {
    const key = ownValue(input, 'key');
    const rawMessageId = safeProviderIdentifier(ownValue(key, 'id'));
    const messageId =
      rawMessageId === undefined ? null : safeHash(worker.start.tenantId, 'message', rawMessageId);
    if (messageId === null) {
      emitInbound(worker, 'INVALID_MESSAGE', null);
      return;
    }

    const timestamp = providerTimestampMs(ownValue(input, 'messageTimestamp'));
    if (timestamp === undefined) {
      emitInbound(worker, 'INVALID_MESSAGE', messageId);
      return;
    }
    if (receivedAt - timestamp > 2 * 60 * 1_000) {
      emitInbound(worker, 'STALE', messageId);
      return;
    }
    if (worker.openedAt === undefined || timestamp < worker.openedAt - 5_000) {
      emitInbound(worker, 'PRE_CONNECT', messageId);
      return;
    }
    if (ownValue(key, 'fromMe') === true) {
      emitInbound(worker, 'FROM_ME', messageId);
      return;
    }

    const remoteJid = safeJid(ownValue(key, 'remoteJid'), '@g.us');
    const participant =
      safeJid(ownValue(key, 'participant'), '@s.whatsapp.net') ??
      safeJid(ownValue(key, 'participant'), '@lid');
    if (remoteJid === undefined || participant === undefined || ownValue(key, 'fromMe') !== false) {
      emitInbound(worker, 'INVALID_MESSAGE', messageId);
      return;
    }

    const content = ownValue(input, 'message');
    const conversation = safeText(ownValue(content, 'conversation'));
    const extended = ownValue(content, 'extendedTextMessage');
    const text = conversation ?? safeText(ownValue(extended, 'text'));
    if (text === undefined) {
      emitInbound(worker, 'NO_TEXT', messageId);
      return;
    }
    const contextInfo = conversation === undefined ? ownValue(extended, 'contextInfo') : undefined;
    if (ownValue(contextInfo, 'quotedMessage') !== undefined) {
      emitInbound(worker, 'QUOTED', messageId);
      return;
    }

    dependencies.send({
      ...messageIdentity(worker.start),
      type: 'INBOUND_EVENT',
      payload: {
        transportCode: 'FORWARDED',
        messageId,
        message: {
          groupId: safeHash(worker.start.tenantId, 'group', remoteJid),
          senderId: safeHash(worker.start.tenantId, 'sender', participant),
          text,
        },
      },
    });
  }

  function emitInbound(
    worker: ActiveWorker,
    transportCode: Exclude<WorkerInboundTransportCode, 'FORWARDED'>,
    messageId: string | null,
  ): void {
    dependencies.send({
      ...messageIdentity(worker.start),
      type: 'INBOUND_EVENT',
      payload: { transportCode, messageId },
    });
  }

  function requestPairingCode(
    worker: ActiveWorker,
    socket: BaileysSocketPort,
    epoch: number,
  ): void {
    const pairing = worker.pairing;
    if (
      !pairing ||
      pairing.codeRequested ||
      pairing.state !== 'REQUESTED' ||
      !worker.pairingSignalReady
    ) {
      return;
    }
    pairing.codeRequested = true;
    void socket
      .requestPairingCode(pairing.target)
      .then(() => {
        if (
          active !== worker ||
          worker.stopped ||
          worker.epoch !== epoch ||
          pairing.state !== 'REQUESTED'
        ) {
          return;
        }
        setPairingState(worker, 'CODE_READY');
      })
      .catch(() => {
        if (
          active !== worker ||
          worker.stopped ||
          worker.epoch !== epoch ||
          pairing.state !== 'REQUESTED'
        ) {
          return;
        }
        setPairingState(worker, 'FAILED');
      });
  }

  function setPairingState(worker: ActiveWorker, state: WorkerPairingState): void {
    const pairing = worker.pairing;
    if (!pairing || pairing.state === state) return;
    pairing.state = state;
    emitPairing(worker, state);
  }

  function emitPairing(worker: ActiveWorker, state: WorkerPairingState): void {
    dependencies.send({
      ...messageIdentity(worker.start),
      type: 'PAIRING_UPDATE',
      payload: { state },
    });
  }

  function sendAcknowledgement(message: ParentMessage): void {
    const identity = messageIdentity(message);
    dependencies.send(
      message.type === 'REQUEST_PAIRING' || message.type === 'STOP_WORKER'
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

function hasPairingSignal(input: unknown): boolean {
  const descriptor =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? Object.getOwnPropertyDescriptor(input, 'qr')
      : undefined;
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string' &&
    descriptor.value.length > 0
  );
}

function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function arrayValue(input: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isDenseBoundedArray(input: unknown): input is readonly unknown[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) return false;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function safeProviderIdentifier(input: unknown): string | undefined {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 256 ||
    input !== input.trim() ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input)
  ) {
    return undefined;
  }
  return input;
}

function safeJid(input: unknown, suffix: '@g.us' | '@s.whatsapp.net' | '@lid'): string | undefined {
  const value = safeProviderIdentifier(input);
  if (!value || !value.endsWith(suffix)) return undefined;
  const local = value.slice(0, -suffix.length);
  return /^[a-z0-9_:-]+$/i.test(local) ? value : undefined;
}

function providerTimestampMs(input: unknown): number | undefined {
  let value: number | undefined;
  if (typeof input === 'number' && Number.isSafeInteger(input) && input > 0) {
    value = input;
  } else if (typeof input === 'bigint' && input > 0n && input <= BigInt(Number.MAX_SAFE_INTEGER)) {
    value = Number(input);
  } else {
    const low = ownValue(input, 'low');
    const high = ownValue(input, 'high');
    const unsigned = ownValue(input, 'unsigned');
    if (
      typeof low !== 'number' ||
      !Number.isInteger(low) ||
      low < -2_147_483_648 ||
      low > 2_147_483_647 ||
      typeof high !== 'number' ||
      !Number.isInteger(high) ||
      high < -2_147_483_648 ||
      high > 2_147_483_647 ||
      typeof unsigned !== 'boolean'
    ) {
      return undefined;
    }
    const bits = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
    const decoded = unsigned ? bits : BigInt.asIntN(64, bits);
    if (decoded <= 0n || decoded > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    value = Number(decoded);
  }
  const milliseconds = value > 1e12 ? value : value * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function safeText(input: unknown): string | undefined {
  if (
    typeof input !== 'string' ||
    input.length > 4_096 ||
    /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input)
  ) {
    return undefined;
  }
  const normalized = input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/gu, '\n')
    .normalize('NFC')
    .trim();
  return normalized.length > 0 && normalized.length <= 4_096 ? normalized : undefined;
}

function safeHash(tenantId: string, kind: 'message' | 'group' | 'sender', input: string): string {
  return `${kind}:${createHash('sha256').update(tenantId).update('\0').update(kind).update('\0').update(input).digest('hex')}`;
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
            socket.ev.removeAllListeners('messages.upsert');
          },
        },
        requestPairingCode(target): Promise<string> {
          return socket.requestPairingCode(target);
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
