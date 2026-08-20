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

**Status:** In progress

**Execution guardrail — bounded independent review:** For a slice that requires independent review, run one review attempt and at most one retry. If both attempts fail due to reviewer/provider/infrastructure unavailability and return no finding, record that gate as `PARTIALLY VERIFIED`; do not wait or retry further. Continue with the applicable canonical checks, CI, and normal merge gates. A concrete reviewer finding still blocks delivery until resolved and re-verified.

- [x] Versioned, runtime-validated IPC contract (Issue #11, PR #12)
- [x] Transport-neutral worker runtime lifecycle and bounded command timeouts (Issue #13, PR #14)
- [x] Generation/child fencing and stale-ack rejection (Issue #15, PR #16)
- [x] Safe worker diagnostics and correlation IDs (Issue #17, PR #20)
- [x] Worker dedupe collision fix and DB artifact boundary (Issue #22, PR #23)
- [x] Synthetic worker harness and safe debug snapshot (Issue #24, PR #27)
- [ ] Active-tenant boot and worker start/stop/update migration
- [ ] Restart, timeout, and stale-ack behavioral proof

## Later phases

Backend composition, workers, Telegram retirement, PostgreSQL persistence, automation, delivery/entitlements, identity/admin, billing, notification retirement, and eventual migration/cutover each require separate bounded Issues and acceptance evidence.

Deferred product features are not active implementation scope.
