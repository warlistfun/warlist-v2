import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  isProtectedAutomationFixturePath,
  runAutomationSimulation,
} from '../../src/debug-automation';

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

void test('rejects every protected fixture family before reading it', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-automation-protected-'));
  try {
    const fixture = JSON.stringify({
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
    });
    const protectedPaths = [
      'ops/fixture.json',
      'auth/fixture.json',
      'sessions/fixture.json',
      'logs/fixture.json',
      'data/fixture.json',
      'baileys/fixture.json',
      'qr/fixture.json',
      'uploads/runtime/fixture.json',
      'warlist-cache/fixture.json',
      '.baileys-backup/fixture.json',
      'backup/fixture.json',
      'node_modules/fixture.json',
      'nested/fixture.db.copy',
      'nested/fixture.sqlite.backup',
      'Nested/AUTH/fixture.json',
      '.env.production',
      '.gitmodules',
    ];
    for (const protectedPath of protectedPaths) {
      assert.equal(
        isProtectedAutomationFixturePath(join(root, protectedPath)),
        true,
        protectedPath,
      );
    }
    assert.equal(isProtectedAutomationFixturePath(join(root, 'fixtures', 'safe.json')), false);

    const protectedFixture = join(root, 'auth', 'fixture.json');
    mkdirSync(join(protectedFixture, '..'), { recursive: true });
    writeFileSync(protectedFixture, fixture);
    assert.throws(
      () => execFileSync('npm', ['run', '--silent', 'debug:automation', '--', protectedFixture]),
      /Invalid automation simulator fixture/,
    );

    const disguisedProtectedFixture = join(root, 'fixtures', 'safe-looking.json');
    mkdirSync(join(disguisedProtectedFixture, '..'), { recursive: true });
    symlinkSync(protectedFixture, disguisedProtectedFixture);
    assert.throws(
      () =>
        execFileSync('npm', [
          'run',
          '--silent',
          'debug:automation',
          '--',
          disguisedProtectedFixture,
        ]),
      /Invalid automation simulator fixture/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
