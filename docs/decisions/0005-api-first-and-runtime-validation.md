# ADR 0005: API-First with Runtime Validation

- **Status:** Accepted for future implementation

## Context

TypeScript types do not validate HTTP, environment, database, IPC, legacy, or provider inputs at runtime.

## Decision

WARLIST application services own business behavior; interfaces use versioned contracts and runtime validation at every untrusted boundary.

## Alternatives

Trust compile-time types; expose database/provider contracts directly.

## Consequences

Boundary failures become explicit and testable. Schema tooling will be chosen with the first real boundary, not preinstalled in Phase 0.
