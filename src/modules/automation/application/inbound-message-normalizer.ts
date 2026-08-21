import type { SyntheticInboundMessage } from './automation-evaluator';

const invalidInput = (): Error => new Error('Invalid synthetic inbound message');

export function normalizeSyntheticInboundMessage(input: unknown): SyntheticInboundMessage {
  const values = exactMessageValues(input);
  if (!values) throw invalidInput();

  const groupId = normalizeIdentifier(values.groupId);
  const senderId = normalizeIdentifier(values.senderId);
  const text = normalizeText(values.text);
  if (!groupId || !senderId || !text) throw invalidInput();

  return Object.freeze({ groupId, senderId, text });
}

function exactMessageValues(
  input: unknown,
): Readonly<Record<'groupId' | 'senderId' | 'text', unknown>> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 3 ||
      !keys.every((key) => typeof key === 'string' && ['groupId', 'senderId', 'text'].includes(key))
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of ['groupId', 'senderId', 'text'] as const) {
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
    }
    return {
      groupId: descriptors.groupId?.value,
      senderId: descriptors.senderId?.value,
      text: descriptors.text?.value,
    };
  } catch {
    return undefined;
  }
}

function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 160 || !/^ *[a-z0-9_:-]+ *$/i.test(value)) {
    return undefined;
  }
  return value.trim().replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function normalizeText(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 4_096 ||
    /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return undefined;
  }
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/gu, '\n')
    .normalize('NFC')
    .trim();
  return normalized.length > 0 && normalized.length <= 4_096 ? normalized : undefined;
}
