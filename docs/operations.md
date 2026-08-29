# Operations (As Built)

WARLIST 2.0 has no deployed runtime, service, environment, hosted database, active provider connection, or Production release process. OM-15 adds an import-safe runnable composition and native HTTP adapter that binds only to `127.0.0.1`, delegates versioned API behavior to the existing in-process adapter, and serves the built Web from an explicit canonical root. Repository and worker boundaries remain explicitly injected; no environment reader, hosted configuration, active-tenant boot, real account/provider, credential, customer-data, public listener, deployment, or Production behavior is established.

The OM-03 pairing proof is local-only: a `synthetic_…` target reaches the existing child, the child discards the provider return value, and diagnostics expose only `REQUESTED`, `CODE_READY`, `OPEN`, `CLOSED`, `FAILED`, or `STOPPED` with bounded worker identity. QR/pairing material, credentials, JIDs, and raw provider updates never enter the projection.

The OM-04/OM-05 credential proof is local-only: temporary synthetic roots use `0700` directories and a `0600` empty per-tenant lock; one tenant/generation/child capability gates socket creation, lazy key-store access, credential saves, explicit reset, and awaited release. Reconnect, logout, stop, pairing, and status-like activity do not delete auth state. Only exact-owner `RESET_WORKER` recursively deletes that synthetic tenant directory, and cleanup uncertainty retains the lock. The adapter never reads, copies, backs up, or exposes credential payloads.

The only operational procedures are local/CI reconstruction and verification:

```bash
npm ci
npm run check
node --import tsx --test test/unit/baileys-worker-child.test.ts
node --import tsx --test test/unit/baileys-inbound-event.test.ts
node --import tsx --test test/unit/baileys-pairing-request.test.ts
node --import tsx --test test/unit/local-whatsapp-credential-ownership.test.ts
node --import tsx --test test/integration/om-06-baileys-delivery-authority.test.ts
```

The legacy Production system is outside this repository's operational authority. No WARLIST 2.0 workflow may restart, deploy, call, or mutate it during the backend foundation.

## Disposable PostgreSQL 16 persistence proofs

The lifecycle proof uses PostgreSQL 16 only through disposable local clusters created beneath `/tmp` by `test/unit/postgres-worker-lifecycle-state-repository.test.ts`. It applies the historical lifecycle/business/claim schema and forward migration `0010-worker-lifecycle-revision.sql`, uses only invented identifiers, proves revision-`1` backfill with no lasting database default, rejects an invalid initial revision, proves one winner for conflicting exact-prior-snapshot transitions, rejects generation regression and same-generation ABA across independent connections, and retains the historical `pg_dump`/`pg_restore` drill in fresh disposable clusters.

Run the proof only on a development machine with PostgreSQL 16 server and client tools installed:

```bash
node --import tsx --test test/unit/postgres-worker-lifecycle-state-repository.test.ts
node --import tsx --test test/unit/postgres-business-schema.test.ts
node --import tsx --test test/unit/in-memory-business-repository.test.ts test/unit/postgres-business-repository.test.ts
```

The lifecycle proof registers cleanup before opening database connections, waits for every client-close attempt, then attempts `pg_ctl --mode fast stop` and temporary-directory removal even after a client-close failure. Shared disposable PostgreSQL fixtures apply ordered migrations through `0010`; the business-schema proof separately verifies migrator ordering, checksum drift rejection, transaction rollback, concurrent-run serialization, safe adoption of the historical lifecycle migration, and tenant/config/delivery/audit constraints. If interrupted, inspect only the matching temporary prefix; stop its cluster with its local `postmaster.pid`, then remove that temporary directory. Rollback is limited to dropping the disposable test cluster and directory. No hosted database, environment file, credential, legacy/runtime/customer data, migration/cutover, or Production rollback procedure exists.

## BF-01 ownership-admission race proof

The delivery/entitlement integration test uses only invented records and disposable PostgreSQL connections. It locks one delivery operation, starts an ownership-loss transaction on a second connection, exercises the real pooled send-admission or confirmation repository path, and verifies the backend lock wait through `pg_stat_activity` before releasing either side. If ownership loss commits first, send admission returns a claim conflict without invoking the injected sender; confirmation leaves the operation `SENT` and the entitlement balance unchanged.

```bash
node --import tsx --test --test-name-pattern='ownership loss.*prevents' test/integration/delivery-entitlement-integrity.test.ts
```

This proves only the database serialization boundary exercised by the disposable fixture. It does not contact or prove a provider, hosted database, customer/runtime data, dev/staging, deployment, cutover, or Production behavior.

## Supabase Free-plan guardrails (checked 2026-08-21)

These are implementation/cutover guardrails, not a hosted-project configuration or a Production readiness claim. Recheck the official sources immediately before provisioning or cutover; quotas and plan behavior change.

- **Capacity and connections:** Free uses Nano compute (shared CPU, up to 0.5 GB memory; 500 MB recommended database size). The database-size guide says Free projects have 1 GB disk but enter read-only mode when database size exceeds 500 MB. Keep pool concurrency bounded, alert on connection errors/latency and database/disk growth, and treat the read-only state as unavailable for mutations. Sources: [compute](https://supabase.com/docs/guides/platform/compute-add-ons), [database size](https://supabase.com/docs/guides/platform/database-size).
- **Inactivity:** Supabase documents automatic Free-project pausing after low database activity over a 7-day window. Recovery must tolerate unavailable/readiness-false state; never invoke an external send unless a durable admission/claim succeeds. Source: [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
- **Backup, retention, restore:** Supabase documents automatic daily backups for Pro, Team, and Enterprise—not Free—and recommends Free projects regularly run off-site `supabase db dump` exports. Hosted restore/retention guarantees for Free are therefore not assumed here. A future runbook must define tested logical export, restore, retention, ownership, and a PostgreSQL-host exit before cutover. Source: [backups](https://supabase.com/docs/guides/platform/backups).
- **Monitoring and degradation:** retain safe application telemetry for database readiness, query failures/timeouts, pool pressure, and storage/capacity signals; never put provider, credential, customer, or raw payload values in telemetry. When the database/network is unavailable or read-only, fail closed for external-send admission and do not guess payment/entitlement/delivery state.
- **Exit:** migrations are portable PostgreSQL SQL and current proof runs on disposable PostgreSQL 16. This is compatibility evidence only: no Supabase project, credentials, hosted connection, backup, monitoring API, or failover behavior was used.

Phase 6 delivery/entitlement evidence is limited to synthetic/application/disposable PostgreSQL tests. `docs/phase6-reconciliation.md` is historical evidence; the current interpretation is in `docs/backend-foundation-as-built-audit.md`. Neither authorizes a provider, hosted database, deployment, cutover, or Production operation.

Deployment readiness, migration/cutover, release, and Production rollback procedures remain unimplemented.
