import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';

import { createLocalPairingConsole } from '../../src/modules/whatsapp/infrastructure/local-pairing-console';

void test('binds only loopback and keeps pairing material out of status', async (t) => {
  const target = '15551234567';
  const code = '1234-5678';
  const console_ = createLocalPairingConsole({ requestCode: (value) => Promise.resolve(value === target ? code : '') });
  const address = await console_.start();
  t.after(() => console_.stop());

  assert.deepEqual(address.host, '127.0.0.1');
  const page = await fetchText(address.port, 'GET', '/');
  assert.equal(page.body.includes(code), false);
  const paired = await fetchText(address.port, 'POST', '/', `target=${target}`);
  assert.equal(paired.status, 200);
  assert.equal(paired.body.includes(code), true);
  assert.deepEqual(console_.status(), { state: 'CODE_DISPLAYED' });
  assert.equal(JSON.stringify(console_.status()).includes(target), false);
  assert.equal(JSON.stringify(console_.status()).includes(code), false);
});

void test('rejects an unsafe local pairing target without reflecting it', async (t) => {
  const unsafe = '<unsafe-target>';
  const console_ = createLocalPairingConsole({ requestCode: () => Promise.resolve('unused') });
  const address = await console_.start();
  t.after(() => console_.stop());

  const response = await fetchText(address.port, 'POST', '/', `target=${encodeURIComponent(unsafe)}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.includes(unsafe), false);
});

function fetchText(port: number, method: string, path: string, body?: string): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolvePromise, reject) => {
    const current = request({ host: '127.0.0.1', port, method, path }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }));
    });
    current.once('error', reject);
    current.end(body);
  });
}
