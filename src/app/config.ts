export type ApplicationEnvironment = 'test' | 'development' | 'production';

export interface ApplicationConfig {
  environment: ApplicationEnvironment;
  serviceName: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid application configuration: ${message}`);
    this.name = 'ConfigurationError';
  }
}

export function parseApplicationConfig(input: unknown): ApplicationConfig {
  if (!isRecord(input)) {
    throw new ConfigurationError('configuration must be an object');
  }

  const { environment, serviceName } = input;

  if (environment !== 'test' && environment !== 'development' && environment !== 'production') {
    throw new ConfigurationError('environment must be test, development, or production');
  }

  if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
    throw new ConfigurationError('serviceName must be a non-empty string');
  }

  return { environment, serviceName };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
