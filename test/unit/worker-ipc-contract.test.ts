import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IPC_PROTOCOL_VERSION,
  IpcProtocolError,
  decodeChildMessage,
  decodeParentMessage,
} from '../../src/interfaces/worker-ipc/contract';

const identity = {
  protocolVersion: IPC_PROTOCOL_VERSION,
  requestId: 'req_example_1',
  correlationId: 'corr_example_1',
  tenantId: 'tenant_example_1',
  generation: 2,
  childId: 'child_example_1',
} as const;

void test('decodes immutable IPC v1 parent commands', () => {
  const messages = [
    {
      ...identity,
      type: 'START_WORKER',
      payload: { configVersion: 3 },
    },
    {
      ...identity,
      type: 'APPLY_CONFIG',
      payload: { configVersion: 4 },
    },
    {
      ...identity,
      type: 'STOP_WORKER',
      payload: {},
    },
    {
      ...identity,
      type: 'RESET_WORKER',
      payload: {},
    },
  ] as const;

  for (const input of messages) {
    const decoded = decodeParentMessage(input);
    assert.deepEqual(decoded, input);
    assert.equal(Object.isFrozen(decoded), true);
    assert.equal(Object.isFrozen(decoded.payload), true);
  }
});

void test('decodes immutable IPC v1 connection updates with a safe state projection', () => {
  const decoded = decodeChildMessage({
    ...identity,
    type: 'CONNECTION_UPDATE',
    payload: { state: 'OPEN' },
  });

  assert.deepEqual(decoded, {
    ...identity,
    type: 'CONNECTION_UPDATE',
    payload: { state: 'OPEN' },
  });
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.payload), true);
});

void test('decodes an immutable safe inbound projection without provider identifiers', () => {
  const input = {
    ...identity,
    type: 'INBOUND_EVENT',
    payload: {
      transportCode: 'FORWARDED',
      messageId: `message:${'a'.repeat(64)}`,
      message: {
        groupId: `group:${'b'.repeat(64)}`,
        senderId: `sender:${'c'.repeat(64)}`,
        text: 'list today',
      },
    },
  } as const;

  const decoded = decodeChildMessage(input);
  assert.deepEqual(decoded, input);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.payload), true);
  if (decoded.type !== 'INBOUND_EVENT' || decoded.payload.transportCode !== 'FORWARDED') {
    throw new Error('expected forwarded inbound event');
  }
  assert.equal(Object.isFrozen(decoded.payload.message), true);
});

void test('rejects malformed inbound projections without echoing provider content', () => {
  const sensitiveMarker = 'provider-content-must-not-leak';
  for (const input of [
    {
      ...identity,
      type: 'INBOUND_EVENT',
      payload: {
        transportCode: 'FORWARDED',
        messageId: sensitiveMarker,
        message: {
          groupId: `group:${'b'.repeat(64)}`,
          senderId: `sender:${'c'.repeat(64)}`,
          text: 'list today',
        },
      },
    },
    {
      ...identity,
      type: 'INBOUND_EVENT',
      payload: {
        transportCode: 'FORWARDED',
        messageId: `message:${'a'.repeat(64)}`,
        message: {
          groupId: sensitiveMarker,
          senderId: `sender:${'c'.repeat(64)}`,
          text: 'list today',
          rawJid: sensitiveMarker,
        },
      },
    },
    {
      ...identity,
      type: 'INBOUND_EVENT',
      payload: { transportCode: 'RAW_PROVIDER_CODE', messageId: null },
    },
  ]) {
    assertProtocolError(
      () => decodeChildMessage(input),
      'IPC_INVALID_MESSAGE',
      'Invalid worker IPC message',
      sensitiveMarker,
    );
  }
});

void test('decodes immutable IPC v1 child acknowledgements and safe errors', () => {
  const acknowledgements = [
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'START_WORKER', configVersion: 3 },
    },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'APPLY_CONFIG', configVersion: 4 },
    },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'RESET_WORKER' },
    },
  ] as const;
  const failure = {
    ...identity,
    type: 'COMMAND_ERROR',
    payload: {
      commandType: 'START_WORKER',
      error: {
        code: 'WA_RUNTIME_UNAVAILABLE',
        message: 'Worker runtime is unavailable',
        retryable: true,
      },
    },
  } as const;

  for (const input of [...acknowledgements, failure]) {
    const decoded = decodeChildMessage(input);
    assert.deepEqual(decoded, input);
    assert.equal(Object.isFrozen(decoded), true);
    assert.equal(Object.isFrozen(decoded.payload), true);
  }

  const decodedFailure = decodeChildMessage(failure);
  if (decodedFailure.type === 'COMMAND_ERROR') {
    assert.equal(Object.isFrozen(decodedFailure.payload.error), true);
  }
});

void test('rejects command acknowledgements with contradictory payload fields', () => {
  const invalidAcknowledgements = [
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'START_WORKER' },
    },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER', configVersion: 9 },
    },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'RESET_WORKER', configVersion: 9 },
    },
  ];

  for (const input of invalidAcknowledgements) {
    assertProtocolError(
      () => decodeChildMessage(input),
      'IPC_INVALID_MESSAGE',
      'Invalid worker IPC message',
    );
  }
});

void test('rejects unsupported IPC versions with a stable safe error in both directions', () => {
  assertProtocolError(
    () =>
      decodeParentMessage({ ...identity, protocolVersion: 2, type: 'STOP_WORKER', payload: {} }),
    'IPC_UNSUPPORTED_VERSION',
    'Unsupported worker IPC protocol version',
  );
  assertProtocolError(
    () =>
      decodeChildMessage({
        ...identity,
        protocolVersion: 2,
        type: 'COMMAND_ACK',
        payload: { commandType: 'STOP_WORKER', configVersion: 1 },
      }),
    'IPC_UNSUPPORTED_VERSION',
    'Unsupported worker IPC protocol version',
  );
});

void test('rejects unknown IPC message types with a stable safe error', () => {
  assertProtocolError(
    () => decodeParentMessage({ ...identity, type: 'DELETE_EVERYTHING', payload: {} }),
    'IPC_UNKNOWN_MESSAGE_TYPE',
    'Unknown worker IPC message type',
  );
});

void test('rejects child errors that contain non-canonical diagnostic content', () => {
  const sensitiveMarker = 'customer-content-must-not-leak';
  assertProtocolError(
    () =>
      decodeChildMessage({
        ...identity,
        type: 'COMMAND_ERROR',
        payload: {
          commandType: 'START_WORKER',
          error: {
            code: 'WA_RUNTIME_UNAVAILABLE',
            message: sensitiveMarker,
            retryable: true,
          },
        },
      }),
    'IPC_INVALID_MESSAGE',
    'Invalid worker IPC message',
    sensitiveMarker,
  );
});

void test('rejects inherited safe-error registry properties', () => {
  for (const code of ['toString', '__proto__']) {
    assertProtocolError(
      () =>
        decodeChildMessage({
          ...identity,
          type: 'COMMAND_ERROR',
          payload: {
            commandType: 'START_WORKER',
            error: { code, message: undefined, retryable: undefined },
          },
        }),
      'IPC_INVALID_MESSAGE',
      'Invalid worker IPC message',
    );
  }
});

void test('rejects malformed child schemas and unsafe identifiers', () => {
  const invalidMessages: unknown[] = [
    { ...identity, type: 'UNKNOWN_CHILD_MESSAGE', payload: {} },
    {
      ...identity,
      type: 'COMMAND_ACK',
      payload: { commandType: 'APPLY_CONFIG', configVersion: 1, extra: true },
    },
    {
      ...identity,
      type: 'COMMAND_ERROR',
      payload: {
        commandType: 'START_WORKER',
        error: {
          code: 'WA_RUNTIME_UNAVAILABLE',
          message: 'Worker runtime is unavailable',
          retryable: true,
          extra: true,
        },
      },
    },
    {
      ...identity,
      requestId: 'request\nforged',
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
    {
      ...identity,
      requestId: 'request\u0085forged',
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
    {
      ...identity,
      requestId: 'request\u2028forged',
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
    {
      ...identity,
      requestId: 'request\u2029forged',
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
    {
      ...identity,
      childId: ' child_example_1 ',
      type: 'COMMAND_ACK',
      payload: { commandType: 'STOP_WORKER' },
    },
  ];

  for (const input of invalidMessages) {
    assert.throws(() => decodeChildMessage(input), IpcProtocolError);
  }
});

void test('rejects malformed identities, generations, and payloads without echoing input', () => {
  const sensitiveMarker = 'customer-content-must-not-leak';
  const invalidMessages: unknown[] = [
    { ...identity, requestId: '', type: 'STOP_WORKER', payload: {} },
    { ...identity, correlationId: '', type: 'STOP_WORKER', payload: {} },
    { ...identity, tenantId: '', type: 'STOP_WORKER', payload: {} },
    { ...identity, childId: '', type: 'STOP_WORKER', payload: {} },
    { ...identity, generation: 0, type: 'STOP_WORKER', payload: {} },
    {
      ...identity,
      type: 'APPLY_CONFIG',
      payload: { configVersion: 0, rawMessage: sensitiveMarker },
    },
    sensitiveMarker,
  ];

  for (const input of invalidMessages) {
    assertProtocolError(
      () => decodeParentMessage(input),
      'IPC_INVALID_MESSAGE',
      'Invalid worker IPC message',
      sensitiveMarker,
    );
  }
});

function assertProtocolError(
  operation: () => unknown,
  code: string,
  message: string,
  forbiddenText?: string,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof IpcProtocolError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.retryable, false);
    if (forbiddenText !== undefined) {
      assert.equal(error.message.includes(forbiddenText), false);
    }
    return true;
  });
}
