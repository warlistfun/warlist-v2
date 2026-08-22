import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from 'pg';

import {
  RepositoryError,
  createInMemoryBusinessRepository,
} from '../../src/app/business-repository';
import { createPostgresBusinessRepository } from '../../src/infrastructure/database/postgres-business-repository';
import { MutableTenantAuthorization } from '../support/business-repository-contract';
import { createDisposablePostgres } from '../support/disposable-postgres';
import { NoopLogger, NoopMetrics } from '../support/test-adapters';

const tenantId = '00000000-0000-4000-8000-000000000701';

void test('appends idempotent tenant ledger entries and derives the balance from ledger truth', async () => {
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createInMemoryBusinessRepository({ authorization });
  await repository.start();

  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_ledger' });
  const payment = {
    id: '00000000-0000-4000-8000-000000000702',
    tenantId,
    entryType: 'CREDIT_PAYMENT' as const,
    units: 3,
    businessKey: 'payment:example_1',
    correlationId: 'correlation_example_ledger_1',
  };
  const first = await repository.appendEntitlementLedgerEntry(payment);
  const replay = await repository.appendEntitlementLedgerEntry(payment);

  assert.equal(first.id, replay.id);
  assert.equal(Object.isFrozen(first), true);
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 3);

  await repository.appendEntitlementLedgerEntry({
    id: '00000000-0000-4000-8000-000000000703',
    tenantId,
    entryType: 'DEBIT_CONFIRMED_DELIVERY',
    units: -1,
    businessKey: 'delivery:example_1:2030-01-02',
    correlationId: 'correlation_example_ledger_2',
  });
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 2);

  await assert.rejects(
    repository.appendEntitlementLedgerEntry({
      ...payment,
      id: '00000000-0000-4000-8000-000000000704',
      units: 4,
    }),
    (error: unknown) =>
      error instanceof RepositoryError && error.code === 'ENTITLEMENT_BUSINESS_KEY_CONFLICT',
  );
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 2);
});

void test('PostgreSQL serializes concurrent ledger appends and derives a matching balance', async (t) => {
  const database = await createDisposablePostgres(t);
  const authorization = new MutableTenantAuthorization();
  authorization.allowed.add(tenantId);
  const repository = createPostgresBusinessRepository({
    config: database.config,
    authorization,
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  });
  await repository.start();
  t.after(() => repository.stop());
  await repository.createTenant({ id: tenantId, publicOpsId: 'ops_example_postgres_ledger' });

  const first = {
    id: '00000000-0000-4000-8000-000000000704',
    tenantId,
    entryType: 'CREDIT_COUPON' as const,
    units: 1,
    businessKey: 'coupon:example_1',
    correlationId: 'correlation_example_postgres_1',
  };
  const verificationClient = new Client(database.config);
  await verificationClient.connect();
  t.after(() => verificationClient.end());
  await verificationClient.query(`
    CREATE FUNCTION reject_entitlement_ledger_update() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger update forbidden'; END; $$;
    CREATE TRIGGER entitlement_ledger_append_only
      BEFORE UPDATE ON entitlement_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_entitlement_ledger_update();
  `);
  const [created, replayed] = await Promise.all([
    repository.appendEntitlementLedgerEntry(first),
    repository.appendEntitlementLedgerEntry(first),
  ]);
  assert.equal(created.id, replayed.id);
  await Promise.all(
    [2, 3, 4].map((number) =>
      repository.appendEntitlementLedgerEntry({
        id: `00000000-0000-4000-8000-00000000070${number + 3}`,
        tenantId,
        entryType: 'CREDIT_COUPON',
        units: number === 2 ? 1_000_000 : 1,
        businessKey: `coupon:example_${number}`,
        correlationId: `correlation_example_postgres_${number}`,
      }),
    ),
  );
  await assert.rejects(
    repository.appendEntitlementLedgerEntry({
      ...first,
      id: '00000000-0000-4000-8000-000000000709',
      units: 2,
    }),
    (error: unknown) =>
      error instanceof RepositoryError && error.code === 'ENTITLEMENT_BUSINESS_KEY_CONFLICT',
  );
  assert.equal((await repository.readEntitlementBalance(tenantId)).units, 1_000_003);
});
