# Phase 5 field-scoped configuration mutation — 2026-08-21

## Scope

Issue #62 adds a synthetic application boundary for one-field mutation of an existing automation policy using the current repository revision as optimistic concurrency control.

## Files changed

- `src/modules/automation/application/automation-config-mutation-service.ts`
- `test/unit/automation-config-mutation-service.test.ts`
- `docs/architecture.md`
- `docs/roadmap.md`
- this evidence record

## Behavior

The service derives tenant identity from injected trusted context, accepts one exact supported field mutation, preserves unrelated opaque configuration fields, validates the resulting complete policy through an injected server-side group/admin relationship validator, compares the expected revision, and returns then propagates the immutable committed policy/version. Stale writes retain `CONFIG_VERSION_CONFLICT` and do not propagate.

## Commands run

- `node --import tsx --test test/unit/automation-config-mutation-service.test.ts` — RED: failed because the module did not exist.
- `node --import tsx --test test/unit/automation-config-mutation-service.test.ts && npm run typecheck` — PASS: 4/4 tests and typecheck.

## Residual risk

This is synthetic application proof only. No HTTP boundary, provider payload decoding, worker process, hosted Supabase configuration, active automation migration, external send, deployment, or Production state was used or changed.

## Restore

Revert the commit that contains this record. No runtime, customer, credential, or external state changed.
