import type { ApplicationConfig } from './config';
import { createApplication } from './create-application';
import { createHttpApp, type HttpApp } from './create-http-app';
import type {
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  MetricsPort,
  RepositoryPort,
  ShutdownSignal,
  ShutdownSignalPort,
  WorkerRuntimePort,
} from './ports';

export interface BootstrapDependencies {
  config: ApplicationConfig;
  logger: LoggerPort;
  metrics: MetricsPort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  repository: RepositoryPort;
  workerRuntime: WorkerRuntimePort;
  signals: ShutdownSignalPort;
}

export interface Bootstrap {
  readonly httpApp: HttpApp;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const shutdownSignals: readonly ShutdownSignal[] = ['SIGINT', 'SIGTERM'];

export function createBootstrap(dependencies: BootstrapDependencies): Bootstrap {
  const application = createApplication(dependencies);
  const httpApp = createHttpApp(dependencies);
  const registeredSignals = new Set<ShutdownSignal>();
  let applicationCleanupNeeded = false;
  let running = false;
  let transition = Promise.resolve();

  const handleSignal = (): void => {
    void stop().catch((error: unknown) => {
      dependencies.logger.error('Signal-triggered shutdown failed', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  };

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = transition.then(operation, operation);
    transition = result.catch(() => undefined);
    return result;
  }

  function unregisterSignals(): unknown[] {
    const failures: unknown[] = [];
    for (const signal of [...registeredSignals]) {
      try {
        dependencies.signals.unregister(signal, handleSignal);
        registeredSignals.delete(signal);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  async function cleanup(): Promise<void> {
    const failures = unregisterSignals();

    if (applicationCleanupNeeded) {
      try {
        await application.stop();
        applicationCleanupNeeded = false;
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Bootstrap shutdown failed');
    }
  }

  function stop(): Promise<void> {
    return enqueue(async () => {
      running = false;
      await cleanup();
    });
  }

  return {
    httpApp,
    start(): Promise<void> {
      return enqueue(async () => {
        if (running) return;
        if (applicationCleanupNeeded || registeredSignals.size > 0) {
          throw new Error('Bootstrap cleanup is incomplete');
        }

        applicationCleanupNeeded = true;
        try {
          await application.start();
          for (const signal of shutdownSignals) {
            dependencies.signals.register(signal, handleSignal);
            registeredSignals.add(signal);
          }
          running = true;
        } catch (error) {
          await cleanup().catch(() => undefined);
          throw error;
        }
      });
    },
    stop,
  };
}
