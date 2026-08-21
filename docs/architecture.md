# Architecture (As Built)

WARLIST 2.0 has a resource-free application composition core, strict compiler configuration, and repository-boundary validation.

```text
test -> src/app/config.ts
     -> src/app/ports.ts
     -> src/app/create-application.ts
     -> src/app/create-http-app.ts
     -> src/app/bootstrap.ts
     -> src/interfaces/worker-ipc/contract.ts
     -> src/modules/whatsapp/application/worker-diagnostics-service.ts
     -> src/modules/whatsapp/application/worker-runtime-service.ts
     -> src/modules/whatsapp/application/worker-ownership-service.ts
     -> src/shared/version.ts
     -> scripts/check-repository-boundary.mjs
```

`createApplication()` accepts explicit configuration and ordered lifecycle dependencies. Startup occurs in registration order, failed startup rolls back already-started dependencies, and shutdown occurs in reverse order. Repeated start/stop calls are idempotent. Tests supply deterministic no-op/in-memory implementations for logger, metrics, clock, ID generation, repository, and worker-runtime boundaries.

There is no HTTP server, worker process, WhatsApp connection, provider adapter, timer, listener, or deployment artifact. Concrete database behavior is limited to PostgreSQL 16 lifecycle and pooled business repositories plus a versioned migrator, all exercised against temporary synthetic local clusters; no hosted database is configured or contacted. Future modules follow the modular-monolith and ports/adapters decisions in the ADRs and migration plan, but they are not as-built behavior.

Worker IPC protocol v1 is a resource-free contract boundary. Parent commands and child acknowledgements/errors carry request, correlation, tenant, generation, and child identities. Decoders accept exact runtime-validated schemas, return immutable values, reject unsupported versions or unknown message types with stable errors, and restrict child errors to canonical safe code/message/retryability combinations. The contract does not yet fork a worker, schedule a timeout, or implement runtime lifecycle orchestration.

`WorkerDiagnosticsService` is an application-level boundary over an injected sink. It emits immutable, discriminated command and ownership events with whitelisted fields only: bounded correlation/tenant/generation/child identity plus closed command outcomes or ownership state/quarantine status. Malformed values, extra properties, raw errors, IPC/config payloads, and internal state are not forwarded. Sink failures are best-effort and cannot change command or ownership behavior. No concrete logger, metrics adapter, process integration, or other sink is composed yet.

`WorkerRuntimeService` is a transport-neutral command lifecycle over IPC v1. It serializes commands per tenant, deduplicates identical pending requests, requires matching decoded ACK/error identity, and fails closed through an injected bounded-timeout scheduler. Matching acknowledgements, canonical child errors, timeouts, transport unavailability, and runtime shutdown produce safe terminal command diagnostics from the pending parent identity without forwarding raw errors or payloads. Its frozen debug snapshot exposes only pending command type, correlation, tenant, generation, and child identity; request IDs and configuration payloads remain private. Deterministic tests use the existing manual transport and scheduler as a synthetic harness for START, APPLY_CONFIG, STOP, delimiter-safe deduplication, cross-tenant timeout/unavailability isolation, stale-identity rejection, and timeout retry: a late ACK/error from an expired request cannot settle a retry with a new request identity. Startup and shutdown own the abstract transport lifecycle; shutdown rejects pending commands before stopping the transport. The service remains resource-free until future concrete child-process, scheduler, and diagnostics adapters are composed.

`WorkerOwnershipService` is a resource-free per-tenant ownership state machine layered over that command boundary. It allocates monotonically increasing generations, binds ownership to an opaque child identity, and accepts terminal child-exit evidence only when both match the current owner. It emits safe correlated `STARTING`, `RUNNING`, `STOPPING`, and `STOPPED` projections, including quarantine status, for accepted ownership operations and exact terminal evidence. A config update is forwarded only for a confirmed non-quarantined `RUNNING` owner, with its current generation and child identity; update failure preserves that confirmed ownership. Deterministic restart proof confirms that terminal evidence from a prior generation/child cannot alter a pending newer incarnation. Any failed start is quarantined in `STOPPING` and receives a compensating stop; ownership becomes startable again only after matching stop acknowledgement or child-exit evidence. This service neither starts a process nor consumes concrete process events.

`ActiveTenantWorkerService` is a resource-free coordinator over injected selected tenant descriptors and the ownership lifecycle boundary. It boots supplied descriptors sequentially in input order, fails at the first delegated error without invented rollback, and delegates config update and stop intents. It neither discovers active tenants nor reads persistence/configuration, creates child identities, registers application lifecycle work, or provides legacy migration/cutover behavior.

`WorkerLifecycleStateRepositoryPort` is a lifecycle persistence boundary over immutable tenant-keyed snapshots. The disposable in-memory adapter proves deterministic single-process behavior: copied frozen snapshots, prior-snapshot preservation on delegated save failure, lower-generation rejection, and expected-generation `compareAndSave()`. The concrete PostgreSQL 16 adapter accepts injected server-owned tenant authorization, validates snapshots and database rows at its trust boundaries, parameterizes SQL, fences lower and expected-generation writes across independent connections, and returns immutable recovered snapshots. Its forward-only idempotent migration and backup/restore proof run only against test-created temporary local clusters. It does not configure a hosted database, survive a real deployment restart, implement general transactional rollback, or establish Production readiness.

`runPostgresMigrations()` receives one explicit ordered migration list and dedicated query client. It validates descriptors before I/O, serializes concurrent runners with a transaction-scoped PostgreSQL advisory lock, records revision/name/SHA-256 evidence in `schema_migrations`, rejects applied checksum drift, and rolls back the batch when a revision fails. Migration `0002-business-foundation.sql` establishes UUID tenant identity separate from public OPS identifiers, versioned automation configuration, deterministic `PREPARED` delivery-operation identity, and bounded audit metadata with database-enforced ownership, idempotency, revision, and timestamp constraints.

`BusinessRepositoryPort` exposes separate tenant, versioned opaque-config, deterministic `PREPARED` delivery, and bounded audit operations rather than a mutable tenant aggregate. Its in-memory and pooled PostgreSQL adapters share one behavioral contract, require injected tenant authorization, validate inputs and PostgreSQL rows, and return detached frozen records. The PostgreSQL adapter owns an explicitly configured bounded pool with safe timeout/unavailability errors, readiness, cleanup retry, and fixed-name telemetry; it reads no environment or hosted key. Delivery claims/attempts, provider sends, hosted Supabase composition, and WhatsApp credential storage remain unimplemented.

`createHttpApp()` is an in-process adapter with versioned health/readiness routes, runtime request validation, generated request IDs, and canonical response envelopes. It does not bind a port or own network lifecycle.

`createBootstrap()` explicitly owns application startup and shutdown-signal registration through a port. It serializes transitions, unregisters handlers before shutdown, rolls back partial registration, and retains failed cleanup for retry. No `process` listener is registered at import time.

Imports must remain side-effect-free. Protected runtime/customer paths are prohibited from Git by an executable tracked-path check.

The legacy Production entrypoint does not delegate to this composition. ADR 0008 defers that integration until concrete adapter parity and an approved migration/cutover slice exist.
