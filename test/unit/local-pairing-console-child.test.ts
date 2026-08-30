import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';

import {
  createBaileysWorkerChild,
  type BaileysSocketPort,
} from '../../src/modules/whatsapp/infrastructure/baileys-worker-child';
import { createLocalPairingConsole } from '../../src/modules/whatsapp/infrastructure/local-pairing-console';

const identity = {
  protocolVersion: 1,
  requestId: 'request_example_185',
  correlationId: 'correlation_example_185',
  tenantId: '00000000-0000-4000-8000-000000000185',
  generation: 1,
  childId: 'child_example_185',
} as const;

void test('opens a child-owned loopback console and keeps its raw pairing material out of IPC', async (t) => {
  const sent: unknown[] = [];
  const socket = new FakeSocket();
  let address: Readonly<{ host: '127.0.0.1'; port: number }> | undefined;
  const child = createBaileysWorkerChild({
    credentialDirectory: {
      acquire: () =>
        Promise.resolve({
          use: <T>(operation: (directory: string) => T | PromiseLike<T>) =>
            Promise.resolve(operation('/tmp/om-18-5')),
          reset: () => Promise.resolve(),
          release: () => Promise.resolve(),
        }),
    },
    socketFactory: {
      create: () =>
        Promise.resolve({
          socket,
          saveCredentials: () => Promise.resolve(),
          loggedOutStatusCode: 401,
        }),
    },
    scheduler: { schedule: () => () => undefined },
    reconnectDelayMs: 1,
    send: (message) => sent.push(message),
    pairingConsole({ requestCode }) {
      const console_ = createLocalPairingConsole({ port: 0, requestCode });
      return {
        ...console_,
        async start() {
          address = await console_.start();
          return address;
        },
      };
    },
  });

  await child.handle({ ...identity, type: 'START_WORKER', payload: { configVersion: 1 } });

  assert.ok(address);
  t.after(() => child.stop());
  const response = await fetchText(address.port, 'POST', '/', 'target=15551234567');
  assert.equal(response.status, 200, response.body);
  assert.equal(response.body.includes('1234-5678'), true);
  assert.deepEqual(socket.pairingTargets, ['15551234567']);
  assert.equal(JSON.stringify(sent).includes('15551234567'), false);
  assert.equal(JSON.stringify(sent).includes('1234-5678'), false);

  await child.handle({
    ...identity,
    requestId: 'request_example_185_stop',
    type: 'STOP_WORKER',
    payload: {},
  });
  await assert.rejects(fetchText(address.port, 'GET', '/'));
});

class FakeSocket implements BaileysSocketPort {
  readonly events = new EventEmitter();
  readonly pairingTargets: string[] = [];

  readonly ev = {
    on: (
      event: 'creds.update' | 'connection.update' | 'messages.upsert',
      listener: (update?: unknown) => void,
    ) => this.events.on(event, listener),
    removeAllListeners: () => this.events.removeAllListeners(),
  };
  requestPairingCode(target: string): Promise<string> {
    this.pairingTargets.push(target);
    return Promise.resolve('1234-5678');
  }
  end(): void {}
}

function fetchText(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolvePromise, reject) => {
    const current = request({ host: '127.0.0.1', port, method, path }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () =>
        resolvePromise({
          status: response.statusCode ?? 0,
          body: Buffer.concat(parts).toString('utf8'),
        }),
      );
    });
    current.once('error', reject);
    current.end(body);
  });
}
