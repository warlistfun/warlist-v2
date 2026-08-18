export const IPC_PROTOCOL_VERSION = 1 as const;

export type ParentCommandType = 'START_WORKER' | 'APPLY_CONFIG' | 'STOP_WORKER';

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

export type ParentMessage =
  | (MessageIdentity & {
      readonly type: 'START_WORKER' | 'APPLY_CONFIG';
      readonly payload: VersionedConfigPayload;
    })
  | (MessageIdentity & {
      readonly type: 'STOP_WORKER';
      readonly payload: Readonly<Record<string, never>>;
    });

export interface SafeIpcError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type ChildMessage =
  | (MessageIdentity & {
      readonly type: 'COMMAND_ACK';
      readonly payload: Readonly<{
        commandType: ParentCommandType;
        configVersion: number;
      }>;
    })
  | (MessageIdentity & {
      readonly type: 'COMMAND_ERROR';
      readonly payload: Readonly<{
        commandType: ParentCommandType;
        error: SafeIpcError;
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
    case 'STOP_WORKER':
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
      requireExactKeys(message.payload, ['commandType', 'configVersion']);
      const commandType = decodeCommandType(message.payload.commandType);
      const configVersion = decodePositiveInteger(message.payload.configVersion);
      return freeze({
        ...message.identity,
        type: message.type,
        payload: freeze({ commandType, configVersion }),
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
  if (!isNonEmptyString(input.code) || !(input.code in safeErrors)) throw invalidMessage();

  const code = input.code as keyof typeof safeErrors;
  const expected = safeErrors[code];
  if (input.message !== expected.message || input.retryable !== expected.retryable) {
    throw invalidMessage();
  }

  return freeze({ code, ...expected });
}

function decodeCommandType(input: unknown): ParentCommandType {
  if (input === 'START_WORKER' || input === 'APPLY_CONFIG' || input === 'STOP_WORKER') return input;
  throw invalidMessage();
}

function decodeIdentifier(input: unknown): string {
  if (!isNonEmptyString(input) || input.length > 128) throw invalidMessage();
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
