# ADR 0008: Defer Legacy Entrypoint Delegation

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Phase 1 established runtime-validated configuration, foundational ports, resource-free application and HTTP composition, and centralized bootstrap/shutdown behavior.

Read-only inspection of the legacy Production entrypoint found that it directly owns filesystem and environment configuration, a metrics singleton, `WebServer`, `TelegramHub`, timers, process signals, and process exit. WARLIST 2.0 intentionally has no concrete adapters for those runtime dependencies yet. The legacy checkout is Production-sensitive, pre-dirty, and protected from unapproved source or runtime mutation.

Making the legacy entrypoint delegate now would require temporary cross-repository coupling, incomplete adapters, or behavior changes without parity evidence.

## Decision

Complete Phase 1 on the verified resource-free composition boundary. Defer legacy entrypoint delegation until concrete adapter parity exists and a separately approved migration/cutover slice can prove behavior preservation.

No bridge, import, package dependency, symlink, or runtime connection between the legacy checkout and this repository will be introduced for Phase 1 closure.

## Residual risk

WARLIST 2.0 composition has not run the legacy Production workload. Production behavior parity, process integration, provider behavior, and cutover safety remain unverified.

## Non-authorization

This decision does not authorize editing or restarting the legacy service, adding deployment capability or credentials, accessing protected runtime/customer data, or claiming Production readiness.

## Revisit trigger

Revisit entrypoint delegation only after the required concrete server, configuration, metrics, worker/runtime, and provider adapters exist with behavioral parity tests, and before an approved migration or Production cutover.

## Alternatives

- Edit the Production entrypoint now: rejected because required adapters and parity evidence do not exist.
- Add a temporary cross-repository bridge: rejected because it creates fragile runtime coupling and later removal work.
- Keep Phase 1 indefinitely open: rejected because the remaining item depends on later-phase implementation rather than unfinished Phase 1 foundation work.

## Consequences

Phase 1 can close honestly as the resource-free composition foundation. Later phases must not infer runtime parity or Production readiness from this closure.
