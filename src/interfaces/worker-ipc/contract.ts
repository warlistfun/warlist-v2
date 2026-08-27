export const IPC_PROTOCOL_VERSION = 1 as const;

export type ParentCommandType =
  'START_WORKER' | 'APPLY_CONFIG' | 'REQUEST_PAIRING' | 'STOP_WORKER' | 'RESET_WORKER';

export type WorkerConnectionState =
  'CONNECTING' | 'OPEN' | 'CLOSED_RETRYING' | 'LOGGED_OUT' | 'CREDENTIALS_SAVE_FAILED' | 'STOPPED';

export type WorkerPairingState =
  'REQUESTED' | 'CODE_READY' | 'OPEN' | 'CLOSED' | 'FAILED' | 'STOPPED';

export type WorkerInboundTransportCode =
  | 'FORWARDED'
  | 'HISTORY_REPLAY'
  | 'FROM_ME'
  | 'STALE'
  | 'PRE_CONNECT'
  | 'QUOTED'
  | 'NO_TEXT'
  | 'INVALID_MESSAGE';

export type WorkerInboundMessage = Readonly<{
  groupId: string;
  senderId: string;
  text: string;
}>;

interface MessageIdentity {
  readonly protocolVersion: typeof IPC_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly generation: number;
  readonly childId: string;
}

interface VersionedConfigPayload {
  readonly configVersion: number;
}

export type PairingRequestPayload = Readonly<{
  pairingTarget: string;
}>;

export type ParentMessage =
  | (MessageIdentity & {
      readonly type: 'START_WORKER';
      readonly payload: VersionedConfigPayload;
    })
  | (MessageIdentity & {
      readonly type: 'APPLY_CONFIG';
      readonly payload: VersionedConfigPayload;
    })
  | (MessageIdentity & {
      readonly type: 'REQUEST_PAIRING';
      readonly payload: PairingRequestPayload;
    })
  | (MessageIdentity & {
      readonly type: 'STOP_WORKER' | 'RESET_WORKER';
      readonly payload: Readonly<Record<string, never>>;
    });

export type SafeIpcError =
  | Readonly<{
      code: 'WA_RUNTIME_UNAVAILABLE';
      message: 'Worker runtime is unavailable';
      retryable: true;
    }>
  | Readonly<{
      code: 'WORKER_COMMAND_REJECTED';
      message: 'Worker command was rejected';
      retryable: false;
    }>
  | Readonly<{
      code: 'WORKER_INTERNAL_ERROR';
      message: 'Worker command failed';
      retryable: true;
    }>;

export type ChildMessage =
  | (MessageIdentity & {
      readonly type: 'COMMAND_ACK';
      readonly payload:
        | Readonly<{
            commandType: 'START_WORKER' | 'APPLY_CONFIG';
            configVersion: number;
          }>
        | Readonly<{
            commandType: 'REQUEST_PAIRING' | 'STOP_WORKER' | 'RESET_WORKER';
          }>;
    })
  | (MessageIdentity & {
      readonly type: 'PAIRING_UPDATE';
      readonly payload: Readonly<{
        state: WorkerPairingState;
      }>;
    })
  | (MessageIdentity & {
      readonly type: 'COMMAND_ERROR';
      readonly payload: Readonly<{
        commandType: ParentCommandType;
        error: SafeIpcError;
      }>;
    })
  | (MessageIdentity & {
      readonly type: 'CONNECTION_UPDATE';
      readonly payload: Readonly<{
        state: WorkerConnectionState;
      }>;
    })
  | (MessageIdentity & {
      readonly type: 'INBOUND_EVENT';
      readonly payload:
        | Readonly<{
            transportCode: 'FORWARDED';
            messageId: string;
            message: WorkerInboundMessage;
          }>
        | Readonly<{
            transportCode: Exclude<WorkerInboundTransportCode, 'FORWARDED'>;
            messageId: string | null;
          }>;
    });

export type IpcProtocolErrorCode =
  'IPC_INVALID_MESSAGE' | 'IPC_UNKNOWN_MESSAGE_TYPE' | 'IPC_UNSUPPORTED_VERSION';

export class IpcProtocolError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: IpcProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IpcProtocolError';
  }
}

export function decodeParentMessage(input: unknown): ParentMessage {
  const message = decodeIdentity(input);

  switch (message.type) {
    case 'START_WORKER':
    case 'APPLY_CONFIG':
      return freeze({
        ...message.identity,
        type: message.type,
        payload: decodeVersionedConfig(message.payload),
      });
    case 'REQUEST_PAIRING':
      return freeze({
        ...message.identity,
        type: message.type,
        payload: decodePairingRequest(message.payload),
      });
    case 'STOP_WORKER':
    case 'RESET_WORKER':
      requireExactKeys(message.payload, []);
      return freeze({ ...message.identity, type: message.type, payload: freeze({}) });
    default:
      throw unknownType();
  }
}

export function decodeChildMessage(input: unknown): ChildMessage {
  const message = decodeIdentity(input);

  switch (message.type) {
    case 'COMMAND_ACK': {
      const commandType = decodeCommandType(message.payload.commandType);
      if (
        commandType === 'REQUEST_PAIRING' ||
        commandType === 'STOP_WORKER' ||
        commandType === 'RESET_WORKER'
      ) {
        requireExactKeys(message.payload, ['commandType']);
        return freeze({
          ...message.identity,
          type: message.type,
          payload: freeze({ commandType }),
        });
      }
      requireExactKeys(message.payload, ['commandType', 'configVersion']);
      const configVersion = decodePositiveInteger(message.payload.configVersion);
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({ commandType, configVersion }),
      });
    }
    case 'PAIRING_UPDATE': {
      requireExactKeys(message.payload, ['state']);
      const state = decodePairingState(message.payload.state);
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({ state }),
      });
    }
    case 'COMMAND_ERROR': {
      requireExactKeys(message.payload, ['commandType', 'error']);
      const commandType = decodeCommandType(message.payload.commandType);
      const error = decodeSafeError(message.payload.error);
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({ commandType, error }),
      });
    }
    case 'CONNECTION_UPDATE': {
      requireExactKeys(message.payload, ['state']);
      const state = decodeConnectionState(message.payload.state);
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({ state }),
      });
    }
    case 'INBOUND_EVENT': {
      const transportCode = decodeInboundTransportCode(message.payload.transportCode);
      const messageId = decodeNullableSafeMessageId(message.payload.messageId);
      if (transportCode !== 'FORWARDED') {
        requireExactKeys(message.payload, ['transportCode', 'messageId']);
        return freeze({
          ...message.identity,
          type: message.type,
          payload: freeze({ transportCode, messageId }),
        });
      }
      requireExactKeys(message.payload, ['transportCode', 'messageId', 'message']);
      if (messageId === null) throw invalidMessage();
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({
          transportCode,
          messageId,
          message: decodeInboundMessage(message.payload.message),
        }),
      });
    }
    default:
      throw unknownType();
  }
}

function decodeIdentity(input: unknown): {
  identity: MessageIdentity;
  type: string;
  payload: Record<string, unknown>;
} {
  if (!isRecord(input)) throw invalidMessage();

  if (input.protocolVersion !== IPC_PROTOCOL_VERSION) {
    if (typeof input.protocolVersion === 'number') {
      throw new IpcProtocolError(
        'IPC_UNSUPPORTED_VERSION',
        'Unsupported worker IPC protocol version',
      );
    }
    throw invalidMessage();
  }

  requireExactKeys(input, [
    'protocolVersion',
    'requestId',
    'correlationId',
    'tenantId',
    'generation',
    'childId',
    'type',
    'payload',
  ]);

  const requestId = decodeIdentifier(input.requestId);
  const correlationId = decodeIdentifier(input.correlationId);
  const tenantId = decodeIdentifier(input.tenantId);
  const generation = decodePositiveInteger(input.generation);
  const childId = decodeIdentifier(input.childId);
  if (typeof input.type !== 'string' || !isRecord(input.payload)) throw invalidMessage();

  return {
    identity: freeze({
      protocolVersion: IPC_PROTOCOL_VERSION,
      requestId,
      correlationId,
      tenantId,
      generation,
      childId,
    }),
    type: input.type,
    payload: input.payload,
  };
}

function decodeVersionedConfig(input: Record<string, unknown>): VersionedConfigPayload {
  requireExactKeys(input, ['configVersion']);
  return freeze({ configVersion: decodePositiveInteger(input.configVersion) });
}

function decodePairingRequest(input: Record<string, unknown>): PairingRequestPayload {
  requireExactKeys(input, ['pairingTarget']);
  const pairingTarget = decodeIdentifier(input.pairingTarget);
  if (!/^synthetic_[a-z0-9_:-]+$/i.test(pairingTarget)) throw invalidMessage();
  return freeze({ pairingTarget });
}

const safeErrors = {
  WA_RUNTIME_UNAVAILABLE: {
    message: 'Worker runtime is unavailable',
    retryable: true,
  },
  WORKER_COMMAND_REJECTED: {
    message: 'Worker command was rejected',
    retryable: false,
  },
  WORKER_INTERNAL_ERROR: {
    message: 'Worker command failed',
    retryable: true,
  },
} as const;

function decodeSafeError(input: unknown): SafeIpcError {
  if (!isRecord(input)) throw invalidMessage();
  requireExactKeys(input, ['code', 'message', 'retryable']);
  if (!isNonEmptyString(input.code) || !Object.hasOwn(safeErrors, input.code)) {
    throw invalidMessage();
  }

  const code = input.code as keyof typeof safeErrors;
  const expected = safeErrors[code];
  if (input.message !== expected.message || input.retryable !== expected.retryable) {
    throw invalidMessage();
  }

  switch (code) {
    case 'WA_RUNTIME_UNAVAILABLE':
      return freeze({ code, ...safeErrors[code] });
    case 'WORKER_COMMAND_REJECTED':
      return freeze({ code, ...safeErrors[code] });
    case 'WORKER_INTERNAL_ERROR':
      return freeze({ code, ...safeErrors[code] });
  }
}

function decodeCommandType(input: unknown): ParentCommandType {
  if (
    input === 'START_WORKER' ||
    input === 'APPLY_CONFIG' ||
    input === 'REQUEST_PAIRING' ||
    input === 'STOP_WORKER' ||
    input === 'RESET_WORKER'
  ) {
    return input;
  }
  throw invalidMessage();
}

function decodePairingState(input: unknown): WorkerPairingState {
  if (
    input === 'REQUESTED' ||
    input === 'CODE_READY' ||
    input === 'OPEN' ||
    input === 'CLOSED' ||
    input === 'FAILED' ||
    input === 'STOPPED'
  ) {
    return input;
  }
  throw invalidMessage();
}

function decodeConnectionState(input: unknown): WorkerConnectionState {
  if (
    input === 'CONNECTING' ||
    input === 'OPEN' ||
    input === 'CLOSED_RETRYING' ||
    input === 'LOGGED_OUT' ||
    input === 'CREDENTIALS_SAVE_FAILED' ||
    input === 'STOPPED'
  ) {
    return input;
  }
  throw invalidMessage();
}

function decodeInboundTransportCode(input: unknown): WorkerInboundTransportCode {
  if (
    input === 'FORWARDED' ||
    input === 'HISTORY_REPLAY' ||
    input === 'FROM_ME' ||
    input === 'STALE' ||
    input === 'PRE_CONNECT' ||
    input === 'QUOTED' ||
    input === 'NO_TEXT' ||
    input === 'INVALID_MESSAGE'
  ) {
    return input;
  }
  throw invalidMessage();
}

function decodeNullableSafeMessageId(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || !/^message:[a-f0-9]{64}$/.test(input)) throw invalidMessage();
  return input;
}

function decodeInboundMessage(input: unknown): WorkerInboundMessage {
  if (!isRecord(input)) throw invalidMessage();
  requireExactKeys(input, ['groupId', 'senderId', 'text']);
  if (
    typeof input.groupId !== 'string' ||
    !/^group:[a-f0-9]{64}$/.test(input.groupId) ||
    typeof input.senderId !== 'string' ||
    !/^sender:[a-f0-9]{64}$/.test(input.senderId) ||
    typeof input.text !== 'string' ||
    input.text.length < 1 ||
    input.text.length > 4_096 ||
    input.text !== input.text.trim() ||
    input.text !== input.text.normalize('NFC') ||
    /\r|[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(input.text)
  ) {
    throw invalidMessage();
  }
  return freeze({ groupId: input.groupId, senderId: input.senderId, text: input.text });
}

function decodeIdentifier(input: unknown): string {
  if (
    !isNonEmptyString(input) ||
    input.length > 128 ||
    input !== input.trim() ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input)
  ) {
    throw invalidMessage();
  }
  return input;
}

function decodePositiveInteger(input: unknown): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1) throw invalidMessage();
  return input as number;
}

function requireExactKeys(input: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalidMessage();
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function invalidMessage(): IpcProtocolError {
  return new IpcProtocolError('IPC_INVALID_MESSAGE', 'Invalid worker IPC message');
}

function unknownType(): IpcProtocolError {
  return new IpcProtocolError('IPC_UNKNOWN_MESSAGE_TYPE', 'Unknown worker IPC message type');
}
