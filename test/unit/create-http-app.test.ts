import assert from 'node:assert/strict';
import test from 'node:test';

import { createHttpApp } from '../../src/app/create-http-app';
import {
  InMemoryRepository,
  InMemoryWorkerRuntime,
  SequenceIdGenerator,
} from '../support/test-adapters';

function createTestHttpApp() {
  return createHttpApp({
    idGenerator: new SequenceIdGenerator('req'),
    repository: new InMemoryRepository(),
    workerRuntime: new InMemoryWorkerRuntime(),
  });
}

void test('health endpoint returns the canonical success envelope', async () => {
  const httpApp = createTestHttpApp();

  const response = await httpApp.handle({ method: 'GET', path: '/api/v1/health' });

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      data: { status: 'healthy' },
      meta: {},
      requestId: 'req-1',
    },
  });
});

void test('readiness endpoint reflects application dependencies', async () => {
  const repository = new InMemoryRepository();
  const workerRuntime = new InMemoryWorkerRuntime();
  const httpApp = createHttpApp({
    idGenerator: new SequenceIdGenerator('req'),
    repository,
    workerRuntime,
  });

  assert.equal((await httpApp.handle({ method: 'GET', path: '/api/v1/ready' })).status, 503);

  await repository.start();
  await workerRuntime.start();

  assert.deepEqual(await httpApp.handle({ method: 'GET', path: '/api/v1/ready' }), {
    status: 200,
    body: {
      ok: true,
      data: { status: 'ready' },
      meta: {},
      requestId: 'req-2',
    },
  });
});

void test('readiness reports an explicitly unobserved provider ceiling without provider material', async () => {
  const repository = new InMemoryRepository();
  const workerRuntime = new InMemoryWorkerRuntime();
  const httpApp = createHttpApp({
    idGenerator: new SequenceIdGenerator('req'),
    repository,
    workerRuntime: Object.assign(workerRuntime, {
      providerDiagnostic(): Promise<'NOT_OBSERVED'> {
        return Promise.resolve('NOT_OBSERVED');
      },
    }),
  });

  await repository.start();
  await workerRuntime.start();

  assert.deepEqual(await httpApp.handle({ method: 'GET', path: '/api/v1/ready' }), {
    status: 200,
    body: {
      ok: true,
      data: { status: 'ready', provider: 'not_observed' },
      meta: {},
      requestId: 'req-1',
    },
  });
});

void test('readiness reports provider degradation as a safe correlated retryable failure', async () => {
  const repository = new InMemoryRepository();
  const workerRuntime = Object.assign(new InMemoryWorkerRuntime(), {
    providerDiagnostic(): Promise<'DEGRADED'> {
      return Promise.resolve('DEGRADED');
    },
  });
  const httpApp = createHttpApp({
    idGenerator: new SequenceIdGenerator('req'),
    repository,
    workerRuntime,
  });

  await repository.start();
  await workerRuntime.start();

  assert.deepEqual(await httpApp.handle({ method: 'GET', path: '/api/v1/ready' }), {
    status: 503,
    body: {
      ok: false,
      error: {
        code: 'PROVIDER_DEGRADED',
        message: 'Provider degraded',
        retryable: true,
      },
      requestId: 'req-1',
    },
  });
});

void test('unknown routes return a stable safe failure envelope', async () => {
  const httpApp = createTestHttpApp();

  assert.deepEqual(await httpApp.handle({ method: 'GET', path: '/api/v1/unknown' }), {
    status: 404,
    body: {
      ok: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found',
        retryable: false,
      },
      requestId: 'req-1',
    },
  });
});

void test('unsupported methods return a stable safe failure envelope', async () => {
  const httpApp = createTestHttpApp();

  assert.deepEqual(await httpApp.handle({ method: 'POST', path: '/api/v1/health' }), {
    status: 405,
    body: {
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
        retryable: false,
      },
      requestId: 'req-1',
    },
  });
});

void test('malformed untrusted requests return a stable safe failure envelope', async () => {
  const httpApp = createTestHttpApp();

  assert.deepEqual(await httpApp.handle(null), {
    status: 400,
    body: {
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Invalid request',
        retryable: false,
      },
      requestId: 'req-1',
    },
  });
});

void test('readiness dependency failures return a sanitized retryable envelope', async () => {
  const repository = new InMemoryRepository();
  repository.isReady = () => Promise.reject(new Error('sensitive internal detail'));
  const httpApp = createHttpApp({
    idGenerator: new SequenceIdGenerator('req'),
    repository,
    workerRuntime: new InMemoryWorkerRuntime(),
  });

  assert.deepEqual(await httpApp.handle({ method: 'GET', path: '/api/v1/ready' }), {
    status: 503,
    body: {
      ok: false,
      error: {
        code: 'READINESS_CHECK_FAILED',
        message: 'Readiness check failed',
        retryable: true,
      },
      requestId: 'req-1',
    },
  });
});
