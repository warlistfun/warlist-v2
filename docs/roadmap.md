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

**Status:** In progress

- [x] Runtime-validated application configuration
- [x] Foundational logger, metrics, clock, ID, repository, and worker-runtime ports
- [x] Resource-free `createApplication()` with tested startup, rollback, and shutdown ordering
- [x] Deterministic no-op/in-memory test adapters
- [ ] HTTP application adapter
- [ ] Central bootstrap and shutdown signal boundary
- [ ] Legacy entrypoint delegation evidence

## Later phases

Backend composition, workers, Telegram retirement, PostgreSQL persistence, automation, delivery/entitlements, identity/admin, billing, notification retirement, and eventual migration/cutover each require separate bounded Issues and acceptance evidence.

Deferred product features are not active implementation scope.
