export interface LoggerPort {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface MetricsPort {
  increment(name: string, value?: number): void;
}

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  generate(): string;
}

export interface ApplicationLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RepositoryPort extends ApplicationLifecycle {
  isReady(): Promise<boolean>;
}

export interface WorkerRuntimePort extends ApplicationLifecycle {
  isReady(): Promise<boolean>;
}
