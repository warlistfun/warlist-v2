import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostgresWorkerLifecycleStateRepository,
  type TenantAuthorizationPort,
} from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';

const authorization: TenantAuthorizationPort = {
  assertAuthorized(): void {},
};

void test('rejects malformed lifecycle rows before returning them to application code', async () => {
  const repository = createPostgresWorkerLifecycleStateRepository({
    authorization,
    client: {
      query: () =>
        Promise.resolve({
          rowCount: 1,
          rows: [
            {
              tenant_id: 'tenant_example_1',
              state: 'NOT_A_STATE',
              generation: 1,
              child_id: null,
              quarantined: false,
            },
          ],
        }),
    },
  });

  await assert.rejects(repository.load('tenant_example_1'), /invalid lifecycle state row/);
});

void test('returns a frozen lifecycle snapshot detached from the database row', async () => {
  const row = {
    tenant_id: 'tenant_example_1',
    state: 'RUNNING',
    generation: 1,
    child_id: 'child_example_1',
    quarantined: false,
  };
  const repository = createPostgresWorkerLifecycleStateRepository({
    authorization,
    client: { query: () => Promise.resolve({ rowCount: 1, rows: [row] }) },
  });

  const snapshot = await repository.load('tenant_example_1');
  row.state = 'STOPPED';

  assert.equal(snapshot?.state, 'RUNNING');
  assert.equal(Object.isFrozen(snapshot), true);
});
