# WARLIST 2.0

WARLIST 2.0 is a clean, backend-first migration of WARLIST. It currently contains a substantial backend foundation, a bounded loopback-only runnable composition, and a public frontend foundation.

**Status:** The [execution roadmap](docs/execution-roadmap.md) is the active authority for one unified, backend-first Operational Migration. Backend Foundation remains `PARTIALLY VERIFIED` after its [as-built audit](docs/backend-foundation-as-built-audit.md). OM-15 adds only an import-safe composition root and native loopback listener over injected repository/worker boundaries and the built Web; it is not a deployed or Production runtime. No hosted Supabase runtime, Production behavior, legacy/runtime/customer-data access, real credential/account acceptance, deployment, cutover, live WhatsApp/provider network send, or public automation API has been configured or verified.

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
