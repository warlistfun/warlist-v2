# WARLIST 2.0 Roadmap

Detailed work and evidence live in GitHub Issues and Pull Requests. This file tracks only current phase status.

## Phase 0 — Foundation

**Status:** Complete (2026-08-18)

- [x] Private `warlistfun/warlist-v2` repository with new history
- [x] Isolated local workspace
- [x] Strict TypeScript/CommonJS toolchain
- [x] Formatter, lint, typecheck, node:test, build, and repository-boundary checks
- [x] Synthetic-only CI definition with no deployment capability
- [x] Current-state README, repository rules, and ADRs 0001–0007
- [x] Default-deny legacy migration manifest
- [x] Initial commit and remote CI verified
- [x] Main branch policy decided: repository remains private; the owner accepted temporary GitHub Free branch-protection risk
- [x] Clean remote clone runs `npm ci && npm run check`
- [x] Phase 0 evidence accepted in Issue #1

GitHub Free does not enforce branch protection on this private repository. Until the account is upgraded, changes use bounded Issues and pull requests, green `CI / quality` and `CI / security` checks, squash-only merges, and explicit owner review. This accepted residual risk does not waive CI or review requirements and must be revisited before adding deployment capability or Production credentials.

## Phase 1 — TypeScript composition root and ports

**Status:** Complete (2026-08-18)

- [x] Runtime-validated application configuration
- [x] Foundational logger, metrics, clock, ID, repository, and worker-runtime ports
- [x] Resource-free `createApplication()` with tested startup, rollback, and shutdown ordering
- [x] Deterministic no-op/in-memory test adapters
- [x] Resource-free HTTP application adapter with health/readiness contracts
- [x] Central resource-free bootstrap and shutdown signal boundary
- [x] Legacy entrypoint delegation explicitly deferred by ADR 0008 until concrete adapter parity and approved migration/cutover

## Phase 2 — Worker runtime extraction and diagnostics

**Status:** Complete (2026-08-20)

**Execution guardrail — bounded independent review:** For a slice that requires independent review, run one review attempt and at most one retry. If both attempts fail due to reviewer/provider/infrastructure unavailability and return no finding, record that gate as `PARTIALLY VERIFIED`; do not wait or retry further. Continue with the applicable canonical checks, CI, and normal merge gates. A concrete reviewer finding still blocks delivery until resolved and re-verified.

- [x] Versioned, runtime-validated IPC contract (Issue #11, PR #12)
- [x] Transport-neutral worker runtime lifecycle and bounded command timeouts (Issue #13, PR #14)
- [x] Generation/child fencing and stale-ack rejection (Issue #15, PR #16)
- [x] Safe worker diagnostics and correlation IDs (Issue #17, PR #20)
- [x] Worker dedupe collision fix and DB artifact boundary (Issue #22, PR #23)
- [x] Synthetic worker harness and safe debug snapshot (Issue #24, PR #27)
- [x] Active-tenant boot and worker start/stop/update synthetic orchestration (Issue #28, PR #29; legacy migration remains deferred)
- [x] Restart, timeout, and stale-ack behavioral proof (Issue #30, PR #31)

Phase 2 is complete: all defined worker-runtime slices are merged with synthetic acceptance evidence. The owner accepted the residual risk that this remains resource-free proof only; concrete worker-process, persistence, provider, legacy migration/cutover, deployment, and Production behavior are not implemented or verified.

## Phase 3 — Synthetic persistence-contract foundation

**Status:** Complete (2026-08-20)

- [x] Disposable lifecycle-state composition boundary with tenant isolation, recovery, and failed-save preservation (Issue #34, PR #35)
- [x] Same-tenant stale lower-generation write fencing (Issue #36, PR #37)
- [x] Expected-generation compare-and-save contract (Issue #38, PR #39)

Phase 3 is complete: the owner selected the synthetic persistence-contract foundation as its closure target. The accepted residual risk is that the in-memory proof does not establish database atomicity across connections/processes, durable restart recovery, tenant authorization, trust-boundary validation, transactional rollback, migration/cutover, deployment, or Production readiness.

## Phase 4 — Supabase schema and repository foundation

**Status:** In progress — disposable PostgreSQL schema/repository subset verified (2026-08-21)

- [x] Disposable PostgreSQL 16 lifecycle-state repository behind the existing application port, with injected server-owned tenant authorization and trust-boundary validation (Issue #42, PR #43)
- [x] Forward-only idempotent lifecycle-state migration; lower-generation and cross-connection expected-generation write fencing; disposable migration and backup/restore proof (Issue #42, PR #43)
- [x] Disposable teardown hardening: client-close failures do not prevent fast cluster stop and temporary-directory removal (Issue #44, PR #45)
- [x] Versioned transactional migrator and canonical tenant/config/delivery/audit schema foundation with synthetic PostgreSQL rerun, checksum-drift, rollback, concurrency, ownership, idempotency, and bounded-column evidence (Issue #50)
- [x] Tenant/config/`PREPARED`-delivery/audit repository contract with matching in-memory and disposable PostgreSQL adapters (Issue #52)
- [x] Explicit bounded PostgreSQL pool configuration, timeout/error mapping, readiness, cleanup retry, and safe telemetry (Issue #52)
- [x] Separate local protected WhatsApp credential-directory adapter with owner-only tenant isolation and unsafe-path rejection; no credential payload I/O or provider composition (Issue #54)
- [ ] Database-outage fail-closed behavior for unclaimed external sends; verified Supabase Free-plan capacity guardrails

The verified PostgreSQL and local credential-directory work is a synthetic foundation subset, not Phase 4 closure. Phase 4 remains open until its master-plan objective and acceptance evidence are met: canonical transactional business storage, WhatsApp credentials remaining local, repository contracts against a test Postgres/Supabase-compatible environment, migrations safely rerunnable on synthetic databases, and database outage behavior that prevents unclaimed external sends. No hosted Supabase configuration, Production operation, deployment, legacy/runtime/customer-data access, credential access, worker/provider composition, data migration, or cutover has been authorized or verified.

PR #47's Phase 4 closure status is superseded by this correction. Its factually accurate as-built documentation remains valid, and Issue #42 / PR #43 plus Issue #44 / PR #45 remain verified subset evidence. Phase 5 is not authorized.

## Later phases

Backend composition, workers, Telegram retirement, automation, delivery/entitlements, identity/admin, billing, notification retirement, and eventual migration/cutover each require separate bounded Issues and acceptance evidence.

Deferred product features are not active implementation scope.
