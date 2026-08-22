# Phase 7 enrollment database-clock correction — 2026-08-22

## Scope

Issue #95 corrects the enrollment-grant expiry authority in the PostgreSQL adapter. This remains a bounded Phase 7 corrective slice; Phase 7 is still in progress.

## Files changed

- `src/modules/identity/infrastructure/postgres-tenant-enrollment-repository.ts`
- `test/unit/postgres-tenant-enrollment-repository.test.ts`
- `docs/roadmap.md`

## Reason

The prior adapter compared a grant expiry to a supplied application timestamp. PostgreSQL now checks and records consumption using `transaction_timestamp()`, so expiry and durable consumption share the transaction/database clock.

## Verification

- RED: a disposable PostgreSQL test with an already database-expired grant and a favorable application timestamp failed before the correction by allowing enrollment.
- GREEN: `node --import tsx --test test/unit/postgres-tenant-enrollment-repository.test.ts` passed (3 tests).

## Boundaries and residual risk

Only synthetic disposable PostgreSQL was used. No hosted Supabase, Production, credentials, customer/runtime data, provider, deployment, or legacy mutation was accessed. The caller `now` field remains in the narrow enrollment contract for the in-memory synthetic adapter; it is no longer an authority for PostgreSQL enrollment. Sessions/principal derivation, IDOR matrix, legacy migration tooling, and PIN/passkey ports remain separate Phase 7 work.

## Recovery

No external state is created. Before merge, delete the branch. After merge, revert the squash commit if needed; do not restore caller-controlled PostgreSQL expiry authority.
