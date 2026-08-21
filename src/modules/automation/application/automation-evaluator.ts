export type AutomationDecisionCode =
  | 'ACCEPTED'
  | 'BOT_DISABLED'
  | 'TARGET_GROUP_MISMATCH'
  | 'TRIGGER_NOT_ADMIN'
  | 'KEYWORD_NOT_MATCHED';

export type AutomationDecision = Readonly<{ code: AutomationDecisionCode }>;

export interface SyntheticInboundMessage {
  readonly groupId: string;
  readonly senderId: string;
  readonly text: string;
}

export interface AutomationPolicy {
  readonly enabled: boolean;
  readonly targetGroupId: string;
  readonly adminIds: readonly string[];
  readonly keyword: string;
}

export function evaluateAutomation(message: unknown, policy: unknown): AutomationDecision {
  if (!isMessage(message) || !isPolicy(policy))
    throw new Error('Invalid automation evaluation input');

  if (!policy.enabled) return decision('BOT_DISABLED');
  if (message.groupId !== policy.targetGroupId) return decision('TARGET_GROUP_MISMATCH');
  if (!policy.adminIds.includes(message.senderId)) return decision('TRIGGER_NOT_ADMIN');
  if (
    !message.text.toLocaleLowerCase('en-US').includes(policy.keyword.toLocaleLowerCase('en-US'))
  ) {
    return decision('KEYWORD_NOT_MATCHED');
  }
  return decision('ACCEPTED');
}

function decision(code: AutomationDecisionCode): AutomationDecision {
  return Object.freeze({ code });
}

function isMessage(value: unknown): value is SyntheticInboundMessage {
  return (
    isExactRecord(value, ['groupId', 'senderId', 'text']) &&
    isIdentifier(value.groupId) &&
    isIdentifier(value.senderId) &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    value.text.length <= 4_096
  );
}

function isPolicy(value: unknown): value is AutomationPolicy {
  return (
    isExactRecord(value, ['enabled', 'targetGroupId', 'adminIds', 'keyword']) &&
    typeof value.enabled === 'boolean' &&
    isIdentifier(value.targetGroupId) &&
    isIdentifierArray(value.adminIds) &&
    typeof value.keyword === 'string' &&
    value.keyword.trim().length > 0 &&
    value.keyword.length <= 256
  );
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const actual = Reflect.ownKeys(value).sort((left, right) =>
      String(left).localeCompare(String(right)),
    );
    const expected = [...keys].sort();
    return (
      actual.length === expected.length &&
      actual.every((key, index) => {
        if (typeof key !== 'string' || key !== expected[index]) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
}

function isIdentifierArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  try {
    if (
      value.length < 1 ||
      value.length > 100 ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor?.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value') ||
        !isIdentifier(descriptor.value)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,160}$/.test(value);
}
