# Three-part execution roadmap — 2026-08-22

## Decision

The owner adopted `docs/execution-roadmap.md` as WARLIST V2's active execution authority.

- **Backend Foundation** is frozen at PR #100 as the baseline for an as-built audit.
- **Operational Migration** is not started and needs a new explicit owner decision after that audit.
- **Enhancements** are deferred and roadmap-only.

The previous `docs/roadmap.md` and durable backend master plan are preserved unchanged as historical planning/scope references for traceability and gap analysis.

## Changed files

- `docs/execution-roadmap.md` — new three-part active roadmap.
- `README.md` — entry point to the active roadmap.
- `AGENTS.md` — execution authority and no-start guardrail.

## Verification

- `npm ci --no-audit`
- `npm run check`
- final diff and protected-path review

## Boundaries and restore

Documentation-only. No runtime/source behavior, schema, migration, dependency, provider, deployment, Production, credential, customer-data, or legacy checkout action. Revert the eventual squash commit to restore the former documentation authority wording only; it does not authorize implementation.
