import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabaseSendAdmission } from '../../src/app/database-send-admission';

void test('database outage rejects admission before an external sender is invoked', async () => {
  let senderCalls = 0;
  const admission = createDatabaseSendAdmission({
    repository: {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      isReady: () => Promise.resolve(false),
    },
  });

  await assert.rejects(
    admission.admit(() => {
      senderCalls += 1;
      return Promise.resolve();
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Database is unavailable for external send admission',
  );
  assert.equal(senderCalls, 0);
});

void test('database availability admits the injected sender exactly once', async () => {
  let senderCalls = 0;
  const admission = createDatabaseSendAdmission({
    repository: {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      isReady: () => Promise.resolve(true),
    },
  });

  await admission.admit(() => {
    senderCalls += 1;
    return Promise.resolve();
  });
  assert.equal(senderCalls, 1);
});

void test('database readiness failures reject admission before an external sender is invoked', async () => {
  let senderCalls = 0;
  const admission = createDatabaseSendAdmission({
    repository: {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      isReady: () => Promise.reject(new Error('synthetic database failure')),
    },
  });

  await assert.rejects(
    admission.admit(() => {
      senderCalls += 1;
      return Promise.resolve();
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Database is unavailable for external send admission',
  );
  assert.equal(senderCalls, 0);
});
