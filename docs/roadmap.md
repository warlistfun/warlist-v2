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

**Status:** Complete (2026-08-21); Phase 5 is authorized for one bounded automation/configuration Issue.

| Master-plan task / acceptance                                           | Evidence                                                                                                                                                       | Status   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PostgreSQL migrations; migration table/revisions; safe synthetic reruns | Issues #42/#50; PRs #43/#51; disposable PostgreSQL 16 tests prove ordered application, rerun, checksum drift rejection, rollback, and concurrent serialization | VERIFIED |
| Repository contracts and in-memory/PostgreSQL adapters                  | Issue #52 / PR #53; shared tenant/config/`PREPARED`-delivery/audit contract against in-memory and disposable PostgreSQL                                        | VERIFIED |
| Pooling, timeout/error mapping, readiness, and telemetry                | Issue #52 / PR #53; bounded pool, safe errors, readiness, cleanup retry, and fixed-name telemetry tests                                                        | VERIFIED |
| Local WhatsApp credential boundary                                      | Issue #54 / PR #55; owner-only local credential-directory adapter, path hardening, no credential-payload I/O                                                   | VERIFIED |
| Database outage prevents unclaimed external sends                       | Issue #56 / this PR; `DatabaseSendAdmission` RED→GREEN proof rejects unavailable/failed readiness before injected sender invocation                            | VERIFIED |
| Supabase-compatible / Free-plan evidence                                | Issue #56 / this PR; portable PostgreSQL 16 migrations/repository contract; dated official Free-plan guardrails in `docs/operations.md`                        | VERIFIED |

Phase 4 delivers a **non-Production foundation** only: portable PostgreSQL/Supabase-compatible SQL and disposable local PostgreSQL proof, not a hosted Supabase project, credentials, hosted runtime, provider send, delivery claim/attempt/lease semantics, migration/cutover, backup/restore drill for hosted data, deployment, or Production readiness. WhatsApp credential payloads remain local and unimplemented in database storage.

PR #47's former Phase 4 closure claim remains superseded; its factually accurate as-built documentation and Issues #42/#44/#50/#52/#54 remain preserved verified evidence. The Phase 4 master-plan objective and all four acceptance rows are now reconciled above. Phase 5 implementation is authorized; it is not started by this closure.

## Phase 5 — Automation evaluator and field-scoped configuration

**Status:** Complete (2026-08-21); Phase 6 is authorized.

- [x] Pure synthetic inbound normalization and full closed evaluator decision set (Issues #58/#60/#67/#79)
- [x] Field-scoped/versioned configuration mutation with stale-write conflict behavior (Issue #62 / PR #63; Issue #79)
- [x] Tenant-scoped current group/admin membership validation before persistence (Issue #79)
- [x] Atomic exact-revision config synchronization outbox and fenced recovery (Issue #76 / PR #78)
- [x] Exact committed revision propagation through existing ownership/runtime/IPC `APPLY_CONFIG` boundary (Issue #79)
- [x] Safe `debug:automation` simulator for synthetic message, policy, time, and decision state (Issue #64 / PR #65; Issue #79)
- [x] Active V2 decision slice loads canonical config and stops before external send (Issues #68/#79)
- [x] Master-plan evidence matrix reconciled in [Phase 5 authority reconciliation](phase5-reconciliation.md)

Phase 5 closes a non-Production application foundation. It does not claim provider payload decoding, concrete OS child-process launch, Baileys/provider send, delivery claim/send semantics, entitlement debit, hosted Supabase, deployment, migration/cutover, or Production readiness. Those boundaries remain assigned to later phases, beginning with Phase 6 delivery and entitlement integrity.

## Phase 6 — Delivery and entitlement integrity

**Status:** Complete (2026-08-22); Phase 7 is authorized for one bounded identity/tenant Issue.

- [x] Tenant-owned delivery operations/attempts with PostgreSQL uniqueness constraints (Issue #81 / PR #82)
- [x] Database-authoritative owner/fence/lease claim CAS and stale-worker fencing (Issue #83 / PR #84)
- [x] Claim-gated synthetic sender with durable `SENT`/`AMBIGUOUS` outcomes and no blind retry (Issue #85 / PR #86)
- [x] Append-only entitlement ledger and ledger-derived balance projection (Issue #87 / PR #88)
- [x] Atomic confirmation and once-per-WIB-date replay-safe debit (Issue #89 / PR #90)
- [x] Adversarial PostgreSQL authority matrix and master-plan reconciliation ([Phase 6 reconciliation](phase6-reconciliation.md))

Phase 6 is complete only for synthetic/application/disposable PostgreSQL behavior. It does not establish real WhatsApp/provider delivery, provider credentials, hosted Supabase, deployment, cutover, or Production readiness.

## Phase 7 — Identity/tenant foundation (PIN deferred but enabled)

**Status:** In progress (2026-08-22)

- [x] Atomic synthetic/disposable-PostgreSQL enrollment foundation: one purpose-bound, expiring, single-use grant allocates one tenant and sole owner membership (Issue #93; PR pending)
- [ ] User/session/token-family schema and authenticated-principal tenant derivation
- [ ] Cross-tenant authorization matrix and legacy OPS migration tooling
- [ ] Disabled PIN/passkey credential ports

This first slice does **not** close Phase 7. PIN/passkey user-facing rollout, credential payloads, sessions/token families, HTTP authentication, hosted Supabase, legacy migration, deployment, and Production behavior remain out of scope.

## Later phases

Backend composition, workers, Telegram retirement, automation, delivery/entitlements, admin, billing, notification retirement, and eventual migration/cutover each require separate bounded Issues and acceptance evidence.

Deferred product features are not active implementation scope.
