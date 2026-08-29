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
  const values = recordValues(input);
  if (!values) {
    throw new ConfigurationError('configuration must be an object');
  }

  const { environment, serviceName } = values;

  if (environment !== 'test' && environment !== 'development' && environment !== 'production') {
    throw new ConfigurationError('environment must be test, development, or production');
  }

  if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
    throw new ConfigurationError('serviceName must be a non-empty string');
  }

  return { environment, serviceName };
}

function recordValues(
  input: unknown,
): Readonly<{ environment: unknown; serviceName: unknown }> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const environment = descriptors.environment;
    const serviceName = descriptors.serviceName;
    if (
      (environment && (environment.enumerable !== true || !Object.hasOwn(environment, 'value'))) ||
      (serviceName && (serviceName.enumerable !== true || !Object.hasOwn(serviceName, 'value')))
    ) {
      return undefined;
    }
    return { environment: environment?.value, serviceName: serviceName?.value };
  } catch {
    return undefined;
  }
}
