import type { BusinessRepositoryPort } from '../../../app/business-repository';
import type { IdGeneratorPort, RepositoryPort, WorkerRuntimePort } from '../../../app/ports';
import { createActiveTenantBootService } from '../application/active-tenant-boot-service';
import { createActiveTenantWorkerService } from '../application/active-tenant-worker-service';
import { createWorkerDiagnosticsService } from '../application/worker-diagnostics-service';
import {
  createWorkerOwnershipService,
  type WorkerOwnershipService,
} from '../application/worker-ownership-service';
import { createWorkerRuntimeService } from '../application/worker-runtime-service';
import {
  createNodeWorkerCommandTransport,
  type SpawnWorkerChildPort,
} from './node-worker-command-transport';

type ConcreteWorkerConfig = Readonly<{
  modulePath: string;
  credentialRoot: string;
  commandTimeoutMs: number;
  activeTenants: readonly Readonly<{ tenantId: string; configVersion: number }>[];
}>;

export function createConcreteWorkerRuntime(dependencies: {
  readonly config: unknown;
  readonly repository: RepositoryPort & Partial<Pick<BusinessRepositoryPort, 'loadTenant'>>;
  readonly idGenerator: IdGeneratorPort;
  readonly spawn?: SpawnWorkerChildPort;
}): WorkerRuntimePort {
  const config = parseConfig(dependencies.config);
  if (typeof dependencies.repository.loadTenant !== 'function') {
    throw new Error('Concrete worker runtime requires canonical tenant repository');
  }

  const diagnostics = createWorkerDiagnosticsService({ sink: { record() {} } });
  let ownership: WorkerOwnershipService | undefined = undefined;
  const runtime = createWorkerRuntimeService({
    transport: createNodeWorkerCommandTransport({
      modulePath: config.modulePath,
      credentialRoot: config.credentialRoot,
      ...(dependencies.spawn ? { spawn: dependencies.spawn } : {}),
      onChildExit(identity) {
        ownership?.recordChildExit(
          identity.tenantId,
          identity.generation,
          identity.childId,
          identity.correlationId,
        );
      },
    }),
    scheduler: {
      schedule(delayMs, task) {
        const handle = setTimeout(task, delayMs);
        return () => clearTimeout(handle);
      },
    },
    idGenerator: dependencies.idGenerator,
    commandTimeoutMs: config.commandTimeoutMs,
    diagnostics,
  });
  ownership = createWorkerOwnershipService({ commands: runtime, diagnostics });
  const boot = createActiveTenantBootService({
    repository: { loadTenant: dependencies.repository.loadTenant.bind(dependencies.repository) },
    workers: createActiveTenantWorkerService({ lifecycle: ownership }),
  });

  return {
    async start(): Promise<void> {
      await runtime.start();
      await boot.boot(
        config.activeTenants.map(({ tenantId, configVersion }) => ({
          tenantId,
          configVersion,
          childId: dependencies.idGenerator.generate(),
          correlationId: dependencies.idGenerator.generate(),
        })),
      );
    },
    stop(): Promise<void> {
      return runtime.stop();
    },
    isReady(): Promise<boolean> {
      return runtime.isReady();
    },
    providerDiagnostic(): Promise<'NOT_OBSERVED'> {
      return Promise.resolve('NOT_OBSERVED');
    },
  };
}

function parseConfig(input: unknown): ConcreteWorkerConfig {
  const values = exactRecord(input, [
    'modulePath',
    'credentialRoot',
    'commandTimeoutMs',
    'activeTenants',
  ]);
  if (!values) throw invalidConfig();

  const { modulePath, credentialRoot, commandTimeoutMs, activeTenants } = values;
  if (
    typeof modulePath !== 'string' ||
    typeof credentialRoot !== 'string' ||
    !Number.isSafeInteger(commandTimeoutMs) ||
    (commandTimeoutMs as number) < 1 ||
    !Array.isArray(activeTenants)
  ) {
    throw invalidConfig();
  }

  const parsedTenants = activeTenants.map((tenant) => {
    const candidate = exactRecord(tenant, ['tenantId', 'configVersion']);
    if (!candidate) throw invalidConfig();
    const { tenantId, configVersion } = candidate;
    if (
      typeof tenantId !== 'string' ||
      !isUuid(tenantId) ||
      !Number.isSafeInteger(configVersion) ||
      (configVersion as number) < 1
    ) {
      throw invalidConfig();
    }
    return Object.freeze({ tenantId, configVersion: configVersion as number });
  });
  if (new Set(parsedTenants.map(({ tenantId }) => tenantId)).size !== parsedTenants.length) {
    throw invalidConfig();
  }

  return Object.freeze({
    modulePath,
    credentialRoot,
    commandTimeoutMs: commandTimeoutMs as number,
    activeTenants: Object.freeze(parsedTenants),
  });
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(input).length !== keys.length
    ) {
      return undefined;
    }
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return undefined;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invalidConfig(): Error {
  return new Error('Invalid concrete worker configuration');
}
