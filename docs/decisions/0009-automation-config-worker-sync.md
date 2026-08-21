# ADR 0009: Durable Automation Config and Worker Synchronization

- **Status:** Accepted and implemented by PRs #78 and the Issue #79 closure PR
- **Date:** 2026-08-21

## Context

`createAutomationConfigMutationService()` originally compared and saved a tenant-owned configuration revision before an injected propagation boundary. Existing worker IPC already carried a versioned `APPLY_CONFIG` command, but a worker rejection, timeout, or unavailability could not safely reverse a persisted revision: rollback could overwrite a newer successful revision, while dispatch-before-save could not know the exact winning revision under concurrent writes.

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

## Implemented contract

PR #78 added the forward-only schema/migration and repository contract that atomically saves configuration plus the outbox record. The Issue #79 closure adds the dispatcher through the existing ownership/runtime/IPC boundary, strict claim fencing, expired-lease recovery, and focused worker ACK/rejection/timeout/unavailable tests. Neither change adds provider payload decoding/send, credentials, deployment, runtime cutover, hosted Supabase configuration, or customer data.

## Consequences

The system exposes a durable distinction between canonical config revision and worker-applied revision. Worker lag is recoverable/observable rather than an unsafe rollback condition. Tenant-scoped current-membership validation and the active V2 decision slice are completed separately by Issue #79.

## Non-authorization

This decision does not authorize provider integration, concrete OS child-process launch, Production deployment, legacy changes, customer data access, or hosted database changes. Phase 6 is separately authorized by the merged Phase 5 authority reconciliation.
