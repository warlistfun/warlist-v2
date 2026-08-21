import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import {
  evaluateAutomation,
  type AutomationDecision,
  type AutomationPolicy,
} from './modules/automation/application/automation-evaluator';
import { normalizeSyntheticInboundMessage } from './modules/automation/application/inbound-message-normalizer';

const invalidFixture = (): Error => new Error('Invalid automation simulator fixture');

export function runAutomationSimulation(input: unknown): AutomationDecision {
  const fixture = exactFixture(input);
  if (!fixture) throw invalidFixture();

  try {
    return evaluateAutomation(
      normalizeSyntheticInboundMessage(fixture.message),
      fixture.policy,
      fixture.currentMinute,
      fixture.state,
    );
  } catch {
    throw invalidFixture();
  }
}

function exactFixture(input: unknown):
  | Readonly<{
      message: unknown;
      policy: AutomationPolicy;
      currentMinute?: unknown;
      state?: unknown;
    }>
  | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(input);
    if (
      keys.length < 2 ||
      keys.length > 4 ||
      !keys.every(
        (key) =>
          key === 'message' || key === 'policy' || key === 'currentMinute' || key === 'state',
      )
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of ['message', 'policy'] as const) {
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
    }
    if (
      Object.hasOwn(descriptors, 'currentMinute') &&
      (descriptors.currentMinute?.enumerable !== true ||
        !Object.hasOwn(descriptors.currentMinute, 'value'))
    ) {
      return undefined;
    }
    if (
      Object.hasOwn(descriptors, 'state') &&
      (descriptors.state?.enumerable !== true || !Object.hasOwn(descriptors.state, 'value'))
    ) {
      return undefined;
    }
    return {
      message: descriptors.message?.value,
      policy: descriptors.policy?.value as AutomationPolicy,
      currentMinute: descriptors.currentMinute?.value,
      state: descriptors.state?.value,
    };
  } catch {
    return undefined;
  }
}

function runCli(args: readonly string[]): void {
  const [fixturePath] = args;
  if (args.length !== 1 || !fixturePath) throw invalidFixture();
  const path = resolve(fixturePath);
  if (path.split(sep).some((segment) => segment === 'data' || segment.startsWith('.env'))) {
    throw invalidFixture();
  }
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  process.stdout.write(`${JSON.stringify(runAutomationSimulation(fixture))}\n`);
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch {
    process.stderr.write('Invalid automation simulator fixture\n');
    process.exitCode = 1;
  }
}
