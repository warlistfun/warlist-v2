# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. It currently contains a substantial backend foundation, a bounded loopback-only runnable composition, and a public frontend foundation.

**Status:** The [execution roadmap](docs/execution-roadmap.md) is the active authority for one unified, backend-first Operational Migration. Backend Foundation remains `PARTIALLY VERIFIED` after its [as-built audit](docs/backend-foundation-as-built-audit.md). `OM-01` through `OM-19.5` are landed bounded slices at their recorded evidence ceilings; `OM-20` is the sole next recommendation and requires a direct owner instruction to activate its standing execution envelope. No hosted Supabase runtime, Production behavior, legacy/runtime/customer-data access, deployment, cutover, live customer traffic, or public automation API has been configured or verified.

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
