import assert from 'node:assert/strict';
import { createServer as createProbeServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createEntrypoint, type EntrypointAdapters } from '../../src/main';
import type { HttpApp } from '../../src/app/create-http-app';
import {
  createNodeHttpServer,
  type NodeHttpServer,
} from '../../src/infrastructure/http/node-http-server';
import type {
  RepositoryPort,
  ShutdownSignal,
  ShutdownSignalPort,
  WorkerRuntimePort,
} from '../../src/app/ports';
import { FixedClock, NoopLogger, NoopMetrics, SequenceIdGenerator } from '../support/test-adapters';

class ControlledRuntime implements RepositoryPort, WorkerRuntimePort {
  constructor(
    private readonly name: string,
    private readonly events: string[],
  ) {}

  start(): Promise<void> {
    this.events.push(`${this.name}:start`);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.events.push(`${this.name}:stop`);
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class ControlledSignals implements ShutdownSignalPort {
  constructor(private readonly events: string[]) {}

  register(signal: ShutdownSignal): void {
    this.events.push(`signal:register:${signal}`);
  }

  unregister(signal: ShutdownSignal): void {
    this.events.push(`signal:unregister:${signal}`);
  }
}

void test('explicit entrypoint composes the existing boundaries without starting resources', async () => {
  const events: string[] = [];
  const database = Object.freeze({ kind: 'synthetic-database-config' });
  const worker = Object.freeze({ kind: 'synthetic-worker-config' });
  const http = Object.freeze({ port: 0, webRoot: '/tmp/warlist-v2-built-web-example' });
  let composedHttpApp: HttpApp | undefined;
  const adapters: EntrypointAdapters = {
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
    clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    idGenerator: new SequenceIdGenerator('req'),
    signals: new ControlledSignals(events),
    createRepository(config) {
      events.push('compose:repository');
      assert.equal(config, database);
      return new ControlledRuntime('repository', events);
    },
    createWorkerRuntime(config) {
      events.push('compose:worker');
      assert.equal(config, worker);
      return new ControlledRuntime('worker', events);
    },
    createHttpServer(input) {
      events.push('compose:http');
      assert.equal(input.config, http);
      composedHttpApp = input.app;
      return new ControlledRuntime('http', events);
    },
  };

  const entrypoint = createEntrypoint(
    {
      application: { environment: 'test', serviceName: 'warlist' },
      database,
      worker,
      http,
    },
    adapters,
  );

  assert.deepEqual(events, ['compose:repository', 'compose:worker', 'compose:http']);
  assert.deepEqual(await composedHttpApp?.handle({ method: 'GET', path: '/api/v1/health' }), {
    status: 200,
    body: {
      ok: true,
      data: { status: 'healthy' },
      meta: {},
      requestId: 'req-1',
    },
  });

  await entrypoint.start();
  await entrypoint.stop();

  assert.deepEqual(events, [
    'compose:repository',
    'compose:worker',
    'compose:http',
    'repository:start',
    'worker:start',
    'http:start',
    'signal:register:SIGINT',
    'signal:register:SIGTERM',
    'signal:unregister:SIGINT',
    'signal:unregister:SIGTERM',
    'http:stop',
    'worker:stop',
    'repository:stop',
  ]);
});

void test('entrypoint rejects accessor-backed configuration before composing adapters', () => {
  const events: string[] = [];
  const application = { serviceName: 'warlist' } as Record<string, unknown>;
  Object.defineProperty(application, 'environment', {
    enumerable: true,
    get() {
      events.push('accessor:called');
      return 'test';
    },
  });
  const input = { application, database: null, worker: null, http: null };

  assert.throws(
    () =>
      createEntrypoint(input, {
        logger: new NoopLogger(),
        metrics: new NoopMetrics(),
        clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
        idGenerator: new SequenceIdGenerator('req'),
        signals: new ControlledSignals(events),
        createRepository: () => new ControlledRuntime('repository', events),
        createWorkerRuntime: () => new ControlledRuntime('worker', events),
        createHttpServer: () => new ControlledRuntime('http', events),
      }),
    /Invalid application configuration/,
  );
  assert.deepEqual(events, []);
});

void test('loopback HTTP adapter serves validated API and built-Web routes with startup unwind', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-http-example-'));
  const webRoot = join(sandbox, 'web-dist');
  await mkdir(join(webRoot, 'assets'), { recursive: true });
  await Promise.all([
    writeFile(join(webRoot, 'index.html'), '<!doctype html><title>WARLIST example</title>'),
    writeFile(join(webRoot, 'assets', 'app.js'), 'globalThis.warlistExample = true;'),
    writeFile(join(sandbox, 'outside.txt'), 'must not be served'),
  ]);
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const events: string[] = [];
  let server: NodeHttpServer | undefined;
  const entrypoint = createEntrypoint(
    {
      application: { environment: 'test', serviceName: 'warlist' },
      database: null,
      worker: null,
      http: { port: 0, webRoot },
    },
    {
      logger: new NoopLogger(),
      metrics: new NoopMetrics(),
      clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
      idGenerator: new SequenceIdGenerator('req'),
      signals: new ControlledSignals(events),
      createRepository: () => new ControlledRuntime('repository', events),
      createWorkerRuntime: () => new ControlledRuntime('worker', events),
      createHttpServer(input) {
        server = createNodeHttpServer(input);
        return server;
      },
    },
  );
  t.after(() => entrypoint.stop());

  await entrypoint.start();
  assert.ok(server);
  const address = server.address();
  assert.ok(address);
  assert.equal(address.host, '127.0.0.1');
  const origin = `http://${address.host}:${address.port}`;

  const health = await fetch(`${origin}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    data: { status: 'healthy' },
    meta: {},
    requestId: 'req-1',
  });

  const apiNamespace = await fetch(`${origin}/api`);
  assert.equal(apiNamespace.status, 404);
  assert.equal(apiNamespace.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await apiNamespace.json(), {
    ok: false,
    error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', retryable: false },
    requestId: 'req-2',
  });

  const root = await fetch(`${origin}/`);
  assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await root.text(), '<!doctype html><title>WARLIST example</title>');

  const asset = await fetch(`${origin}/assets/app.js`);
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await asset.text(), 'globalThis.warlistExample = true;');

  const directWebRoute = await fetch(`${origin}/missing`);
  assert.equal(directWebRoute.status, 200);
  assert.equal(await directWebRoute.text(), '<!doctype html><title>WARLIST example</title>');

  const traversal = await fetch(`${origin}/%2e%2e%2foutside.txt`);
  assert.equal(traversal.status, 404);
  assert.notEqual(await traversal.text(), 'must not be served');

  const rejectedMethod = await fetch(`${origin}/api/v1/health`, { method: 'POST' });
  assert.equal(rejectedMethod.status, 405);
  assert.deepEqual(await rejectedMethod.json(), {
    ok: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', retryable: false },
    requestId: 'req-3',
  });

  assert.throws(
    () =>
      createNodeHttpServer({
        config: { port: 65_536, webRoot },
        app: { handle: () => Promise.reject(new Error('must not run')) },
      }),
    /Invalid HTTP server configuration/,
  );

  await entrypoint.stop();
  assert.equal(server.address(), undefined);

  const occupied = await occupyLoopbackPort();
  const failureEvents: string[] = [];
  const failedEntrypoint = createEntrypoint(
    {
      application: { environment: 'test', serviceName: 'warlist' },
      database: null,
      worker: null,
      http: { port: occupied.port, webRoot },
    },
    {
      logger: new NoopLogger(),
      metrics: new NoopMetrics(),
      clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
      idGenerator: new SequenceIdGenerator('req'),
      signals: new ControlledSignals(failureEvents),
      createRepository: () => new ControlledRuntime('repository', failureEvents),
      createWorkerRuntime: () => new ControlledRuntime('worker', failureEvents),
    },
  );

  await assert.rejects(failedEntrypoint.start(), /HTTP listener failed to start/);
  assert.deepEqual(failureEvents, [
    'repository:start',
    'worker:start',
    'worker:stop',
    'repository:stop',
  ]);
  await failedEntrypoint.stop();
  await occupied.close();
});

async function occupyLoopbackPort(): Promise<Readonly<{ port: number; close(): Promise<void> }>> {
  const server = createProbeServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return Object.freeze({
    port: address.port,
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  });
}
