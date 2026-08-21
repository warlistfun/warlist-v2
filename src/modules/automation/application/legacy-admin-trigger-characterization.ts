export type LegacyAdminTriggerDecision = Readonly<{
  code: 'TRIGGER_MATCHED' | 'TRIGGER_NOT_MATCHED';
}>;

type Input = Readonly<{ senderId: string; text: string }>;
type Policy = Readonly<{
  globalKeywords: readonly string[];
  adminTriggers: readonly Readonly<{ senderId: string; trigger: string }>[];
}>;

export function decideLegacyAdminTrigger(
  input: unknown,
  policy: unknown,
): LegacyAdminTriggerDecision {
  if (!isInput(input) || !isPolicy(policy))
    throw new Error('Invalid legacy admin-trigger characterization input');

  const text = clean(input.text);
  const configured = policy.adminTriggers.find(
    (entry) => clean(entry.senderId) === clean(input.senderId),
  );
  const matched = configured
    ? text.includes(clean(configured.trigger))
    : policy.globalKeywords.some((keyword) => text.includes(clean(keyword)));
  return Object.freeze({ code: matched ? 'TRIGGER_MATCHED' : 'TRIGGER_NOT_MATCHED' });
}

function clean(value: string): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/gu, '')
    .toLowerCase()
    .trim();
}

function isInput(value: unknown): value is Input {
  return (
    isExactRecord(value, ['senderId', 'text']) &&
    nonEmpty(field(value, 'senderId')) &&
    nonEmpty(field(value, 'text'))
  );
}

function isPolicy(value: unknown): value is Policy {
  if (!isExactRecord(value, ['globalKeywords', 'adminTriggers'])) return false;
  const globalKeywords = field(value, 'globalKeywords');
  const adminTriggers = field(value, 'adminTriggers');
  return (
    Array.isArray(globalKeywords) &&
    globalKeywords.length > 0 &&
    globalKeywords.every(nonEmpty) &&
    Array.isArray(adminTriggers) &&
    adminTriggers.every(
      (entry) =>
        isExactRecord(entry, ['senderId', 'trigger']) &&
        nonEmpty(field(entry, 'senderId')) &&
        nonEmpty(field(entry, 'trigger')),
    )
  );
}

function field(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && clean(value).length > 0;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}
