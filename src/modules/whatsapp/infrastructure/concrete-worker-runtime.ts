import type {
  BusinessRepositoryPort,
  DeliveryClaimRepositoryPort,
  DeliveryConfirmationAdmissionRepositoryPort,
  WorkerOwnershipRepositoryPort,
} from '../../../app/business-repository';
import type {
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  RepositoryPort,
  WorkerRuntimePort,
} from '../../../app/ports';
import { createActiveAutomationDecisionService } from '../../automation/application/active-automation-decision-service';
import { createDeliveryClaimService } from '../../delivery/application/delivery-claim-service';
import { createDeliveryConfirmationAdmissionService } from '../../delivery/application/delivery-confirmation-admission-service';
import { createDeliveryConfirmationService } from '../../delivery/application/delivery-confirmation-service';
import {
  createAcceptedClaimGatedDeliverySender,
  createDeliveryBeginPort,
  createDeliverySettlementPort,
} from '../../delivery/application/claim-gated-delivery-sender';
import { createOm20DeliveryComposition } from '../../delivery/application/om-20-delivery-composition';
import { createActiveTenantBootService } from '../application/active-tenant-boot-service';
import { createActiveTenantWorkerService } from '../application/active-tenant-worker-service';
import { createWorkerDiagnosticsService } from '../application/worker-diagnostics-service';
import type { WorkerLifecycleStateRepositoryPort } from '../application/worker-lifecycle-state-service';
import { createWorkerOwnershipService } from '../application/worker-ownership-service';
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

type BasicRepository = RepositoryPort &
  Pick<
    BusinessRepositoryPort,
    | 'loadTenant'
    | 'loadConfig'
    | 'readEntitlementBalance'
    | 'loadDeliveryByOperationKey'
    | 'prepareDelivery'
  >;
type DeliveryRepository = BasicRepository &
  Pick<BusinessRepositoryPort, 'loadDelivery'> &
  DeliveryClaimRepositoryPort &
  DeliveryConfirmationAdmissionRepositoryPort;
type OwnershipRepository = BasicRepository & WorkerOwnershipRepositoryPort;

export function createConcreteWorkerRuntime(dependencies: {
  readonly config: unknown;
  readonly repository: RepositoryPort &
    Partial<
      Pick<
        BusinessRepositoryPort,
        | 'loadTenant'
        | 'loadConfig'
        | 'readEntitlementBalance'
        | 'loadDelivery'
        | 'loadDeliveryByOperationKey'
        | 'prepareDelivery'
      >
    > &
    Partial<
      DeliveryClaimRepositoryPort &
        DeliveryConfirmationAdmissionRepositoryPort &
        WorkerOwnershipRepositoryPort
    >;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
  readonly logger: LoggerPort;
  readonly spawn?: SpawnWorkerChildPort;
}): WorkerRuntimePort {
  const config = parseConfig(dependencies.config);
  const repository = requireBasicRepository(dependencies.repository);
  const deliveryRepository = hasDeliveryAuthority(repository) ? repository : undefined;
  const ownershipRepository = hasWorkerOwnership(repository) ? repository : undefined;
  const decisions = new Map(
    config.activeTenants.map(({ tenantId }) => [
      tenantId,
      createActiveAutomationDecisionService({
        repository,
        trustedTenant: { tenantId },
        state: {
          async load({ messageId }) {
            const [balance, delivery] = await Promise.all([
              repository.readEntitlementBalance(tenantId),
              repository.loadDeliveryByOperationKey(tenantId, `automation:${messageId}`),
            ]);
            return Object.freeze({
              hasEntitlement: balance.units > 0,
              duplicateMessage: false,
              deliveryExists: delivery !== undefined,
              delivery,
            });
          },
        },
      }),
    ]),
  );
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event) {
        dependencies.logger.info('Worker diagnostic', { ...event });
      },
    },
  });
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
    inbound: {
      async decide(input) {
        const decision = decisions.get(input.tenantId);
        if (!decision) throw new Error('Inbound tenant is not active');
        const currentMinute = minuteOfDayWib(dependencies.clock.now());
        if (!deliveryRepository) {
          return decision.decide(
            { messageId: input.messageId, message: input.message },
            currentMinute,
          );
        }
        const trustedTenant = { tenantId: input.tenantId };
        const delivery = createAcceptedClaimGatedDeliverySender({
          trustedTenant,
          claim: createDeliveryClaimService({
            repository: deliveryRepository,
            trustedTenant,
            ownerId: input.childId,
            idGenerator: dependencies.idGenerator,
          }).claim,
          begin: createDeliveryBeginPort({ repository: deliveryRepository, trustedTenant }),
          settle: createDeliverySettlementPort({ repository: deliveryRepository, trustedTenant }),
          sender: (authority) =>
            runtime.sendDelivery({
              tenantId: authority.tenantId,
              generation: authority.workerGeneration,
              childId: authority.childId,
              correlationId: authority.correlationId,
              operationId: authority.operationId,
              attemptId: authority.attemptId,
              claimFence: authority.claimFence,
              target: authority.target,
              text: authority.text,
            }),
        });
        return createOm20DeliveryComposition({
          trustedTenant,
          repository: deliveryRepository,
          decision: {
            decide: (event) => decision.decide(event, currentMinute),
          },
          delivery,
          admission: createDeliveryConfirmationAdmissionService({
            repository: deliveryRepository,
            trustedTenant,
          }),
          confirmation: createDeliveryConfirmationService({
            repository: deliveryRepository,
            trustedTenant,
            clock: dependencies.clock,
            idGenerator: dependencies.idGenerator,
          }),
        }).handle(input);
      },
    },
  });
  const ownership = createWorkerOwnershipService({
    commands: runtime,
    diagnostics,
    ...(ownershipRepository
      ? { persistence: workerOwnershipPersistence(ownershipRepository) }
      : {}),
  });
  const boot = createActiveTenantBootService({
    repository: { loadTenant: repository.loadTenant.bind(repository) },
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
    async stop(): Promise<void> {
      await Promise.all(
        config.activeTenants.map(({ tenantId }) =>
          ownership.stopWorker({
            tenantId,
            correlationId: dependencies.idGenerator.generate(),
          }),
        ),
      );
      await runtime.stop();
    },
    isReady(): Promise<boolean> {
      return runtime.isReady();
    },
    providerDiagnostic(): Promise<'NOT_OBSERVED'> {
      return Promise.resolve('NOT_OBSERVED');
    },
  };
}

function requireBasicRepository(repository: unknown): BasicRepository {
  if (!isBasicRepository(repository)) {
    throw new Error('Concrete worker runtime requires canonical business repository');
  }
  return repository;
}

function isBasicRepository(repository: unknown): repository is BasicRepository {
  return (
    typeof repository === 'object' &&
    repository !== null &&
    typeof (repository as Partial<BasicRepository>).loadTenant === 'function' &&
    typeof (repository as Partial<BasicRepository>).loadConfig === 'function' &&
    typeof (repository as Partial<BasicRepository>).readEntitlementBalance === 'function' &&
    typeof (repository as Partial<BasicRepository>).loadDeliveryByOperationKey === 'function' &&
    typeof (repository as Partial<BasicRepository>).prepareDelivery === 'function'
  );
}

function hasDeliveryAuthority(repository: BasicRepository): repository is DeliveryRepository {
  const candidate: Partial<DeliveryRepository> = repository;
  return (
    typeof candidate.loadDelivery === 'function' &&
    typeof candidate.claimDelivery === 'function' &&
    typeof candidate.beginDelivery === 'function' &&
    typeof candidate.settleDelivery === 'function' &&
    typeof candidate.confirmDelivery === 'function' &&
    typeof candidate.admitDeliveryConfirmation === 'function'
  );
}

function hasWorkerOwnership(repository: unknown): repository is OwnershipRepository {
  return (
    typeof repository === 'object' &&
    repository !== null &&
    typeof (repository as Partial<OwnershipRepository>).loadWorkerOwnership === 'function' &&
    typeof (repository as Partial<OwnershipRepository>).compareAndSaveWorkerOwnership === 'function'
  );
}

function workerOwnershipPersistence(
  repository: OwnershipRepository,
): WorkerLifecycleStateRepositoryPort {
  return {
    load: (tenantId) => repository.loadWorkerOwnership(tenantId),
    save: (snapshot) => repository.compareAndSaveWorkerOwnership(snapshot, null),
    compareAndSave: (snapshot, expectedSnapshot) =>
      repository.compareAndSaveWorkerOwnership(snapshot, expectedSnapshot),
  };
}

function minuteOfDayWib(value: Date): number {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Invalid worker clock');
  return ((value.getUTCHours() + 7) % 24) * 60 + value.getUTCMinutes();
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
