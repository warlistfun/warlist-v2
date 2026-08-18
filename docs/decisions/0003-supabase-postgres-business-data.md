# ADR 0003: PostgreSQL for Canonical Business Data

- **Status:** Accepted for future implementation

## Context

Business state needs transactional persistence and migration support beyond mutable JSON aggregates.

## Decision

Use Supabase-hosted PostgreSQL behind WARLIST repository ports for canonical business data. Recheck current plan limits before implementation.

## Alternatives

Continue JSON; local SQLite; provider-coupled persistence.

## Consequences

Transactions and constraints improve integrity. Network outage, pooling, backup, export, portability, and restore must be explicitly tested. No database is configured in Phase 0.
