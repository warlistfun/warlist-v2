# ADR 0007: New GitHub History and Required CI

- **Status:** Accepted

## Context

The live legacy checkout has historical coupling, protected runtime state, and extensive pre-existing dirty work.

## Decision

Use private `warlistfun/warlist-v2` with new Git history, bounded Issues/branches/PRs, synthetic-only CI, and no Phase 0 deployment workflow.

## Alternatives

Reuse legacy history; develop in the Production checkout; copy the whole legacy tree.

## Consequences

The migration boundary is auditable and clean. Legacy behavior/source must be selected deliberately rather than inherited automatically.
