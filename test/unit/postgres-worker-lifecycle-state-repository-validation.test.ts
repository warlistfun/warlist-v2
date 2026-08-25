import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostgresWorkerLifecycleStateRepository,
  type TenantAuthorizationPort,
} from '../../src/modules/whatsapp/infrastructure/postgres-worker-lifecycle-state-repository';

const authorization: TenantAuthorizationPort = {
  assertAuthorized(): void {},
};
const tenantId = '00000000-0000-4000-8000-000000000901';

void test('rejects malformed lifecycle rows before returning them to application code', async () => {
  const repository = createPostgresWorkerLifecycleStateRepository({
    authorization,
    client: {
      query: () =>
        Promise.resolve({
          rowCount: 1,
          rows: [
            {
              tenant_id: tenantId,
              state: 'NOT_A_STATE',
              generation: 1,
              child_id: null,
              quarantined: false,
              revision: '1',
            },
          ],
        }),
    },
  });

  await assert.rejects(repository.load(tenantId), /invalid lifecycle state row/);
});

void test('returns a frozen lifecycle snapshot detached from the database row', async () => {
  const row = {
    tenant_id: tenantId,
    state: 'RUNNING',
    generation: 1,
    child_id: 'child_example_1',
    quarantined: false,
    revision: '1',
  };
  const repository = createPostgresWorkerLifecycleStateRepository({
    authorization,
    client: { query: () => Promise.resolve({ rowCount: 1, rows: [row] }) },
  });

  const snapshot = await repository.load(tenantId);
  row.state = 'STOPPED';

  assert.equal(snapshot?.state, 'RUNNING');
  assert.equal(Object.isFrozen(snapshot), true);
});

void test('rejects an oversized child identity before querying PostgreSQL', async () => {
  let queries = 0;
  const repository = createPostgresWorkerLifecycleStateRepository({
    authorization,
    client: {
      query: () => {
        queries += 1;
        return Promise.resolve({ rowCount: 1, rows: [] });
      },
    },
  });

  await assert.rejects(
    repository.save({
      tenantId,
      state: 'RUNNING',
      generation: 1,
      childId: 'a'.repeat(161),
      quarantined: false,
      revision: 1,
    }),
    /invalid lifecycle snapshot/,
  );
  assert.equal(queries, 0);
});
