# Architecture (As Built)

WARLIST 2.0 has a resource-free application composition core, strict compiler configuration, and repository-boundary validation.

```text
test -> src/app/config.ts
     -> src/app/ports.ts
     -> src/app/create-application.ts
     -> src/app/create-http-app.ts
     -> src/app/bootstrap.ts
     -> src/shared/version.ts
     -> scripts/check-repository-boundary.mjs
```

`createApplication()` accepts explicit configuration and ordered lifecycle dependencies. Startup occurs in registration order, failed startup rolls back already-started dependencies, and shutdown occurs in reverse order. Repeated start/stop calls are idempotent. Tests supply deterministic no-op/in-memory implementations for logger, metrics, clock, ID generation, repository, and worker-runtime boundaries.

There is no HTTP server, concrete database, worker process, WhatsApp connection, provider adapter, timer, listener, or deployment artifact yet. Future modules follow the modular-monolith and ports/adapters decisions in the ADRs and migration plan, but they are not as-built behavior.

`createHttpApp()` is an in-process adapter with versioned health/readiness routes, runtime request validation, generated request IDs, and canonical response envelopes. It does not bind a port or own network lifecycle.

`createBootstrap()` explicitly owns application startup and shutdown-signal registration through a port. It serializes transitions, unregisters handlers before shutdown, rolls back partial registration, and retains failed cleanup for retry. No `process` listener is registered at import time.

Imports must remain side-effect-free. Protected runtime/customer paths are prohibited from Git by an executable tracked-path check.
