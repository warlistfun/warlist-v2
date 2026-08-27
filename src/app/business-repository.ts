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

export type AutomationConfigSyncStatus =
  'PENDING' | 'IN_FLIGHT' | 'APPLIED' | 'RETRYABLE_FAILURE' | 'NON_RETRYABLE_FAILURE';

export type AutomationConfigSyncRecord = Readonly<{
  tenantId: string;
  configRevision: number;
  status: AutomationConfigSyncStatus;
  attempts: number;
  claimToken: string | null;
  leaseUntil: string | null;
  failureCode: string | null;
  nextAttemptAt: string | null;
}>;

export type DeliveryStatus =
  'PREPARED' | 'CLAIMED' | 'SENDING' | 'SENT' | 'AMBIGUOUS' | 'CONFIRMED';

export type DeliveryRecord = Readonly<{
  id: string;
  tenantId: string;
  operationKey: string;
  status: DeliveryStatus;
  claimOwner: string | null;
  claimFence: number;
  leaseUntil: string | null;
  workerGeneration: number | null;
  childId: string | null;
  confirmationBusinessKey?: string | null;
  confirmationCorrelationId?: string | null;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type DeliveryAttemptStatus = 'PREPARED' | 'SENT' | 'AMBIGUOUS';

export type DeliveryAttemptRecord = Readonly<{
  id: string;
  tenantId: string;
  operationId: string;
  attemptNumber: number;
  status: DeliveryAttemptStatus;
  claimFence: number | null;
  providerMessageId: string | null;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type DeliveryClaimRecord = Readonly<{
  operation: DeliveryRecord;
  attempt: DeliveryAttemptRecord;
}>;

export type DeliveryConfirmationRecord = Readonly<{
  operation: DeliveryRecord;
  debit: EntitlementLedgerEntry | null;
}>;

export type DeliveryConfirmationAdmissionRecord = Readonly<{
  outcome: 'CONFIRMED';
  tenantId: string;
  operationId: string;
  attemptId: string;
  providerMessageId: string;
  confirmedAt: string;
}>;

export type EntitlementEntryType =
  'CREDIT_PAYMENT' | 'CREDIT_COUPON' | 'DEBIT_CONFIRMED_DELIVERY' | 'ADJUSTMENT';

export type EntitlementLedgerEntry = Readonly<{
  id: string;
  tenantId: string;
  entryType: EntitlementEntryType;
  units: number;
  businessKey: string;
  correlationId: string;
  createdAt: string;
}>;

export type EntitlementBalance = Readonly<{ tenantId: string; units: number }>;

export interface DeliveryClaimRepositoryPort {
  claimDelivery(
    input: Readonly<{
      tenantId: string;
      operationId: string;
      attemptId: string;
      claimOwner: string;
      workerGeneration: number;
      childId: string;
    }>,
  ): Promise<DeliveryClaimRecord>;
  beginDelivery(
    input: Readonly<{
      tenantId: string;
      operationId: string;
      attemptId: string;
      claimFence: number;
      claimOwner: string;
      leaseUntil: string;
      workerGeneration: number;
      childId: string;
    }>,
  ): Promise<DeliveryClaimRecord>;
  settleDelivery(
    input: Readonly<{
      tenantId: string;
      operationId: string;
      attemptId: string;
      claimFence: number;
      claimOwner: string;
      leaseUntil: string;
      workerGeneration: number;
      childId: string;
      outcome: Extract<DeliveryAttemptStatus, 'SENT' | 'AMBIGUOUS'>;
      providerMessageId: string | null;
    }>,
  ): Promise<DeliveryClaimRecord>;
  confirmDelivery(
    input: Readonly<{
      tenantId: string;
      operationId: string;
      attemptId: string;
      claimFence: number;
      claimOwner: string;
      leaseUntil: string;
      workerGeneration: number;
      childId: string;
      debitId: string;
      businessKey: string;
      correlationId: string;
    }>,
  ): Promise<DeliveryConfirmationRecord>;
}

export interface DeliveryConfirmationAdmissionRepositoryPort {
  admitDeliveryConfirmation(
    input: Readonly<{
      tenantId: string;
      operationId: string;
      attemptId: string;
      providerMessageId: string;
    }>,
  ): Promise<DeliveryConfirmationAdmissionRecord>;
}

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
  compareAndSaveConfigWithSync(
    input: Readonly<{ tenantId: string; configuration: unknown }>,
    expectedRevision: number | null,
  ): Promise<Readonly<{ config: ConfigRecord; sync: AutomationConfigSyncRecord }>>;
  readAutomationConfigSync(
    tenantId: string,
    configRevision: number,
  ): Promise<AutomationConfigSyncRecord | undefined>;
  claimDueAutomationConfigSyncs(
    input: Readonly<{
      limit: number;
      now: string;
      leaseUntil: string;
      claimToken: string;
    }>,
  ): Promise<readonly AutomationConfigSyncRecord[]>;
  markAutomationConfigSyncApplied(
    input: Readonly<{
      tenantId: string;
      configRevision: number;
      claimToken: string;
    }>,
  ): Promise<AutomationConfigSyncRecord>;
  recordAutomationConfigSyncFailure(
    input: Readonly<{
      tenantId: string;
      configRevision: number;
      claimToken: string;
      retryable: boolean;
      failureCode: string;
      nextAttemptAt: string | null;
    }>,
  ): Promise<AutomationConfigSyncRecord>;
  prepareDelivery(
    input: Readonly<{ id: string; tenantId: string; operationKey: string }>,
  ): Promise<DeliveryRecord>;
  loadDelivery(tenantId: string, deliveryId: string): Promise<DeliveryRecord | undefined>;
  createDeliveryAttempt(
    input: Readonly<{ id: string; tenantId: string; operationId: string; attemptNumber: number }>,
  ): Promise<DeliveryAttemptRecord>;
  loadDeliveryAttempt(
    tenantId: string,
    attemptId: string,
  ): Promise<DeliveryAttemptRecord | undefined>;
  appendEntitlementLedgerEntry(
    input: Readonly<{
      id: string;
      tenantId: string;
      entryType: EntitlementEntryType;
      units: number;
      businessKey: string;
      correlationId: string;
    }>,
  ): Promise<EntitlementLedgerEntry>;
  readEntitlementBalance(tenantId: string): Promise<EntitlementBalance>;
  appendAuditEvent(input: AuditEventInput): Promise<AuditEvent>;
  readAuditEvents(tenantId: string, limit: number): Promise<readonly AuditEvent[]>;
}

const repositoryErrors = {
  INVALID_REPOSITORY_INPUT: ['Invalid repository input', false],
  TENANT_ACCESS_DENIED: ['Tenant access denied', false],
  TENANT_ALREADY_EXISTS: ['Tenant already exists', false],
  TENANT_NOT_FOUND: ['Tenant not found', false],
  CONFIG_VERSION_CONFLICT: ['Configuration version conflict', false],
  AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT: ['Automation config sync claim conflict', false],
  DELIVERY_ALREADY_EXISTS: ['Delivery operation already exists', false],
  DELIVERY_CLAIM_CONFLICT: ['Delivery claim conflict', false],
  DELIVERY_CONFIRMATION_CONFLICT: ['Delivery confirmation conflict', false],
  ENTITLEMENT_BUSINESS_KEY_CONFLICT: ['Entitlement business key conflict', false],
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
  const automationConfigSyncs = new Map<string, AutomationConfigSyncRecord>();
  const deliveries = new Map<string, DeliveryRecord>();
  const deliveryIdsByTenantKey = new Map<string, string>();
  const deliveryAttempts = new Map<string, DeliveryAttemptRecord>();
  const deliveryAttemptIdsByTenantOperationNumber = new Map<string, string>();
  const entitlementEntries = new Map<string, EntitlementLedgerEntry>();
  const entitlementEntryIdsByBusinessKey = new Map<string, string>();
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
    async compareAndSaveConfigWithSync(input, expectedRevision) {
      await Promise.resolve();
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
      const sync = freezeAutomationConfigSync({
        tenantId: config.tenantId,
        configRevision: config.revision,
        status: 'PENDING',
        attempts: 0,
        claimToken: null,
        leaseUntil: null,
        failureCode: null,
        nextAttemptAt: null,
      });
      configs.set(config.tenantId, config);
      automationConfigSyncs.set(syncKey(sync.tenantId, sync.configRevision), sync);
      return Object.freeze({
        config: freezeConfig(config),
        sync: freezeAutomationConfigSync(sync),
      });
    },
    async readAutomationConfigSync(tenantId, configRevision) {
      await Promise.resolve();
      requireStarted();
      authorize(tenantId);
      if (!isPositiveInteger(configRevision)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const sync = automationConfigSyncs.get(syncKey(tenantId, configRevision));
      return sync && freezeAutomationConfigSync(sync);
    },
    async claimDueAutomationConfigSyncs(input) {
      await Promise.resolve();
      requireStarted();
      if (!isClaimInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const claimed = [...automationConfigSyncs.values()]
        .filter((sync) => isDue(sync, input.now))
        .sort(
          (left, right) =>
            left.tenantId.localeCompare(right.tenantId) ||
            left.configRevision - right.configRevision,
        )
        .slice(0, input.limit)
        .map((sync) => {
          const next = freezeAutomationConfigSync({
            ...sync,
            status: 'IN_FLIGHT',
            attempts: sync.attempts + 1,
            claimToken: input.claimToken,
            leaseUntil: input.leaseUntil,
            failureCode: null,
            nextAttemptAt: null,
          });
          automationConfigSyncs.set(syncKey(next.tenantId, next.configRevision), next);
          return freezeAutomationConfigSync(next);
        });
      return Object.freeze(claimed);
    },
    async markAutomationConfigSyncApplied(input) {
      await Promise.resolve();
      requireStarted();
      authorize(input.tenantId);
      if (!isSettlementInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const key = syncKey(input.tenantId, input.configRevision);
      const current = automationConfigSyncs.get(key);
      if (!current || current.status !== 'IN_FLIGHT' || current.claimToken !== input.claimToken) {
        throw new RepositoryError('AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT');
      }
      const applied = freezeAutomationConfigSync({
        ...current,
        status: 'APPLIED',
        claimToken: null,
        leaseUntil: null,
      });
      automationConfigSyncs.set(key, applied);
      return freezeAutomationConfigSync(applied);
    },
    async recordAutomationConfigSyncFailure(input) {
      await Promise.resolve();
      requireStarted();
      authorize(input.tenantId);
      if (!isFailureInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const key = syncKey(input.tenantId, input.configRevision);
      const current = automationConfigSyncs.get(key);
      if (!current || current.status !== 'IN_FLIGHT' || current.claimToken !== input.claimToken) {
        throw new RepositoryError('AUTOMATION_CONFIG_SYNC_CLAIM_CONFLICT');
      }
      const failed = freezeAutomationConfigSync({
        ...current,
        status: input.retryable ? 'RETRYABLE_FAILURE' : 'NON_RETRYABLE_FAILURE',
        claimToken: null,
        leaseUntil: null,
        failureCode: input.failureCode,
        nextAttemptAt: input.nextAttemptAt,
      });
      automationConfigSyncs.set(key, failed);
      return freezeAutomationConfigSync(failed);
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
        claimOwner: null,
        claimFence: 0,
        leaseUntil: null,
        workerGeneration: null,
        childId: null,
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
    async createDeliveryAttempt(input): Promise<DeliveryAttemptRecord> {
      await Promise.resolve();
      requireStarted();
      authorize(input.tenantId);
      if (
        !isUuid(input.id) ||
        !isUuid(input.operationId) ||
        !isPositiveInteger(input.attemptNumber) ||
        deliveries.get(input.operationId)?.tenantId !== input.tenantId
      ) {
        throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      }
      const key = deliveryAttemptKey(input.tenantId, input.operationId, input.attemptNumber);
      if (deliveryAttempts.has(input.id) || deliveryAttemptIdsByTenantOperationNumber.has(key)) {
        throw new RepositoryError('DELIVERY_ALREADY_EXISTS');
      }
      const now = new Date().toISOString();
      const attempt = freezeDeliveryAttempt({
        ...input,
        status: 'PREPARED',
        claimFence: null,
        providerMessageId: null,
        schemaVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      deliveryAttempts.set(attempt.id, attempt);
      deliveryAttemptIdsByTenantOperationNumber.set(key, attempt.id);
      return freezeDeliveryAttempt(attempt);
    },
    async loadDeliveryAttempt(tenantId, attemptId): Promise<DeliveryAttemptRecord | undefined> {
      await Promise.resolve();
      requireStarted();
      authorize(tenantId);
      if (!isUuid(attemptId)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const attempt = deliveryAttempts.get(attemptId);
      return attempt?.tenantId === tenantId ? freezeDeliveryAttempt(attempt) : undefined;
    },
    async appendEntitlementLedgerEntry(input): Promise<EntitlementLedgerEntry> {
      await Promise.resolve();
      requireStarted();
      authorize(input.tenantId);
      if (!tenants.has(input.tenantId)) throw new RepositoryError('TENANT_NOT_FOUND');
      if (!isEntitlementLedgerInput(input)) throw new RepositoryError('INVALID_REPOSITORY_INPUT');
      const key = entitlementBusinessKey(input.tenantId, input.businessKey);
      const existingId = entitlementEntryIdsByBusinessKey.get(key);
      if (existingId) {
        const existing = entitlementEntries.get(existingId);
        if (existing && sameEntitlementEntry(existing, input))
          return freezeEntitlementEntry(existing);
        throw new RepositoryError('ENTITLEMENT_BUSINESS_KEY_CONFLICT');
      }
      if (entitlementEntries.has(input.id))
        throw new RepositoryError('ENTITLEMENT_BUSINESS_KEY_CONFLICT');
      const entry = freezeEntitlementEntry({ ...input, createdAt: new Date().toISOString() });
      entitlementEntries.set(entry.id, entry);
      entitlementEntryIdsByBusinessKey.set(key, entry.id);
      return freezeEntitlementEntry(entry);
    },
    async readEntitlementBalance(tenantId): Promise<EntitlementBalance> {
      await Promise.resolve();
      requireStarted();
      authorize(tenantId);
      const units = [...entitlementEntries.values()]
        .filter((entry) => entry.tenantId === tenantId)
        .reduce((sum, entry) => sum + entry.units, 0);
      return Object.freeze({ tenantId, units });
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

function freezeAutomationConfigSync(sync: AutomationConfigSyncRecord): AutomationConfigSyncRecord {
  return Object.freeze({ ...sync });
}

function syncKey(tenantId: string, configRevision: number): string {
  return `${tenantId}\u0000${configRevision}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isClaimInput(value: unknown): value is Readonly<{
  limit: number;
  now: string;
  leaseUntil: string;
  claimToken: string;
}> {
  return (
    isPlainObject(value) &&
    isPositiveInteger(value.limit) &&
    value.limit <= 100 &&
    isTimestamp(value.now) &&
    isTimestamp(value.leaseUntil) &&
    Date.parse(value.leaseUntil) > Date.parse(value.now) &&
    isBoundedIdentifier(value.claimToken, false)
  );
}

function isSettlementInput(value: unknown): value is Readonly<{
  tenantId: string;
  configRevision: number;
  claimToken: string;
}> {
  return (
    isPlainObject(value) &&
    isUuid(value.tenantId) &&
    isPositiveInteger(value.configRevision) &&
    isBoundedIdentifier(value.claimToken, false)
  );
}

function isFailureInput(value: unknown): value is Readonly<{
  tenantId: string;
  configRevision: number;
  claimToken: string;
  retryable: boolean;
  failureCode: string;
  nextAttemptAt: string | null;
}> {
  if (!isPlainObject(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    isUuid(candidate.tenantId) &&
    isPositiveInteger(candidate.configRevision) &&
    isBoundedIdentifier(candidate.claimToken, false) &&
    typeof candidate.retryable === 'boolean' &&
    isBoundedIdentifier(candidate.failureCode, true) &&
    (candidate.retryable ? isTimestamp(candidate.nextAttemptAt) : candidate.nextAttemptAt === null)
  );
}

function isDue(sync: AutomationConfigSyncRecord, now: string): boolean {
  const current = Date.parse(now);
  return (
    sync.status === 'PENDING' ||
    (sync.status === 'RETRYABLE_FAILURE' &&
      sync.nextAttemptAt !== null &&
      Date.parse(sync.nextAttemptAt) <= current) ||
    (sync.status === 'IN_FLIGHT' &&
      sync.leaseUntil !== null &&
      Date.parse(sync.leaseUntil) <= current)
  );
}

function freezeDelivery(delivery: DeliveryRecord): DeliveryRecord {
  return Object.freeze({ ...delivery });
}

function freezeDeliveryAttempt(attempt: DeliveryAttemptRecord): DeliveryAttemptRecord {
  return Object.freeze({ ...attempt });
}

function deliveryAttemptKey(tenantId: string, operationId: string, attemptNumber: number): string {
  return `${tenantId}\u0000${operationId}\u0000${attemptNumber}`;
}

function entitlementBusinessKey(tenantId: string, businessKey: string): string {
  return `${tenantId}\u0000${businessKey}`;
}

function freezeEntitlementEntry(entry: EntitlementLedgerEntry): EntitlementLedgerEntry {
  return Object.freeze({ ...entry });
}

function sameEntitlementEntry(
  entry: EntitlementLedgerEntry,
  input: Readonly<Omit<EntitlementLedgerEntry, 'createdAt'>>,
): boolean {
  return (
    entry.id === input.id &&
    entry.entryType === input.entryType &&
    entry.units === input.units &&
    entry.businessKey === input.businessKey &&
    entry.correlationId === input.correlationId
  );
}

function isEntitlementLedgerInput(
  input: unknown,
): input is Readonly<Omit<EntitlementLedgerEntry, 'createdAt'>> {
  if (!isPlainObject(input)) return false;
  const units = input.units;
  return (
    isUuid(input.id) &&
    isUuid(input.tenantId) &&
    isEntitlementEntryType(input.entryType) &&
    typeof units === 'number' &&
    Number.isSafeInteger(units) &&
    units >= -1_000_000 &&
    units <= 1_000_000 &&
    units !== 0 &&
    isBoundedIdentifier(input.businessKey, false) &&
    isBoundedIdentifier(input.correlationId, false)
  );
}

function isEntitlementEntryType(value: unknown): value is EntitlementEntryType {
  return (
    value === 'CREDIT_PAYMENT' ||
    value === 'CREDIT_COUPON' ||
    value === 'DEBIT_CONFIRMED_DELIVERY' ||
    value === 'ADJUSTMENT'
  );
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
