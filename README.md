# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. This repository contains the completed Phase 0–4 foundations and the in-progress Phase 5 automation evaluator and field-scoped configuration work.

**Status:** Phases 0–4 are complete. Phase 5 is **IN PROGRESS**: Issue #58 / PR #59 provides the pure evaluator foundation, and Issue #60 adds synthetic inbound normalization. These bounded slices do not complete Phase 5. No hosted Supabase runtime, Production behavior, legacy/runtime/customer-data access, credentials, deployment, cutover, WhatsApp/provider integration, or public automation API has been configured or verified.

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
