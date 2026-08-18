import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/check-repository-boundary.mjs');

function repositoryWith(path: string): void {
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: path });
  execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: path });
  execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: path });
}

void test('boundary checker accepts an allowed tracked source file', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-boundary-'));
  try {
    repositoryWith(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'safe.ts'), 'export const safe = true;\n');
    execFileSync('git', ['add', 'src/safe.ts'], { cwd: root });

    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('boundary checker rejects a tracked protected path without reading it', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-boundary-'));
  try {
    repositoryWith(root);
    mkdirSync(join(root, 'auth'));
    writeFileSync(join(root, 'auth', 'do-not-read.json'), 'synthetic-secret-marker');
    execFileSync('git', ['add', '-f', 'auth/do-not-read.json'], { cwd: root });

    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden tracked path: auth\/do-not-read\.json/);
    assert.doesNotMatch(result.stderr, /synthetic-secret-marker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('boundary checker rejects tracked symlinks that can escape the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-boundary-'));
  try {
    repositoryWith(root);
    symlinkSync('/tmp/outside-warlist', join(root, 'outside'));
    execFileSync('git', ['add', 'outside'], { cwd: root });

    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden tracked symlink: outside/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('boundary checker rejects repository indirection metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'warlist-boundary-'));
  try {
    repositoryWith(root);
    writeFileSync(join(root, '.gitmodules'), '[submodule "unsafe"]\n');
    execFileSync('git', ['add', '.gitmodules'], { cwd: root });

    const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden tracked path: \.gitmodules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const protectedPath of [
  'nested/auth/secret.json',
  'foo/data/records.json',
  'Nested/.env.production',
  'nested/.envlocal',
  'Auth/secret.json',
  'customer.db.bak',
  'customer.db3',
  'customer.sqlite.backup',
  'nested/customer.db.copy',
]) {
  void test(`boundary checker rejects nested or case-varied path ${protectedPath}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'warlist-boundary-'));
    try {
      repositoryWith(root);
      mkdirSync(join(root, protectedPath, '..'), { recursive: true });
      writeFileSync(join(root, protectedPath), 'synthetic-marker');
      execFileSync('git', ['add', '-f', protectedPath], { cwd: root });

      const result = spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`forbidden tracked path: ${protectedPath}`));
      assert.doesNotMatch(result.stderr, /synthetic-marker/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

void test('gitignore ignores every documented database artifact variant', () => {
  for (const protectedPath of [
    'customer.db.bak',
    'customer.db3',
    'customer.sqlite.backup',
    'nested/customer.db.copy',
  ]) {
    assert.doesNotThrow(() =>
      execFileSync('git', ['check-ignore', '--no-index', '-q', protectedPath]),
    );
  }
});
