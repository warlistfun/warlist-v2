# WARLIST 2.0 Roadmap

Detailed work and evidence live in GitHub Issues and Pull Requests. This file tracks only current phase status.

## Phase 0 — Foundation

**Status:** In progress

- [x] Private `warlistfun/warlist-v2` repository with new history
- [x] Isolated local workspace
- [x] Strict TypeScript/CommonJS toolchain
- [x] Formatter, lint, typecheck, node:test, build, and repository-boundary checks
- [x] Synthetic-only CI definition with no deployment capability
- [x] Current-state README, repository rules, and ADRs 0001–0007
- [x] Default-deny legacy migration manifest
- [ ] Initial commit and remote CI verified
- [ ] Main branch rules configured against observed CI check names
- [ ] Clean remote clone runs `npm ci && npm run check`
- [ ] Phase 0 evidence accepted in Issue #1

## Later phases

Backend composition, workers, Telegram retirement, PostgreSQL persistence, automation, delivery/entitlements, identity/admin, billing, notification retirement, and eventual migration/cutover each require separate bounded Issues and acceptance evidence.

Deferred product features are not active implementation scope.
