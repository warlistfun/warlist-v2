# Phase 5 safe automation simulator — 2026-08-21

## Scope

Issue #64 adds `npm run debug:automation -- path/to/fixture.json`, a synthetic-only CLI over the existing inbound normalizer and pure evaluator.

## Files changed

- `package.json`
- `src/debug-automation.ts`
- `test/unit/automation-simulator.test.ts`
- `docs/architecture.md`
- this evidence record

## Behavior

The simulator reads one explicit JSON fixture, accepts only exact `{ message, policy }` data, normalizes the message, and prints a single evaluator decision. Invalid data returns one stable message without echoing fixture content. It has no transport, database, worker, provider, environment, runtime-state, or external-effect integration.

## Commands run

- `node --import tsx --test test/unit/automation-simulator.test.ts` — RED: failed because `src/debug-automation.ts` did not exist.
- `node --import tsx --test test/unit/automation-simulator.test.ts && npm run typecheck` — PASS: 3/3 tests and strict typecheck.

## Residual risk

This is synthetic simulator proof only. It does not decode provider payloads or validate concrete server-side group/admin data; it does not propagate worker configuration or migrate active automation. No hosted Supabase, deployment, Production, customer, credential, or runtime state was accessed or changed.

## Restore

Revert the commit that contains this record. No runtime, customer, credential, or external state changed.
