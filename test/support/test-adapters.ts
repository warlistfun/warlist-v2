import type {
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  MetricsPort,
  RepositoryPort,
  WorkerRuntimePort,
} from '../../src/app/ports';

export class NoopLogger implements LoggerPort {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void {
    void message;
    void context;
  }
  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    void message;
    void context;
  }
  warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    void message;
    void context;
  }
  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    void message;
    void context;
  }
}

export class NoopMetrics implements MetricsPort {
  increment(name: string, value?: number): void {
    void name;
    void value;
  }
}

export class FixedClock implements ClockPort {
  constructor(private readonly value: Date) {}

  now(): Date {
    return this.value;
  }
}

export class SequenceIdGenerator implements IdGeneratorPort {
  private sequence = 0;

  constructor(private readonly prefix: string) {}

  generate(): string {
    this.sequence += 1;
    return `${this.prefix}-${this.sequence}`;
  }
}

abstract class InMemoryLifecycle {
  private ready = false;

  start(): Promise<void> {
    this.ready = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.ready = false;
    return Promise.resolve();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }
}

export class InMemoryRepository extends InMemoryLifecycle implements RepositoryPort {}

export class InMemoryWorkerRuntime extends InMemoryLifecycle implements WorkerRuntimePort {}
