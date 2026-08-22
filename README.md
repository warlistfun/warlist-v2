# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. This repository contains the completed Phase 0–6 backend foundations.

**Status:** Phases 0–6 are complete. Owner-approved implementation stopped at Phase 7 PR #100; Phase 7 is not technically complete and all remaining Phase 7/later-phase roadmap work is deferred unless the owner explicitly resumes it. Phase 6 is verified only for synthetic/application/disposable PostgreSQL delivery and entitlement behavior; no hosted Supabase runtime, concrete child-process launch, Production behavior, legacy/runtime/customer-data access, credentials, deployment, cutover, WhatsApp/provider send, or public automation API has been configured or verified.

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
