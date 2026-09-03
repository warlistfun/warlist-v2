# Scheduled-start cooldown contract — 2026-09-03

## Decision

The owner clarified WARLIST V2 list eligibility as a timestamp-based per-user/per-vendor contract. Existing trigger matching and gate order remain unchanged. After a trigger matches, the backend extracts work date/time metadata from the admin message; confirmed assignment derives eligibility from the parsed WIB schedule or a non-blocking confirmation-time fallback.

```text
nextEligibleAt = anchor + fixed nine-hour work duration + cooldown snapshot
```

The user configures cooldown per vendor in 30-minute increments from 60 through 10080 minutes. Confirmation snapshots the committed value; duplicate/replayed confirmation cannot extend eligibility, and later setting changes affect only future assignments. Daily entitlement accounting remains separate from list eligibility.

## Roadmap ownership

- `OM-19.5`: schedule extraction after existing trigger acceptance and immutable nullable delivery-operation metadata.
- `OM-20`: delivery/send/confirmation/debit composition that consumes the stored schedule without introducing later business authority.
- `OM-29`: canonical per-vendor cooldown write validation and projection without fabricating assignment eligibility.
- `OM-30`: server-derived user/vendor assignment, fallback anchor, atomic eligibility composition, and snapshot semantics.
- `OM-36`: customer UI for selecting the canonical cooldown increments; no manual work-start correction prompt.

## Changed files

- `docs/operational-migration-master.md`
- `docs/operational-migration-roadmap.md`
- `commit.md/2026-09-03-scheduled-start-cooldown-contract.md`

## Verification

- Prettier check on the three changed Markdown files.
- `git diff --check`.
- Scoped search for the superseded confirmed-assignment anchor wording.
- Final diff, status, and protected-path review.

## Boundaries and restore

Documentation-only. No source, test, schema, dependency, trigger behavior, external send, provider/account/credential, customer/runtime data, deployment, Production, or legacy checkout mutation. Revert the eventual documentation commit to restore the previous roadmap wording; that rollback does not change runtime behavior because this update implements none.
