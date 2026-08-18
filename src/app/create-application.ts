import type { ApplicationConfig } from './config';
import type {
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  MetricsPort,
  RepositoryPort,
  WorkerRuntimePort,
} from './ports';

export interface ApplicationDependencies {
  config: ApplicationConfig;
  logger: LoggerPort;
  metrics: MetricsPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  repository: RepositoryPort;
  workerRuntime: WorkerRuntimePort;
}

export interface Application {
  readonly config: ApplicationConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApplication(dependencies: ApplicationDependencies): Application {
  const lifecycles = [dependencies.repository, dependencies.workerRuntime] as const;
  const started: Array<RepositoryPort | WorkerRuntimePort> = [];
  let running = false;
  let transition = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  return {
    config: dependencies.config,

    start(): Promise<void> {
      return enqueue(async () => {
        if (running) return;
        if (started.length > 0) {
          throw new Error('Application cleanup is incomplete');
        }

        try {
          for (const lifecycle of lifecycles) {
            await lifecycle.start();
            started.push(lifecycle);
          }
          running = true;
        } catch (error) {
          await stopStarted(started).catch(() => undefined);
          throw error;
        }
      });
    },

    stop(): Promise<void> {
      return enqueue(async () => {
        if (!running && started.length === 0) return;
        running = false;
        await stopStarted(started);
      });
    },
  };
}

async function stopStarted(started: Array<RepositoryPort | WorkerRuntimePort>): Promise<void> {
  const failures: unknown[] = [];

  for (let index = started.length - 1; index >= 0; index -= 1) {
    const lifecycle = started[index];
    if (!lifecycle) continue;

    try {
      await lifecycle.stop();
      started.splice(index, 1);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Application shutdown failed');
  }
}
