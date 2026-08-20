# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. This repository contains the completed Phase 0 foundation, Phase 1 application-composition foundation, and Phase 2 synthetic worker-runtime foundation.

**Status:** Phases 0–2 are complete. Phase 2 provides a resource-free, versioned, runtime-validated worker IPC contract, transport-neutral command lifecycle with bounded timeout port, per-tenant generation/child ownership fencing, a safe injected worker-diagnostics boundary with correlation identities, a frozen identity-only pending-command debug snapshot, and deterministic synthetic lifecycle proof across tenants. The owner accepted that this is synthetic evidence only: no network listener, concrete diagnostics sink/logger, concrete process-signal adapter, real worker process, concrete timeout scheduler, database, WhatsApp connection, provider integration, deployment, legacy runtime delegation, or Production cutover exists yet.

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
