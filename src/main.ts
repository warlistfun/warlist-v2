import { parseApplicationConfig } from './app/config';
import { createBootstrap, type Bootstrap } from './app/bootstrap';
import type { HttpApp } from './app/create-http-app';
import type {
  ApplicationLifecycle,
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  MetricsPort,
  RepositoryPort,
  ShutdownSignalPort,
  WorkerRuntimePort,
} from './app/ports';
import { createNodeHttpServer } from './infrastructure/http/node-http-server';

type EntrypointConfig = Readonly<{
  application: unknown;
  database: unknown;
  worker: unknown;
  http: unknown;
}>;

export interface EntrypointAdapters {
  readonly logger: LoggerPort;
  readonly metrics: MetricsPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
  readonly signals: ShutdownSignalPort;
  createRepository(config: unknown): RepositoryPort;
  createWorkerRuntime(config: unknown): WorkerRuntimePort;
  createHttpServer?(input: Readonly<{ config: unknown; app: HttpApp }>): ApplicationLifecycle;
}

export function createEntrypoint(input: unknown, adapters: EntrypointAdapters): Bootstrap {
  const config = parseEntrypointConfig(input);
  const applicationConfig = parseApplicationConfig(config.application);
  const repository = adapters.createRepository(config.database);
  const workerRuntime = adapters.createWorkerRuntime(config.worker);
  const createHttpServer = (input: Readonly<{ config: unknown; app: HttpApp }>) =>
    adapters.createHttpServer ? adapters.createHttpServer(input) : createNodeHttpServer(input);

  return createBootstrap({
    config: applicationConfig,
    logger: adapters.logger,
    metrics: adapters.metrics,
    clock: adapters.clock,
    idGenerator: adapters.idGenerator,
    repository,
    workerRuntime,
    signals: adapters.signals,
    createHttpServer: (app) => createHttpServer({ config: config.http, app }),
  });
}

function parseEntrypointConfig(input: unknown): EntrypointConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid entrypoint configuration');
  }
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Reflect.ownKeys(input);
    const expected = ['application', 'database', 'worker', 'http'] as const;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== expected.length ||
      !keys.every((key) => typeof key === 'string' && (expected as readonly string[]).includes(key))
    ) {
      throw new Error();
    }
    const values: Record<(typeof expected)[number], unknown> = {
      application: undefined,
      database: undefined,
      worker: undefined,
      http: undefined,
    };
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw new Error();
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    throw new Error('Invalid entrypoint configuration');
  }
}
