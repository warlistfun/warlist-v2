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

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface ShutdownSignalPort {
  register(signal: ShutdownSignal, handler: () => void): void;
  unregister(signal: ShutdownSignal, handler: () => void): void;
}

export interface RepositoryPort extends ApplicationLifecycle {
  isReady(): Promise<boolean>;
}

export type ProviderDiagnostic = 'NOT_OBSERVED' | 'READY' | 'DEGRADED';

export interface WorkerRuntimePort extends ApplicationLifecycle {
  isReady(): Promise<boolean>;
  providerDiagnostic?(): Promise<ProviderDiagnostic>;
}
