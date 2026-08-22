# Phase 7 authenticated-principal tenant derivation

## Scope

Issue #97 adds a pure application boundary that derives tenant access only from a runtime-validated authenticated principal. This is a bounded Phase 7 slice, not Phase 7 closure.

## Files changed

- `src/modules/identity/application/authenticated-principal.ts`
- `test/unit/authenticated-principal.test.ts`
- `docs/architecture.md`

## Behavior

- A principal contains only a UUID user identity and unique UUID tenant `OWNER` memberships.
- Tenant access is granted only when the requested tenant belongs to that validated principal.
- Missing, malformed, forged, duplicate, extra-field, and cross-tenant inputs return stable safe identity errors.

## Verification

- RED: `node --import tsx --test test/unit/authenticated-principal.test.ts` failed before implementation because the principal module did not exist.
- GREEN: focused test passed 8/8.
- `npm ci --no-audit` passed.
- `npm run check` passed: formatting, lint, strict typecheck, 240 tests, build, and repository-boundary check.
- `git diff --check` passed.
- Added-line secret/dangerous-call scan returned no matches.
- Independent review initially found unsafe accessor/hidden/inherited principal-field handling. The decoder now uses exact own data-property descriptors, `Reflect.ownKeys`, and plain/null-prototype validation; focused regression cases pass. Final re-review: PASS; no blocking findings.

## Boundaries and residual risk

No HTTP/session/token persistence, PIN/passkey, legacy migration, hosted Supabase, provider, deployment, Production, credential, runtime, or customer-data behavior was added or accessed. Authentication provenance and membership loading remain future explicit boundaries.

## Restore

Revert the squash commit for Issue #97 after confirming no later slice imports this application boundary.
