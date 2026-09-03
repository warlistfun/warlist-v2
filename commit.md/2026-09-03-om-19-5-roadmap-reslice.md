# OM-19.5 roadmap reslice — 2026-09-03

## Decision

Issue #201 introduces one prerequisite before OM-20 because current source has no immutable `scheduled_start_at` on delivery operations and no safe basis for OM-20 to invent future user/vendor/cooldown authority. The owner approved Issue creation and roadmap correction only, not implementation.

## Scope

- Add `OM-19.5` as the scheduled-start extraction and immutable nullable metadata foundation.
- Make `OM-20` consume the stored schedule through delivery and confirmation while retaining durable fallback evidence, without calculating `nextEligibleAt`.
- Keep per-vendor cooldown provenance in `OM-29` and server-derived user/vendor assignment plus atomic eligibility calculation in `OM-30`.
- Set `OM-19.5` as the sole next recommendation and make explicit that recommendation and an open Issue are not implementation authorization.

## Verification

- Prettier check on changed Markdown.
- `git diff --check`.
- Authority/status/next-recommendation consistency scan.
- Read-back of Issues #200 and #201.
- Final changed-path and protected-path review.

## Boundaries and restore

Documentation and GitHub Issue metadata only. No source, test, schema, trigger behavior, external send, provider/account/credential, customer/runtime data, hosted deployment, or Production action. Revert the documentation commit and restore the prior Issue #200 body to roll back this planning correction; no runtime rollback is required.
