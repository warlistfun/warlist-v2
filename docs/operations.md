# Operations (As Built)

WARLIST 2.0 has no deployed runtime, service, environment, database, provider connection, or Production release process.

The only operational procedures are local/CI reconstruction and verification:

```bash
npm ci
npm run check
```

The legacy Production system is outside this repository's operational authority. No WARLIST 2.0 workflow may restart, deploy, call, or mutate it during the backend foundation.

## Disposable PostgreSQL 16 persistence proof

The Phase 4 Slice 1 proof uses PostgreSQL 16 only through disposable local clusters created beneath `/tmp` by `test/unit/postgres-worker-lifecycle-state-repository.test.ts`. The test applies `migrations/0001-worker-lifecycle-states.sql`, uses only invented `tenant_example_*` identifiers, proves cross-connection expected-generation conditional writes, and runs a `pg_dump`/`pg_restore` drill into a fresh disposable cluster.

Run the proof only on a development machine with PostgreSQL 16 server and client tools installed:

```bash
node --import tsx --test test/unit/postgres-worker-lifecycle-state-repository.test.ts
```

The test registers cleanup before opening database connections, stops each cluster with `pg_ctl --mode fast stop`, and removes its temporary directory. If interrupted, inspect only `/tmp/warlist-pg16-*`; stop its matching cluster with its local `postmaster.pid`, then remove that temporary directory. Rollback is limited to dropping the disposable test cluster and directory. No hosted database, environment file, credential, legacy/runtime/customer data, migration/cutover, or Production rollback procedure exists.

Release, readiness, migration/cutover, and Production rollback procedures remain unimplemented.
