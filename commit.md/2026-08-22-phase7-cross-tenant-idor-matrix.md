# Phase 7 cross-tenant IDOR matrix — 2026-08-22

## Scope

Issue #99 adds a narrow synthetic authorization matrix anchored to the landed authenticated-principal boundary.

## Changed files

- `src/modules/identity/application/authenticated-principal.ts` — exposes a minimal `TenantAuthorizationPort`-compatible adapter that derives each tenant grant from the strict authenticated principal.
- `test/unit/cross-tenant-idor-matrix.test.ts` — proves tenant-one authority cannot read, configure, prepare delivery for, or read audit events from tenant two; malformed/non-owner principals fail closed; post-construction caller mutation cannot expand authorization.

## Evidence

- RED: focused matrix first failed because `createPrincipalTenantAuthorization` did not exist.
- GREEN: focused authenticated-principal + matrix suite passed (11/11).
- `npm run typecheck` passed.
- `git diff --check` passed.

## Boundaries and residual risk

No HTTP/session/token persistence, PIN/passkeys, legacy migration, hosted Supabase, provider, deployment, Production, runtime, credential, or customer-data behavior was accessed or changed. This is a Phase 7 slice only; it does not close Phase 7 or authorize any later phase.

## Restore

Revert the eventual squash commit for Issue #99. No runtime state or migration is involved.
