# ADR 0002: Modular Monolith

- **Status:** Accepted

## Context

WARLIST needs explicit ownership and testable boundaries without operational complexity.

## Decision

Use one modular backend deployable with explicit application services and ports/adapters. Avoid a dependency-injection framework.

## Alternatives

Legacy global composition; microservices; external broker.

## Consequences

Deployment remains simple. Module boundaries must be enforced by tests rather than network separation.
