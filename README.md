# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. This repository contains the completed Phase 0 foundation, Phase 1 application-composition foundation, Phase 2 synthetic worker-runtime foundation, Phase 3 synthetic persistence-contract foundation, and the in-progress Phase 4 Supabase schema and repository foundation.

**Status:** Phases 0–3 are complete. Phase 4 is **IN PROGRESS**; Issue #42 / PR #43 and Issue #44 / PR #45 prove only a disposable PostgreSQL 16 lifecycle-persistence subset. PR #47's Phase 4 closure status is superseded, while its factually accurate as-built documentation remains valid. Phase 5 is not authorized. No hosted Supabase target, Production behavior, legacy/runtime/customer-data access, credentials, deployment, cutover, worker/process/provider integration, or HTTP/API boundary has been configured or verified.

## Requirements

- Node.js `^20.19.0`, `^22.13.0`, or `>=24`; Node 22 is the primary development runtime.
- npm with the committed `package-lock.json`.

## Commands

```bash
npm ci
npm run check
npm run test:unit
npm run test:architecture
npm run build
```

`npm run check` runs format, lint, TypeScript, tests, build, and repository-boundary validation.

## Safety boundary

Only synthetic data is allowed in source, tests, docs, and CI. Runtime credentials, customer records, sessions, logs, database files, WhatsApp auth, QR data, and legacy Git history must never enter this repository.

The current Production checkout is separate and is not modified, restarted, or deployed by this repository.

See `AGENTS.md`, `docs/`, and `docs/decisions/` before changing the project.
