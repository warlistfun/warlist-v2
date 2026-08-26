import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkerDiagnosticsService } from '../../src/modules/whatsapp/application/worker-diagnostics-service';

void test('records immutable safe command lifecycle events with correlation identity', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });

  diagnostics.recordCommand({
    outcome: 'TIMED_OUT',
    commandType: 'START_WORKER',
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
    rawError: new Error('must not escape'),
  } as Parameters<typeof diagnostics.recordCommand>[0]);

  assert.deepEqual(events, [
    {
      kind: 'COMMAND',
      outcome: 'TIMED_OUT',
      commandType: 'START_WORKER',
      correlationId: 'corr_example_1',
      tenantId: 'tenant_example_1',
      generation: 1,
      childId: 'child_example_1',
    },
  ]);
  assert.equal(Object.isFrozen(events[0] as object), true);
});

void test('records only the immutable inbound outcome projection', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });

  diagnostics.recordInbound?.({
    transportCode: 'FORWARDED',
    decisionCode: 'ACCEPTED',
    messageId: `message:${'a'.repeat(64)}`,
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
    rawMessage: 'must not escape',
    rawJid: 'must not escape',
  } as Parameters<NonNullable<typeof diagnostics.recordInbound>>[0]);

  assert.deepEqual(events, [
    {
      kind: 'INBOUND',
      transportCode: 'FORWARDED',
      decisionCode: 'ACCEPTED',
      messageId: `message:${'a'.repeat(64)}`,
      correlationId: 'corr_example_1',
      tenantId: 'tenant_example_1',
      generation: 1,
      childId: 'child_example_1',
    },
  ]);
  assert.equal(Object.isFrozen(events[0] as object), true);
});

void test('drops malformed inbound diagnostics', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });
  const valid = {
    transportCode: 'FORWARDED',
    decisionCode: 'ACCEPTED',
    messageId: `message:${'a'.repeat(64)}`,
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
  } as const;
  for (const event of [
    { ...valid, transportCode: 'RAW_PROVIDER_CODE' },
    { ...valid, decisionCode: 'RAW_DECISION' },
    { ...valid, messageId: 'raw-message-id' },
    { ...valid, tenantId: 'tenant\nunsafe' },
  ]) {
    diagnostics.recordInbound?.(event as typeof valid);
  }
  assert.deepEqual(events, []);
});

void test('drops malformed or unbounded command diagnostic values', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });
  const valid = {
    outcome: 'ACKNOWLEDGED',
    commandType: 'START_WORKER',
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
  } as const;

  for (const event of [
    { ...valid, outcome: 'RAW_ERROR' },
    { ...valid, commandType: 'RAW_COMMAND' },
    { ...valid, correlationId: 'x'.repeat(129) },
    { ...valid, tenantId: 'tenant\nunsafe' },
    { ...valid, childId: ' ' },
    { ...valid, generation: 0 },
  ]) {
    diagnostics.recordCommand(event as typeof valid);
  }

  assert.deepEqual(events, []);
});

void test('does not let a diagnostic sink failure escape', () => {
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record() {
        throw new Error('sink unavailable');
      },
    },
  });

  assert.doesNotThrow(() => {
    diagnostics.recordCommand({
      outcome: 'ACKNOWLEDGED',
      commandType: 'START_WORKER',
      correlationId: 'corr_example_1',
      tenantId: 'tenant_example_1',
      generation: 1,
      childId: 'child_example_1',
    });
  });
});

void test('records only the bounded ownership state projection', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });

  diagnostics.recordOwnership({
    state: 'STOPPING',
    quarantined: true,
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
    rawState: { desired: 'STOPPED' },
  } as Parameters<typeof diagnostics.recordOwnership>[0]);

  assert.deepEqual(events, [
    {
      kind: 'OWNERSHIP',
      state: 'STOPPING',
      quarantined: true,
      correlationId: 'corr_example_1',
      tenantId: 'tenant_example_1',
      generation: 1,
      childId: 'child_example_1',
    },
  ]);
  assert.equal(Object.isFrozen(events[0] as object), true);
});

void test('drops malformed or unbounded ownership diagnostic values', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });
  const valid = {
    state: 'RUNNING',
    quarantined: false,
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
  } as const;

  for (const event of [
    { ...valid, state: 'UNKNOWN' },
    { ...valid, quarantined: 'yes' },
    { ...valid, correlationId: 'x'.repeat(129) },
    { ...valid, tenantId: 'tenant\nunsafe' },
    { ...valid, childId: ' ' },
    { ...valid, generation: 0 },
  ]) {
    diagnostics.recordOwnership(event as typeof valid);
  }

  assert.deepEqual(events, []);
});

void test('snapshots each command diagnostic value before validation', () => {
  const events: unknown[] = [];
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record(event: unknown) {
        events.push(event);
      },
    },
  });
  let reads = 0;

  diagnostics.recordCommand({
    outcome: 'ACKNOWLEDGED',
    commandType: 'START_WORKER',
    get correlationId() {
      reads += 1;
      return reads === 1 ? 'corr_example_1' : 'x'.repeat(129);
    },
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
  });

  assert.equal(reads, 1);
  assert.deepEqual(events, [
    {
      kind: 'COMMAND',
      outcome: 'ACKNOWLEDGED',
      commandType: 'START_WORKER',
      correlationId: 'corr_example_1',
      tenantId: 'tenant_example_1',
      generation: 1,
      childId: 'child_example_1',
    },
  ]);
});

void test('observes asynchronous diagnostic sink rejection', () => {
  let handled = false;
  const failure = Promise.reject(new Error('async sink failure'));
  const originalCatch = failure.catch.bind(failure);
  failure.catch = ((onRejected) => {
    handled = true;
    return originalCatch(onRejected);
  }) as typeof failure.catch;
  const diagnostics = createWorkerDiagnosticsService({
    sink: {
      record() {
        return failure;
      },
    },
  });

  diagnostics.recordCommand({
    outcome: 'ACKNOWLEDGED',
    commandType: 'START_WORKER',
    correlationId: 'corr_example_1',
    tenantId: 'tenant_example_1',
    generation: 1,
    childId: 'child_example_1',
  });
  const observed = handled;
  if (!handled) void failure.catch(() => undefined);

  assert.equal(observed, true);
});
