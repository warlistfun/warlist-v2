import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createLocalWhatsAppCredentialDirectory,
  LocalCredentialDirectoryError,
} from '../../src/modules/whatsapp/infrastructure/local-whatsapp-credential-directory';

const mutableFsPromises = createRequire(__filename)('node:fs/promises') as {
  unlink: typeof import('node:fs/promises').unlink;
};

const tenantId = '00000000-0000-4000-8000-000000000142';
const firstOwner = { tenantId, generation: 1, childId: 'child_example_142_a' } as const;
const nextOwner = { tenantId, generation: 2, childId: 'child_example_142_b' } as const;

void test('grants one exact owner and fences concurrent, foreign, and stale use', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-04-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'credentials');
  const credentials = createLocalWhatsAppCredentialDirectory({ root });

  const first = await credentials.acquire(firstOwner);
  assert.equal(await first.use((directory) => directory), join(root, tenantId));

  await assert.rejects(credentials.acquire(firstOwner), ownedError);
  await assert.rejects(credentials.acquire(nextOwner), ownedError);
  await assert.rejects(
    credentials.acquire({ ...firstOwner, childId: 'child_example_142_foreign' }),
    ownedError,
  );

  const entries = await readdir(root, { withFileTypes: true });
  const lock = entries.find((entry) => entry.isFile());
  assert.ok(lock);
  const uid = process.getuid?.();
  assert.equal(typeof uid, 'number');
  const lockMetadata = await lstat(join(root, lock.name));
  assert.equal(lockMetadata.mode & 0o7777, 0o600);
  assert.equal(lockMetadata.uid, uid);
  assert.equal(lockMetadata.size, 0);

  await first.release();
  const next = await credentials.acquire(nextOwner);
  await assert.rejects(
    first.use(() => Promise.resolve()),
    lostError,
  );
  await first.release();
  assert.equal(await next.use((directory) => directory), join(root, tenantId));
  await next.release();
});

void test('does not recreate a credential path that disappears during active ownership', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-04-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'credentials');
  const directory = join(root, tenantId);
  const handle = await createLocalWhatsAppCredentialDirectory({ root }).acquire(firstOwner);

  await rm(directory, { recursive: true });
  await assert.rejects(
    handle.use(() => Promise.resolve()),
    (error: unknown) =>
      error instanceof LocalCredentialDirectoryError &&
      error.code === 'CREDENTIAL_DIRECTORY_UNAVAILABLE',
  );
  await assert.rejects(lstat(directory), (error: unknown) => hasFileCode(error, 'ENOENT'));

  await mkdir(directory, { mode: 0o700 });
  await handle.release();
});

void test('retries release after one transient lock unlink failure', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'warlist-v2-om-04-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'credentials');
  const credentials = createLocalWhatsAppCredentialDirectory({ root });
  const handle = await credentials.acquire(firstOwner);
  const lockPath = join(root, `.${tenantId}.owner.lock`);
  const unlink = mutableFsPromises.unlink;
  let attempts = 0;
  mutableFsPromises.unlink = async (path, ...options) => {
    if (path === lockPath && attempts++ === 0) {
      const error = new Error('synthetic unlink failure') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    return unlink(path, ...options);
  };
  try {
    await assert.rejects(
      handle.release(),
      (error: unknown) =>
        error instanceof LocalCredentialDirectoryError &&
        error.code === 'CREDENTIAL_DIRECTORY_UNAVAILABLE',
    );
    await assert.rejects(credentials.acquire(nextOwner), ownedError);
    await handle.release();
  } finally {
    mutableFsPromises.unlink = unlink;
  }

  const next = await credentials.acquire(nextOwner);
  assert.equal(await next.use((directory) => directory), join(root, tenantId));
  await next.release();
});

function ownedError(error: unknown): boolean {
  return (
    error instanceof LocalCredentialDirectoryError &&
    error.code === 'CREDENTIAL_DIRECTORY_OWNED' &&
    !error.message.includes('/tmp/') &&
    !error.message.includes(tenantId) &&
    !('cause' in error)
  );
}

function lostError(error: unknown): boolean {
  return (
    error instanceof LocalCredentialDirectoryError &&
    error.code === 'CREDENTIAL_DIRECTORY_OWNERSHIP_LOST' &&
    !error.message.includes('/tmp/') &&
    !error.message.includes(tenantId) &&
    !('cause' in error)
  );
}

function hasFileCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Readonly<{ code?: unknown }>).code === code
  );
}
