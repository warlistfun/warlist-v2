# Phase 6 Slice 3 — legacy-characterized claim-gated sender

## Scope

Issue #85 characterizes the allowed non-protected legacy delivery send path and adds a synthetic claim-gated sender with fenced durable settlement.

## Implemented

- Recorded legacy admission, send, ambiguous-outcome, retry, identity, and consumption-timing decisions as preserve/replace/retire entries.
- Added forward-only migration `0006-delivery-settlement.sql` for bounded synthetic provider-message identity.
- Added PostgreSQL begin/settlement CASes requiring the exact tenant, operation, attempt, fence, running non-quarantined worker generation, and child identity; `SENDING` is durable before the injected sender and an expired `SENDING` claim becomes `AMBIGUOUS`, never replays.
- Added a claim-gated coordinator: it claims, durably begins, invokes one sender, then settles `SENT` or `AMBIGUOUS`; no retry loop exists.

## Evidence

- RED: missing coordinator produced `MODULE_NOT_FOUND`; missing durable settlement produced `settleDelivery is not a function`.
- Focused tests: synthetic coordinator and disposable PostgreSQL authority matrix passed.
- `npm run check` — PASS: format, lint, strict typecheck, build, boundary check, and 211 tests.
- `git diff --check` — PASS.

## Boundaries and residual risk

No real provider adapter/network, credential, customer/runtime data, legacy mutation, hosted Supabase, deployment, entitlement debit, confirmation, or Production behavior was added or accessed. The synthetic sender does not prove real-provider exactly-once behavior; a crash after provider acceptance but before settlement remains represented as `AMBIGUOUS`, with later reconciliation/confirmation work required.

## Recovery

Before merge, remove the isolated branch/worktree. After merge, revert the Slice 3 commit if required; no external state is created by this repository slice. The forward migration is not a Production authorization.
