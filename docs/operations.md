# Operations (As Built)

WARLIST 2.0 has no deployed runtime, service, environment, database, provider connection, or Production release process.

The only operational procedures are local/CI reconstruction and verification:

```bash
npm ci
npm run check
```

The legacy Production system is outside this repository's operational authority. No WARLIST 2.0 workflow may restart, deploy, call, or mutate it during the backend foundation.

## Disposable PostgreSQL 16 persistence proofs

The Phase 4 Slice 1 proof uses PostgreSQL 16 only through disposable local clusters created beneath `/tmp` by `test/unit/postgres-worker-lifecycle-state-repository.test.ts`. The test applies `migrations/0001-worker-lifecycle-states.sql`, uses only invented `tenant_example_*` identifiers, proves cross-connection expected-generation conditional writes, and runs a `pg_dump`/`pg_restore` drill into a fresh disposable cluster.

Run the proof only on a development machine with PostgreSQL 16 server and client tools installed:

```bash
node --import tsx --test test/unit/postgres-worker-lifecycle-state-repository.test.ts
node --import tsx --test test/unit/postgres-business-schema.test.ts
node --import tsx --test test/unit/in-memory-business-repository.test.ts test/unit/postgres-business-repository.test.ts
```

The lifecycle proof registers cleanup before opening database connections, waits for every client-close attempt, then attempts `pg_ctl --mode fast stop` and temporary-directory removal even after a client-close failure. The business-schema proof creates separate `/tmp/warlist-pg16-schema-*` clusters and verifies ordered revision application, checksum drift rejection, transaction rollback, concurrent-run serialization, safe adoption of the existing idempotent lifecycle migration, and tenant/config/delivery/audit constraints. If interrupted, inspect only the matching temporary prefix; stop its cluster with its local `postmaster.pid`, then remove that temporary directory. Rollback is limited to dropping the disposable test cluster and directory. No hosted database, environment file, credential, legacy/runtime/customer data, migration/cutover, or Production rollback procedure exists.

## Supabase Free-plan guardrails (checked 2026-08-21)

These are implementation/cutover guardrails, not a hosted-project configuration or a Production readiness claim. Recheck the official sources immediately before provisioning or cutover; quotas and plan behavior change.

- **Capacity and connections:** Free uses Nano compute (shared CPU, up to 0.5 GB memory; 500 MB recommended database size). The database-size guide says Free projects have 1 GB disk but enter read-only mode when database size exceeds 500 MB. Keep pool concurrency bounded, alert on connection errors/latency and database/disk growth, and treat the read-only state as unavailable for mutations. Sources: [compute](https://supabase.com/docs/guides/platform/compute-add-ons), [database size](https://supabase.com/docs/guides/platform/database-size).
- **Inactivity:** Supabase documents automatic Free-project pausing after low database activity over a 7-day window. Recovery must tolerate unavailable/readiness-false state; never invoke an external send unless a durable admission/claim succeeds. Source: [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
- **Backup, retention, restore:** Supabase documents automatic daily backups for Pro, Team, and Enterprise—not Free—and recommends Free projects regularly run off-site `supabase db dump` exports. Hosted restore/retention guarantees for Free are therefore not assumed here. A future runbook must define tested logical export, restore, retention, ownership, and a PostgreSQL-host exit before cutover. Source: [backups](https://supabase.com/docs/guides/platform/backups).
- **Monitoring and degradation:** retain safe application telemetry for database readiness, query failures/timeouts, pool pressure, and storage/capacity signals; never put provider, credential, customer, or raw payload values in telemetry. When the database/network is unavailable or read-only, fail closed for external-send admission and do not guess payment/entitlement/delivery state.
- **Exit:** migrations are portable PostgreSQL SQL and current proof runs on disposable PostgreSQL 16. This is compatibility evidence only: no Supabase project, credentials, hosted connection, backup, monitoring API, or failover behavior was used.

Phase 6 delivery/entitlement evidence is limited to synthetic/application/disposable PostgreSQL tests; see `docs/phase6-reconciliation.md`. It does not authorize a provider, hosted database, deployment, cutover, or Production operation.

Deployment readiness, migration/cutover, release, and Production rollback procedures remain unimplemented.
