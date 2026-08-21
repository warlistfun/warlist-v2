import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runAutomationSimulation } from '../../src/debug-automation';

void test('simulates normalized synthetic input through the existing evaluator', () => {
  assert.deepEqual(
    runAutomationSimulation({
      message: {
        groupId: ' GROUP_EXAMPLE_ONE ',
        senderId: ' ADMIN_EXAMPLE_ONE ',
        text: '  list today  ',
      },
      policy: {
        enabled: true,
        targetGroupId: 'group_example_one',
        adminIds: ['admin_example_one'],
        keyword: 'list',
      },
    }),
    { code: 'ACCEPTED' },
  );

  assert.deepEqual(
    runAutomationSimulation({
      message: {
        groupId: 'group_example_one',
        senderId: 'member_example_one',
        text: 'list today',
      },
      policy: {
        enabled: true,
        targetGroupId: 'group_example_one',
        adminIds: ['admin_example_one'],
        keyword: 'list',
      },
    }),
    { code: 'SENDER_NOT_ADMIN' },
  );
});

void test('simulates a synthetic OPS-status and time-window decision from an injected minute', () => {
  assert.deepEqual(
    runAutomationSimulation({
      currentMinute: 720,
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'list today',
      },
      policy: {
        enabled: true,
        opsStatus: 'active',
        timeWindow: { enabled: true, startMinute: 1320, endMinute: 360 },
        targetGroupId: 'group_example_one',
        adminIds: ['admin_example_one'],
        keyword: 'list',
      },
    }),
    { code: 'OUTSIDE_SCHEDULE' },
  );
});

void test('simulates explicit synthetic delivery state', () => {
  assert.deepEqual(
    runAutomationSimulation({
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'list today',
      },
      policy: {
        enabled: true,
        targetGroupId: 'group_example_one',
        adminIds: ['admin_example_one'],
        keyword: 'list',
      },
      state: { hasEntitlement: true, duplicateMessage: true, deliveryExists: false },
    }),
    { code: 'DUPLICATE_MESSAGE' },
  );
});

void test('runs the CLI with one JSON fixture and prints only its decision', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-automation-simulator-'));
  try {
    const fixturePath = join(root, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        message: {
          groupId: 'group_example_one',
          senderId: 'admin_example_one',
          text: 'list today',
        },
        policy: {
          enabled: true,
          targetGroupId: 'group_example_one',
          adminIds: ['admin_example_one'],
          keyword: 'list',
        },
      }),
    );
    const output = execFileSync('npm', ['run', '--silent', 'debug:automation', '--', fixturePath], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(output, '{"code":"ACCEPTED"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('rejects a protected fixture path before reading it', () => {
  assert.throws(
    () => execFileSync('npm', ['run', '--silent', 'debug:automation', '--', '.env.production']),
    /Invalid automation simulator fixture/,
  );
});

void test('rejects unsafe simulator fixtures without echoing input', () => {
  const marker = 'customer-content-must-not-leak';
  const accessor = {
    message: {
      groupId: 'group_example_one',
      senderId: 'admin_example_one',
      text: 'list today',
    },
  };
  Object.defineProperty(accessor, 'policy', {
    enumerable: true,
    get(): never {
      throw new Error(marker);
    },
  });

  for (const fixture of [
    null,
    { message: {}, policy: {}, rawPayload: marker },
    accessor,
    {
      message: {
        groupId: 'group_example_one',
        senderId: 'admin_example_one',
        text: 'list today',
      },
      policy: {
        enabled: true,
        targetGroupId: 'group_example_one',
        adminIds: ['admin_example_one'],
        keyword: 'list',
        rawPayload: marker,
      },
    },
  ]) {
    assert.throws(
      () => runAutomationSimulation(fixture),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Invalid automation simulator fixture' &&
        !error.message.includes(marker),
    );
  }
});
