import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialPortError,
  createDisabledCredentialPort,
} from '../../src/modules/identity/application/credential-port';
import { deriveTenantAccess } from '../../src/modules/identity/application/authenticated-principal';

const userId = '00000000-0000-4000-8000-000000000901';
const tenantId = '00000000-0000-4000-8000-000000000902';

void test('disabled credential port rejects PIN and passkey operations before any credential handler exists', async () => {
  const port = createDisabledCredentialPort();

  for (const attempt of [
    () => port.enrollPin({ userId, tenantId }),
    () => port.verifyPin({ userId, tenantId }),
    () => port.enrollPasskey({ userId, tenantId }),
    () => port.verifyPasskey({ userId, tenantId }),
  ]) {
    await assert.rejects(
      attempt(),
      (error: unknown) =>
        error instanceof CredentialPortError && error.code === 'CREDENTIAL_ROLLOUT_DISABLED',
    );
  }
});

void test('disabled credential port does not make public OPS ID or client tenant selection authority', async () => {
  const port = createDisabledCredentialPort();

  await assert.rejects(
    port.verifyPin({ publicOpsId: 'ops_example_not_authority', tenantId }),
    (error: unknown) =>
      error instanceof CredentialPortError && error.code === 'CREDENTIAL_ROLLOUT_DISABLED',
  );
  assert.throws(
    () => deriveTenantAccess({ tenantId }, tenantId),
    /Invalid authenticated principal/,
  );
});
