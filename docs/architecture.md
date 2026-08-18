# Architecture (As Built)

WARLIST 2.0 currently has one tested TypeScript module, strict compiler configuration, repository-boundary validation, and no runtime composition root.

```text
test -> src/shared/version.ts
     -> scripts/check-repository-boundary.mjs
```

There is no HTTP server, database, worker, WhatsApp connection, provider adapter, timer, listener, or deployment artifact yet. Future modules follow the modular-monolith and ports/adapters decisions in the ADRs and migration plan, but they are not as-built behavior.

Imports must remain side-effect-free. Protected runtime/customer paths are prohibited from Git by an executable tracked-path check.
