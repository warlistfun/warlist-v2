# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. It currently contains a substantial but non-operational backend foundation and a public frontend foundation.

**Status:** The [execution roadmap](docs/execution-roadmap.md) is the active work authority. Backend Foundation is `PARTIALLY VERIFIED` and non-operational after its [as-built audit](docs/backend-foundation-as-built-audit.md). The [Operational Migration master contract](docs/operational-migration-master.md) and [slice roadmap](docs/operational-migration-roadmap.md) govern verified synthetic/local OM-01 lifecycle, OM-02 inbound, OM-03 safe-pairing, OM-04 local credential ownership, OM-05 reconnect/logout/reset, and OM-06 database-gated fake-socket send slices; later slices and Enhancements remain unauthorized. No hosted Supabase runtime, application runtime composition, Production behavior, legacy/runtime/customer-data access, real credential/account use, deployment, cutover, live WhatsApp/provider network send, or public automation API has been configured or verified.

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
