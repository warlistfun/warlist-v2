import type { RepositoryPort } from './ports';
import { serialize, deserialize } from 'node:v8';

export type TenantRecord = Readonly<{
  id: string;
  publicOpsId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DELETING' | 'DELETED';
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ConfigRecord = Readonly<{
  tenantId: string;
  configuration: Readonly<Record<string, unknown>>;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type DeliveryRecord = Readonly<{
  id: string;
  tenantId: string;
  operationKey: string;
  status: 'PREPARED';
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type AuditEvent = Readonly<{
  id: string;
  tenantId: string;
  correlationId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
}>;

export type AuditEventInput = Readonly<Omit<AuditEvent, 'createdAt'>>;

export interface TenantAuthorizationPort {
  assertAuthorized(tenantId: string): void;
}

export interface BusinessRepositoryPort extends RepositoryPort {
  createTenant(input: Readonly<{ id: string; publicOpsId: string }>): Promise<TenantRecord>;
  loadTenant(tenantId: string): Promise<TenantRecord | undefined>;
  loadConfig(tenantId: string): Promise<ConfigRecord | undefined>;
  compareAndSaveConfig(
    input: Readonly<{ tenantId: string; configuration: unknown }>,
    expectedRevision: number | null,
  ): Promise<ConfigRecord>;
  prepareDelivery(
    input: Readonly<{ id: string; tenantId: string; operationKey: string }>,
  ): Promise<DeliveryRecord>;
  loadDelivery(tenantId: string, deliveryId: string): Promise<DeliveryRecord | undefined>;
  appendAuditEvent(input: AuditEventInput): Promise<AuditEvent>;
  readAuditEvents(tenantId: string, limit: number): Promise<readonly AuditEvent[]>;
}

const repositoryErrors = {
  INVALID_REPOSITORY_INPUT: ['Invalid repository input', false],
  TENANT_ACCESS_DENIED: ['Tenant access denied', false],
  TENANT_ALREADY_EXISTS: ['Tenant already exists', false],
  TENANT_NOT_FOUND: ['Tenant not found', false],
  CONFIG_VERSION_CONFLICT: ['Configuration version conflict', false],
  DELIVERY_ALREADY_EXISTS: ['Delivery operation already exists', false],
  AUDIT_EVENT_ALREADY_EXISTS: ['Audit event already exists', false],
  DATABASE_UNAVAILABLE: ['Database is unavailable', true],
  DATABASE_TIMEOUT: ['Database request timed out', true],
  DATABASE_CLEANUP_INCOMPLETE: ['Database cleanup is incomplete', true],
  DATABASE_ROW_INVALID: ['Database returned invalid data', false],
} as const;

export class RepositoryError extends Error {
  constructor(readonly code: keyof typeof repositoryErrors) {
    super(repositoryErrors[code][0]);
    this.name = 'RepositoryError';
  }

  get retryable(): boolean {
    return repositoryErrors[this.code][1];
  }
}

export function createInMemoryBusinessRepository(dependencies: {
  readonly authorization: TenantAuthorizationPort;
}): BusinessRepositoryPort {
  const tenants = new Map<string, TenantRecord>();
  const tenantIdsByPublicOpsId = new Map<string, string>();
  const configs = new Map<string, ConfigRecord>();
  const deliveries = new Map<string, DeliveryRecord>();
  const deliveryIdsByTenantKey = new Map<string, string>();
  const auditEvents = new Map<string, AuditEvent>();
  let started = false;

  function authorize(tenantId: string): void {
    if (!isUuid(tenantId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
    dependencies.authorization.assertAuthorized(tenantId);
  }

  function requireStarted(): void {
    if (!started) throw new RepositoryError('DATABASE_UNAVAILABLE');
  }

  return {
    start(): Promise<void> {
      started = true;
      return Promise.resolve();
    },
    stop(): Promise<void> {
      started = false;
      return Promise.resolve();
    },
    isReady(): Promise<boolean> {
      return Promise.resolve(started);
    },
    async createTenant(input): Promise<TenantRecord> {
      requireStarted();
      authorize(input.id);
      if (!isPublicOpsId(input.publicOpsId)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      if (tenants.has(input.id) || tenantIdsByPublicOpsId.has(input.publicOpsId)) {
        throw new RepositoryError('TENANT_ALREADY_EXISTS');
      }
      const now = new Date().toISOString();
      const tenant = freezeTenant({
        id: input.id,
        publicOpsId: input.publicOpsId,
        status: 'ACTIVE',
        schemaVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      tenants.set(tenant.id, tenant);
      tenantIdsByPublicOpsId.set(tenant.publicOpsId, tenant.id);
      return Promise.resolve(freezeTenant(tenant));
    },
    async loadTenant(tenantId): Promise<TenantRecord | undefined> {
      requireStarted();
      authorize(tenantId);
      const tenant = tenants.get(tenantId);
      return Promise.resolve(tenant && freezeTenant(tenant));
    },
    async loadConfig(tenantId): Promise<ConfigRecord | undefined> {
      requireStarted();
      authorize(tenantId);
      const config = configs.get(tenantId);
      return Promise.resolve(config && freezeConfig(config));
    },
    async compareAndSaveConfig(input, expectedRevision): Promise<ConfigRecord> {
      requireStarted();
      authorize(input.tenantId);
      if (!tenants.has(input.tenantId)) throw new RepositoryError('TENANT_NOT_FOUND');
      if (
        (expectedRevision !== null &&
          (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0)) ||
        !isJsonObject(input.configuration)
      ) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const current = configs.get(input.tenantId);
      if ((current?.revision ?? null) !== expectedRevision) {
        throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      }
      const now = new Date().toISOString();
      const config = freezeConfig({
        tenantId: input.tenantId,
        configuration: input.configuration,
        schemaVersion: 1,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
      configs.set(input.tenantId, config);
      return Promise.resolve(freezeConfig(config));
    },
    async prepareDelivery(input): Promise<DeliveryRecord> {
      requireStarted();
      authorize(input.tenantId);
      if (!tenants.has(input.tenantId)) throw new RepositoryError('TENANT_NOT_FOUND');
      if (!isUuid(input.id) || !isBoundedIdentifier(input.operationKey, false)) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const tenantKey = `${input.tenantId}\u0000${input.operationKey}`;
      if (deliveries.has(input.id) || deliveryIdsByTenantKey.has(tenantKey)) {
        throw new RepositoryError('DELIVERY_ALREADY_EXISTS');
      }
      const now = new Date().toISOString();
      const delivery = freezeDelivery({
        ...input,
        status: 'PREPARED',
        schemaVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      deliveries.set(delivery.id, delivery);
      deliveryIdsByTenantKey.set(tenantKey, delivery.id);
      return Promise.resolve(freezeDelivery(delivery));
    },
    async loadDelivery(tenantId, deliveryId): Promise<DeliveryRecord | undefined> {
      requireStarted();
      authorize(tenantId);
      if (!isUuid(deliveryId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const delivery = deliveries.get(deliveryId);
      return Promise.resolve(
        delivery?.tenantId === tenantId ? freezeDelivery(delivery) : undefined,
      );
    },
    async appendAuditEvent(input): Promise<AuditEvent> {
      requireStarted();
      authorize(input.tenantId);
      if (!tenants.has(input.tenantId)) throw new RepositoryError('TENANT_NOT_FOUND');
      if (!isAuditEventInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      if (auditEvents.has(input.id)) throw new RepositoryError('AUDIT_EVENT_ALREADY_EXISTS');
      const event = freezeAuditEvent({ ...input, createdAt: new Date().toISOString() });
      auditEvents.set(event.id, event);
      return Promise.resolve(freezeAuditEvent(event));
    },
    async readAuditEvents(tenantId, limit): Promise<readonly AuditEvent[]> {
      requireStarted();
      authorize(tenantId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      return Promise.resolve(
        Object.freeze(
          [...auditEvents.values()]
            .filter((event) => event.tenantId === tenantId)
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )
            .slice(0, limit)
            .map(freezeAuditEvent),
        ),
      );
    },
  };
}

function freezeTenant(tenant: TenantRecord): TenantRecord {
  return Object.freeze({ ...tenant });
}

function freezeConfig(config: ConfigRecord): ConfigRecord {
  return Object.freeze({ ...config, configuration: cloneAndFreezeJson(config.configuration) });
}

function freezeDelivery(delivery: DeliveryRecord): DeliveryRecord {
  return Object.freeze({ ...delivery });
}

function freezeAuditEvent(event: AuditEvent): AuditEvent {
  return Object.freeze({ ...event });
}

function cloneAndFreezeJson(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze(deserialize(serialize(value)) as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value) || !isJsonValue(value, 0)) return false;
  try {
    return serialize(value).byteLength <= 65_536;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isPublicOpsId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value);
}

function isBoundedIdentifier(value: unknown, upperCase: boolean): value is string {
  return (
    typeof value === 'string' &&
    (upperCase ? /^[A-Z][A-Z0-9_]{0,63}$/ : /^[a-z0-9_:-]{1,160}$/).test(value)
  );
}

function isAuditEventInput(value: AuditEventInput): boolean {
  return (
    isUuid(value.id) &&
    isUuid(value.tenantId) &&
    isBoundedIdentifier(value.correlationId, false) &&
    isBoundedIdentifier(value.actorType, true) &&
    (value.actorId === null || isBoundedIdentifier(value.actorId, false)) &&
    isBoundedIdentifier(value.action, true) &&
    isBoundedIdentifier(value.targetType, true) &&
    (value.targetId === null || isBoundedIdentifier(value.targetId, false))
  );
}
