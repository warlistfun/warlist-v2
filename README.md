# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. This repository contains the completed Phase 0 foundation, Phase 1 application-composition foundation, Phase 2 synthetic worker-runtime foundation, Phase 3 synthetic persistence-contract foundation, and Phase 4 disposable PostgreSQL lifecycle-persistence foundation.

**Status:** Phases 0–4 are complete. Phase 4 provides a concrete PostgreSQL 16 lifecycle-state repository behind the existing application port, with injected server-owned tenant authorization, runtime validation of snapshots and database rows, lower-generation fencing, cross-connection expected-generation conditional writes, forward-only idempotent migration, synthetic disposable backup/restore proof, and teardown cleanup proof. It does not configure or contact hosted Supabase, Production, legacy, runtime/customer data, credentials, deployment, cutover, worker/process/provider integration, or an HTTP/API boundary.

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
