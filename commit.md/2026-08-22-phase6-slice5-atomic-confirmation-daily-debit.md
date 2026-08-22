# Phase 6 Slice 5 — Atomic confirmation and daily debit

## Scope

Issue #89: atomically confirm one synthetic `SENT` delivery and apply the characterized once-per-WIB-date entitlement debit.

## Files changed

- `migrations/0008-delivery-confirmation.sql`
- `src/app/business-repository.ts`
- `src/infrastructure/database/postgres-business-repository.ts`
- `src/modules/delivery/application/delivery-confirmation-service.ts`
- `test/support/disposable-postgres.ts`
- `test/unit/delivery-confirmation-service.test.ts`

## Reason

A confirmation needs one database statement that fences authority, changes delivery state, and conditionally appends the immutable daily debit. Confirmation identity is persisted so an exact replay returns its canonical result without a second debit.

## Verification

- RED: confirmation service module was absent (`MODULE_NOT_FOUND`).
- Focused disposable PostgreSQL confirmation test passed, including exact replay and stale-fence rejection.
- `npm run check` passed: format, lint, strict typecheck, 217 tests, build, and boundary check.
- `git diff --check` passed.

## Boundaries and residual risk

No provider/WhatsApp call, payment/coupon flow, hosted Supabase, credential, customer/runtime data, deployment, or Production behavior is included. This slice does not close Phase 6; Slice 6 must reconcile the adversarial matrix and phase authority.

## Restore

Revert the eventual Slice 5 squash commit. No runtime data or external state is affected.
