import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export type LocalCredentialDirectoryErrorCode =
  | 'INVALID_CREDENTIAL_DIRECTORY_CONFIG'
  | 'INVALID_CREDENTIAL_TENANT_ID'
  | 'CREDENTIAL_DIRECTORY_UNSAFE'
  | 'CREDENTIAL_DIRECTORY_UNAVAILABLE';

const errors = {
  INVALID_CREDENTIAL_DIRECTORY_CONFIG: ['Invalid credential directory configuration', false],
  INVALID_CREDENTIAL_TENANT_ID: ['Invalid credential tenant identity', false],
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

export type LocalCredentialDirectoryHandle = Readonly<{ directory: string }>;

export function createLocalWhatsAppCredentialDirectory(dependencies: { readonly root: unknown }) {
  const root = parseRoot(dependencies.root);
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_DIRECTORY_CONFIG');
  }

  // ponytail: Directory isolation only; add provider-owned credential I/O when Baileys is composed.
  return {
    async prepare(tenantId: string): Promise<LocalCredentialDirectoryHandle> {
      if (!isUuid(tenantId)) {
        throw new LocalCredentialDirectoryError('INVALID_CREDENTIAL_TENANT_ID');
      }
      await assertSafeAncestors(root);
      await ensureProtectedDirectory(root, uid);
      const directory = join(root, tenantId);
      await ensureProtectedDirectory(directory, uid);
      return Object.freeze({ directory });
    },
  };
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
