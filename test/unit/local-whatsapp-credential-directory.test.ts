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
const owner = (tenantId: string, generation = 1) => ({
  tenantId,
  generation,
  childId: `child_example_${generation}`,
});

void test('creates isolated owner-only credential directories without credential payloads', async (t) => {
  const sandbox = await createSandbox(t);
  const root = join(sandbox, 'credentials');
  const directory = createLocalWhatsAppCredentialDirectory({ root });

  await assert.rejects(lstat(root), hasFileCode('ENOENT'));

  const first = await directory.acquire(owner(tenantOne));
  const second = await directory.acquire(owner(tenantTwo));

  assert.equal(await first.use((path) => path), join(root, tenantOne));
  assert.equal(await second.use((path) => path), join(root, tenantTwo));
  assert.equal(Object.isFrozen(first), true);
  const uid = process.getuid?.();
  assert.equal(typeof uid, 'number');
  for (const path of [root, join(root, tenantOne), join(root, tenantTwo)]) {
    const metadata = await lstat(path);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(metadata.mode & 0o7777, 0o700);
    assert.equal(metadata.uid, uid);
  }
  assert.deepEqual(await readdir(join(root, tenantOne)), []);
  assert.deepEqual(await readdir(join(root, tenantTwo)), []);

  await first.release();
  await second.release();
});

void test('rejects invalid roots and owner identities before filesystem mutation', async (t) => {
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
    directory.acquire({ tenantId: '../tenant', generation: 1, childId: 'child_example_invalid' }),
    hasDirectoryError('INVALID_CREDENTIAL_TENANT_ID'),
  );
  await assert.rejects(
    directory.acquire({ tenantId: tenantOne, generation: 0, childId: 'child_example_invalid' }),
    hasDirectoryError('INVALID_CREDENTIAL_OWNER'),
  );
  await assert.rejects(
    directory.acquire('../tenant'),
    hasDirectoryError('INVALID_CREDENTIAL_OWNER'),
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
    insecure.acquire(owner(tenantOne)),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );

  const fileRoot = join(sandbox, 'not-a-directory');
  await writeFile(fileRoot, 'synthetic marker', { mode: 0o600 });
  const nonDirectory = createLocalWhatsAppCredentialDirectory({ root: fileRoot });
  await assert.rejects(
    nonDirectory.acquire(owner(tenantOne)),
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
    traversing.acquire(owner(tenantOne)),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );

  const safeRoot = join(sandbox, 'safe');
  const safe = createLocalWhatsAppCredentialDirectory({ root: safeRoot });
  const safeHandle = await safe.acquire(owner(tenantOne));
  await safeHandle.release();
  const outside = join(sandbox, 'outside');
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(safeRoot, tenantTwo), 'dir');
  await assert.rejects(
    safe.acquire(owner(tenantTwo)),
    hasDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE'),
  );
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
