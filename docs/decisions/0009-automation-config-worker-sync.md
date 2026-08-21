# ADR 0009: Durable Automation Config and Worker Synchronization

- **Status:** Accepted for future implementation
- **Date:** 2026-08-21

## Context

`createAutomationConfigMutationService()` currently compares and saves a tenant-owned configuration revision, then invokes an injected propagation boundary. Existing worker IPC already carries a versioned `APPLY_CONFIG` command, but a worker rejection, timeout, or unavailability cannot safely reverse a persisted revision: rollback can overwrite a newer successful revision, while dispatch-before-save cannot know the exact winning revision under concurrent writes.

## Decision

Treat a successful configuration compare-and-save as canonical immediately. In the **same database transaction**, append one durable automation-config synchronization outbox record keyed by `(tenant_id, config_revision)`. The record carries only tenant identity, exact revision, bounded lifecycle state, attempt metadata, and safe failure classification; it does not duplicate policy payload or provider data.

A worker synchronization dispatcher reads pending records and invokes existing `APPLY_CONFIG` with that exact revision. Worker acknowledgement transitions only the matching outbox record to applied. Rejection, timeout, or unavailability leaves the canonical configuration unchanged and retains/reclassifies the matching record for bounded retry or explicit reconciliation. A retry, stale worker result, or recovery job may transition only the record for its exact tenant/revision; it must never mutate or roll back another config revision.

The caller receives successful configuration persistence once the transaction commits. Worker synchronization is observable separately as pending/applied/retryable-failure/non-retryable-failure; it is not hidden behind a false all-or-nothing success claim.

## Recovery and concurrency

On restart, the dispatcher resumes non-terminal records. Newer revisions do not erase older records; the dispatcher/worker may coalesce superseded pending revisions only through an explicit future rule that preserves auditability and never acknowledges a revision not applied by the worker. An acknowledged worker revision is evidence only for the matching outbox record. Configuration conflict behavior remains the existing compare-and-save contract.

## Alternatives

- **Rollback persisted config after worker failure:** rejected; a late rollback can overwrite a newer configuration revision.
- **Dispatch before persistence:** rejected; it cannot reliably transmit the exact revision that wins concurrent compare-and-save.
- **Store a worker-applied revision inside the opaque config JSON:** rejected; it couples delivery state to config payload, complicates atomic versioning/recovery, and does not supply durable retry work.
- **Treat worker acknowledgement as part of a synchronous distributed transaction:** rejected; process IPC cannot provide that atomicity across crash boundaries.

## Implementation contract

A follow-up slice must add a forward-only schema/migration and repository contract that atomically saves configuration plus outbox record; a dispatcher boundary; strict tenant/revision fencing; restart recovery; and focused tests for commit, stale conflict, worker ACK, rejection/timeout/unavailable, retry, and stale-result isolation. It must not add provider payload decoding/send, credentials, deployment, runtime cutover, hosted Supabase configuration, customer data, or claim Phase 5 closure.

## Consequences

The system exposes a durable distinction between canonical config revision and worker-applied revision. Worker lag becomes recoverable/observable rather than an unsafe rollback condition. This ADR advances the Phase 5 synchronization foundation only; concrete group/admin current-membership validation and active runtime automation migration remain unresolved.

## Non-authorization

This decision does not authorize provider integration, actual worker-process launch, Production deployment, legacy changes, customer data access, hosted database changes, or Phase 6 work. **Phase 5 remains IN PROGRESS. Phase 6 remains NOT AUTHORIZED.**
