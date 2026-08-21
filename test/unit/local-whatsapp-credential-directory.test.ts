import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createLocalWhatsAppCredentialDirectory,
  LocalCredentialDirectoryError,
  type LocalCredentialDirectoryErrorCode,
} from '../../src/modules/whatsapp/infrastructure/local-whatsapp-credential-directory';

const tenantOne = '00000000-0000-4000-8000-000000000101';
const tenantTwo = '00000000-0000-4000-8000-000000000102';

void test('creates isolated owner-only credential directories without credential payloads', async (t) => {
  const sandbox = await createSandbox(t);
  const root = join(sandbox, 'credentials');
  const directory = createLocalWhatsAppCredentialDirectory({ root });

  await assert.rejects(lstat(root), hasFileCode('ENOENT'));

  const first = await directory.prepare(tenantOne);
  const repeated = await directory.prepare(tenantOne);
  const second = await directory.prepare(tenantTwo);

  assert.deepEqual(first, { directory: join(root, tenantOne) });
  assert.deepEqual(repeated, first);
  assert.deepEqual(second, { directory: join(root, tenantTwo) });
  assert.equal(Object.isFrozen(first), true);
  const uid = process.getuid?.();
  assert.equal(typeof uid, 'number');
  for (const path of [root, first.directory, second.directory]) {
    const metadata = await lstat(path);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(metadata.mode & 0o7777, 0o700);
    assert.equal(metadata.uid, uid);
  }
  assert.deepEqual(await readdir(first.directory), []);
  assert.deepEqual(await readdir(second.directory), []);
});

void test('rejects invalid roots and tenant identities before filesystem mutation', async (t) => {
  assert.throws(
    () => createLocalWhatsAppCredentialDirectory({ root: 'relative/credentials' }),
    hasDirectoryError('INVALID_CREDENTIAL_DIRECTORY_CONFIG'),
  );
  assert.throws(
    () => createLocalWhatsAppCredentialDirectory({ root: '/' }),
    hasDirectoryError('INVALID_CREDENTIAL_DIRECTORY_CONFIG'),
  );

  const sandbox = await createSandbox(t);
  const root = join(sandbox, 'credentials');
  const directory = createLocalWhatsAppCredentialDirectory({ root });
  await assert.rejects(
    directory.prepare('../tenant'),
    hasDirectoryError('INVALID_CREDENTIAL_TENANT_ID'),
  );
  await assert.rejects(lstat(root), hasFileCode('ENOENT'));
});

void test('rejects insecure roots and symlink traversal with safe errors', async (t) => {
  const sandbox = await createSandbox(t);
  const insecureRoot = join(sandbox, 'insecure');
  await mkdir(insecureRoot, { mode: 0o700 });
  await chmod(insecureRoot, 0o755);
  const insecure = createLocalWhatsAppCredentialDirectory({ root: insecureRoot });
  await assert.rejects(
    insecure.prepare(tenantOne),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );

  const fileRoot = join(sandbox, 'not-a-directory');
  await writeFile(fileRoot, 'synthetic marker', { mode: 0o600 });
  const nonDirectory = createLocalWhatsAppCredentialDirectory({ root: fileRoot });
  await assert.rejects(
    nonDirectory.prepare(tenantOne),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );

  const actualParent = join(sandbox, 'actual-parent');
  const linkedParent = join(sandbox, 'linked-parent');
  await mkdir(actualParent, { mode: 0o700 });
  await symlink(actualParent, linkedParent, 'dir');
  const traversing = createLocalWhatsAppCredentialDirectory({
    root: join(linkedParent, 'credentials'),
  });
  await assert.rejects(
    traversing.prepare(tenantOne),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );

  const safeRoot = join(sandbox, 'safe');
  const safe = createLocalWhatsAppCredentialDirectory({ root: safeRoot });
  await safe.prepare(tenantOne);
  const outside = join(sandbox, 'outside');
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(safeRoot, tenantTwo), 'dir');
  await assert.rejects(safe.prepare(tenantTwo), hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'));
});

async function createSandbox(t: test.TestContext): Promise<string> {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-credential-directory-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return sandbox;
}

function hasDirectoryError(code: LocalCredentialDirectoryErrorCode) {
  return (error: unknown): boolean =>
    error instanceof LocalCredentialDirectoryError &&
    error.code === code &&
    !error.message.includes('/tmp/') &&
    !('cause' in error);
}

function hasFileCode(code: string) {
  return (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Readonly<{ code?: unknown }>).code === code;
}
