import { RepositoryError, type BusinessRepositoryPort } from '../../../app/business-repository';
import type { AutomationPolicy } from './automation-evaluator';

export type AutomationConfigMutation =
  | Readonly<{ field: 'enabled'; value: boolean }>
  | Readonly<{ field: 'targetGroupId'; value: string }>
  | Readonly<{ field: 'adminIds'; value: readonly string[] }>
  | Readonly<{ field: 'keyword'; value: string }>;

export type CommittedAutomationConfig = Readonly<{
  revision: number;
  policy: AutomationPolicy;
}>;

export interface AutomationGroupDirectoryPort {
  loadGroup(input: Readonly<{ tenantId: string; groupId: string }>): Promise<unknown>;
}

export function createAutomationConfigMutationService(dependencies: {
  readonly repository: BusinessRepositoryPort;
  readonly trustedTenant: Readonly<{ tenantId: string }>;
  readonly groupDirectory: AutomationGroupDirectoryPort;
}): Readonly<{
  mutate(
    input: Readonly<{ expectedRevision: number; mutation: AutomationConfigMutation }>,
  ): Promise<CommittedAutomationConfig>;
}> {
  return Object.freeze({
    async mutate(input): Promise<CommittedAutomationConfig> {
      if (!isInput(input)) throw new Error('Invalid automation configuration mutation');
      const current = await dependencies.repository.loadConfig(dependencies.trustedTenant.tenantId);
      if (!current || current.revision !== input.expectedRevision) {
        throw new RepositoryError('CONFIG_VERSION_CONFLICT');
      }
      const policy = mutatePolicy(current.configuration, input.mutation);
      if (!policy) throw new Error('Invalid automation configuration');
      const group = await dependencies.groupDirectory.loadGroup({
        tenantId: dependencies.trustedTenant.tenantId,
        groupId: policy.targetGroupId,
      });
      if (!hasAllAdmins(group, policy.adminIds))
        throw new Error('Invalid automation configuration');
      const saved = await dependencies.repository.compareAndSaveConfigWithSync(
        {
          tenantId: dependencies.trustedTenant.tenantId,
          configuration: Object.freeze({ ...current.configuration, automation: policy }),
        },
        input.expectedRevision,
      );
      return Object.freeze({ revision: saved.config.revision, policy });
    },
  });
}

function isInput(value: unknown): value is Readonly<{
  expectedRevision: number;
  mutation: AutomationConfigMutation;
}> {
  if (!isExactRecord(value, ['expectedRevision', 'mutation'])) return false;
  const expectedRevision = value.expectedRevision;
  return (
    typeof expectedRevision === 'number' &&
    Number.isSafeInteger(expectedRevision) &&
    expectedRevision > 0 &&
    isMutation(value.mutation)
  );
}

function isMutation(value: unknown): value is AutomationConfigMutation {
  if (!isExactRecord(value, ['field', 'value']) || typeof value.field !== 'string') return false;
  if (value.field === 'enabled') return typeof value.value === 'boolean';
  if (value.field === 'targetGroupId' || value.field === 'keyword')
    return typeof value.value === 'string';
  return value.field === 'adminIds' && isStringArray(value.value);
}

function mutatePolicy(
  configuration: Readonly<Record<string, unknown>>,
  mutation: AutomationConfigMutation,
): AutomationPolicy | undefined {
  const automation = configuration.automation;
  if (!isPolicy(automation)) return undefined;
  const candidate = { ...automation, [mutation.field]: mutation.value };
  return isPolicy(candidate)
    ? Object.freeze({ ...candidate, adminIds: Object.freeze([...candidate.adminIds]) })
    : undefined;
}

function isPolicy(value: unknown): value is AutomationPolicy {
  return (
    (isExactRecord(value, ['enabled', 'targetGroupId', 'adminIds', 'keyword']) ||
      (isExactRecord(value, [
        'enabled',
        'opsStatus',
        'timeWindow',
        'targetGroupId',
        'adminIds',
        'keyword',
      ]) &&
        (value.opsStatus === 'active' || value.opsStatus === 'inactive') &&
        isTimeWindow(value.timeWindow))) &&
    typeof value.enabled === 'boolean' &&
    isIdentifier(value.targetGroupId) &&
    isStringArray(value.adminIds) &&
    typeof value.keyword === 'string' &&
    value.keyword.trim().length > 0 &&
    value.keyword.length <= 256
  );
}

function isTimeWindow(value: unknown): boolean {
  return (
    isExactRecord(value, ['enabled', 'startMinute', 'endMinute']) &&
    typeof value.enabled === 'boolean' &&
    isMinute(value.startMinute) &&
    isMinute(value.endMinute)
  );
}

function isMinute(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_440;
}

function hasAllAdmins(group: unknown, expectedAdminIds: readonly string[]): boolean {
  if (!isExactRecord(group, ['adminIds']) || !isStringArray(group.adminIds)) return false;
  const current = new Set(group.adminIds);
  return expectedAdminIds.every((adminId) => current.has(adminId));
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(isIdentifier)
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,160}$/.test(value);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const actual = Reflect.ownKeys(value).sort((left, right) =>
      String(left).localeCompare(String(right)),
    );
    const expected = [...keys].sort();
    return (
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      actual.length === expected.length &&
      actual.every((key, index) => {
        const descriptor =
          typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
        return (
          key === expected[index] &&
          descriptor?.enumerable === true &&
          Object.hasOwn(descriptor, 'value')
        );
      })
    );
  } catch {
    return false;
  }
}
