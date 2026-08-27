import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export type LocalCredentialDirectoryErrorCode =
  | 'INVALID_CREDENTIAL_DIRECTORY_CONFIG'
  | 'INVALID_CREDENTIAL_TENANT_ID'
  | 'INVALID_CREDENTIAL_OWNER'
  | 'CREDENTIAL_DIRECTORY_OWNED'
  | 'CREDENTIAL_DIRECTORY_OWNERSHIP_LOST'
  | 'CREDENTIAL_DIRECTORY_UNSAFE'
  | 'CREDENTIAL_DIRECTORY_UNAVAILABLE';

const errors = {
  INVALID_CREDENTIAL_DIRECTORY_CONFIG: ['Invalid credential directory configuration', false],
  INVALID_CREDENTIAL_TENANT_ID: ['Invalid credential tenant identity', false],
  INVALID_CREDENTIAL_OWNER: ['Invalid credential owner identity', false],
  CREDENTIAL_DIRECTORY_OWNED: ['Credential directory already has an owner', true],
  CREDENTIAL_DIRECTORY_OWNERSHIP_LOST: ['Credential directory ownership was lost', false],
  CREDENTIAL_DIRECTORY_UNSAFE: ['Credential directory is unsafe', false],
  CREDENTIAL_DIRECTORY_UNAVAILABLE: ['Credential directory is unavailable', true],
} as const;

export class LocalCredentialDirectoryError extends Error {
  constructor(readonly code: LocalCredentialDirectoryErrorCode) {
    super(errors[code][0]);
    this.name = 'LocalCredentialDirectoryError';
  }

  get retryable(): boolean {
    return errors[this.code][1];
  }
}

export type LocalCredentialDirectoryOwner = Readonly<{
  tenantId: string;
  generation: number;
  childId: string;
}>;

export type LocalCredentialDirectoryHandle = Readonly<{
  use<T>(operation: (directory: string) => T | PromiseLike<T>): Promise<T>;
  reset(): Promise<void>;
  release(): Promise<void>;
}>;

export function createLocalWhatsAppCredentialDirectory(dependencies: { readonly root: unknown }) {
  const root = parseRoot(dependencies.root);
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_DIRECTORY_CONFIG');
  }

  // ponytail: Directory isolation only; add provider-owned credential I/O when Baileys is composed.
  return {
    async acquire(owner: unknown): Promise<LocalCredentialDirectoryHandle> {
      if (!isCredentialOwner(owner)) {
        if (isRecord(owner) && !isUuid(owner.tenantId)) {
          throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_TENANT_ID');
        }
        throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_OWNER');
      }
      await assertSafeAncestors(root);
      await ensureProtectedDirectory(root, uid);
      const directory = join(root, owner.tenantId);
      await ensureProtectedDirectory(directory, uid);
      const lockPath = join(root, `.${owner.tenantId}.owner.lock`);
      const lock = await acquireLock(lockPath);
      let lockIdentity: Readonly<{ dev: number; ino: number }>;
      try {
        lockIdentity = await assertProtectedLock(lock, uid);
      } catch (error) {
        await lock.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      return createHandle({ directory, lockPath, lock, lockIdentity, root, uid });
    },
  };
}

function createHandle(input: {
  readonly directory: string;
  readonly lockPath: string;
  readonly lock: FileHandle;
  readonly lockIdentity: Readonly<{ dev: number; ino: number }>;
  readonly root: string;
  readonly uid: number;
}): LocalCredentialDirectoryHandle {
  let lockClosed = false;
  let released = false;
  let resetStarted = false;
  let resetComplete = false;
  let transition = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = transition.then(operation, operation);
    transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function assertOwned(): Promise<void> {
    await assertLockOwned();
    await assertProtectedDirectory(input.directory, input.uid);
  }

  async function assertLockOwned(): Promise<void> {
    if (released || lockClosed) ownershipLost();
    await assertProtectedDirectory(input.root, input.uid);
    const held = await input.lock.stat().catch(() => ownershipLost());
    if (
      !held.isFile() ||
      held.dev !== input.lockIdentity.dev ||
      held.ino !== input.lockIdentity.ino ||
      held.uid !== input.uid ||
      (held.mode & 0o7777) !== 0o600 ||
      held.size !== 0
    ) {
      ownershipLost();
    }
    await assertOwnedPath();
  }

  async function assertOwnedPath(): Promise<void> {
    await assertProtectedDirectory(input.root, input.uid);
    const current = await safeLstat(input.lockPath).catch(() => ownershipLost());
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== input.lockIdentity.dev ||
      current.ino !== input.lockIdentity.ino ||
      current.uid !== input.uid ||
      (current.mode & 0o7777) !== 0o600 ||
      current.size !== 0
    ) {
      ownershipLost();
    }
  }

  return Object.freeze({
    use<T>(operation: (directory: string) => T | PromiseLike<T>): Promise<T> {
      return enqueue(async () => {
        if (resetStarted) ownershipLost();
        await assertOwned();
        return operation(input.directory);
      });
    },
    reset(): Promise<void> {
      return enqueue(async () => {
        if (resetComplete) return;
        if (!resetStarted) {
          await assertOwned();
          resetStarted = true;
        } else {
          await assertOwnedPath();
        }
        try {
          await rm(input.directory, { recursive: true, force: true });
          resetComplete = true;
        } catch {
          unavailable();
        }
      });
    },
    release(): Promise<void> {
      return enqueue(async () => {
        if (released) return;
        if (resetStarted && !resetComplete) unavailable();
        if (!lockClosed) {
          if (resetComplete) await assertLockOwned();
          else await assertOwned();
          try {
            await input.lock.close();
            lockClosed = true;
          } catch {
            unavailable();
          }
        }
        await assertOwnedPath();
        try {
          await unlink(input.lockPath);
          released = true;
        } catch {
          unavailable();
        }
      });
    },
  });
}

async function acquireLock(path: string): Promise<FileHandle> {
  try {
    return await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (fileCode(error) === 'EEXIST') {
      throw new LocalCredentialDirectoryError('CREDENTIAL_DIRECTORY_OWNED');
    }
    unavailable();
  }
}

async function assertProtectedLock(
  lock: FileHandle,
  uid: number,
): Promise<Readonly<{ dev: number; ino: number }>> {
  const metadata = await lock.stat().catch(() => unavailable());
  if (
    !metadata.isFile() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o7777) !== 0o600 ||
    metadata.size !== 0
  ) {
    unsafe();
  }
  return { dev: metadata.dev, ino: metadata.ino };
}

function parseRoot(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === parse(value).root
  ) {
    throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_DIRECTORY_CONFIG');
  }
  return value;
}

async function assertSafeAncestors(root: string): Promise<void> {
  const parent = dirname(root);
  const { root: filesystemRoot } = parse(parent);
  let current = filesystemRoot;
  for (const part of relative(filesystemRoot, parent).split(sep).filter(Boolean)) {
    current = join(current, part);
    const metadata = await safeLstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) unsafe();
  }
  const parentMetadata = await safeLstat(parent);
  if ((parentMetadata.mode & 0o022) !== 0) unsafe();
}

async function ensureProtectedDirectory(path: string, uid: number): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (fileCode(error) !== 'EEXIST') unavailable();
  }

  await assertProtectedDirectory(path, uid);
}

async function assertProtectedDirectory(path: string, uid: number): Promise<void> {
  const metadata = await safeLstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o7777) !== 0o700
  ) {
    unsafe();
  }

  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch {
    unavailable();
  }
  if (canonical !== path) unsafe();
}

async function safeLstat(path: string) {
  try {
    return await lstat(path);
  } catch {
    unavailable();
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

function isCredentialOwner(value: unknown): value is LocalCredentialDirectoryOwner {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === 'childId' &&
    keys[1] === 'generation' &&
    keys[2] === 'tenantId' &&
    isUuid(value.tenantId) &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) > 0 &&
    isIdentifier(value.childId)
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function unsafe(): never {
  throw new LocalCredentialDirectoryError('CREDENTIAL_DIRECTORY_UNSAFE');
}

function unavailable(): never {
  throw new LocalCredentialDirectoryError('CREDENTIAL_DIRECTORY_UNAVAILABLE');
}

function ownershipLost(): never {
  throw new LocalCredentialDirectoryError('CREDENTIAL_DIRECTORY_OWNERSHIP_LOST');
}
