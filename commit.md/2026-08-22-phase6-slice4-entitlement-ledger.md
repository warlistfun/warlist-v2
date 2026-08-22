# Phase 6 Slice 4 — Entitlement ledger

## Scope

Issue #87: characterize the legacy once-per-day consumption rule and add a synthetic, append-only entitlement ledger with a ledger-derived balance projection.

## Files changed

- `migrations/0007-entitlement-ledger.sql`
- `src/app/business-repository.ts`
- `src/infrastructure/database/postgres-business-repository.ts`
- `src/modules/entitlements/application/daily-entitlement-rule.ts`
- `test/support/disposable-postgres.ts`
- `test/unit/daily-entitlement-rule.test.ts`
- `test/unit/entitlement-ledger.test.ts`
- `docs/migration/characterization-map.md`
- `docs/architecture.md`

## Reason

The legacy source establishes a UTC+7/WIB business date and consumes at most one active day after a confirmed delivery. V2 needs an auditable ledger instead of mutable remaining-day state. The projection remains a direct ledger sum.

## Verification

- RED: daily-rule module absent; `MODULE_NOT_FOUND` observed.
- RED: ledger method absent; `appendEntitlementLedgerEntry is not a function` observed.
- Focused synthetic daily-rule and disposable PostgreSQL ledger tests passed.
- `npm run check` passed: format, lint, strict typecheck, 215 tests, build, and boundary check.
- `git diff --check` passed.

## Boundaries and residual risk

No provider, payment/coupon flow, confirmation debit wiring, hosted Supabase, Production/runtime/customer data, credential, deployment, or cutover behavior was introduced. Slice 5 must atomically join eligible delivery confirmation to the deterministic daily debit; it must not reuse this slice as evidence of confirmation safety.

## Restore

Remove this slice's commit after it is created, or revert the eventual squash commit. No runtime data or external state is affected.
