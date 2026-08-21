# Legacy Characterization Map

No legacy application test or source file is copied in the Phase 0 foundation slice.

Future migration slices must inspect and rewrite behavior with synthetic fixtures, prioritizing:

1. server-session tenant ownership and cross-tenant rejection;
2. worker generation/child fencing and lifecycle;
3. delivery claims, confirmation, and ambiguous outcomes;
4. once-per-day entitlement consumption after confirmation;
5. payment/coupon monotonicity and idempotency;
6. canonical-state propagation and stale-write prevention;
7. graceful shutdown and readiness semantics;
8. logging/diagnostic redaction;
9. admin destructive-action and terminal worker-stop boundaries.

Each future entry must link its legacy evidence path, owning V2 module/Issue, behavioral test, licensing disposition, and synthetic fixture review.

## Phase 2 worker IPC contract

| Legacy evidence                                                                                                                                                                                     | V2 owner                                           | Behavioral evidence                                                                                                                                                             | Licensing                                                              | Fixture review                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `lib/worker-pool.js` lifecycle messages, matching, and timeout fencing; `lib/worker-process.js` command dispatch and replies; `test/worker-pool-lifecycle.test.js` stale-child/generation scenarios | Issue #11; `src/interfaces/worker-ipc/contract.ts` | `test/unit/worker-ipc-contract.test.ts` validates exact IPC v1 envelopes, immutable decoded values, safe errors, versions, identities, and positive generations/config versions | Behavior rewritten from inspection; no legacy source or fixture copied | Invented reserved-example identifiers only; no credential, customer, provider, or runtime payload |

Preserve child-incarnation and generation identity, correlated request/reply semantics, terminal lifecycle evidence, and timeout quarantine in subsequent Phase 2 runtime slices. Do not copy the legacy implicit/unvalidated protocol, raw error messages, fire-and-forget delivery assumptions, silent stale-command drops, or unfenced shutdown behavior.

## Phase 5 active automation characterization

| Legacy evidence                                                                                  | V2 owner                                                                                 | Behavioral evidence                                                                                                                                                                                                                                  | Licensing                                                   | Fixture review                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `lib/worker.js` `_rebuildCaches()` / `_triggerForSender()` and keyword gate in `handleMessage()` | Issue #66; `src/modules/automation/application/legacy-admin-trigger-characterization.ts` | `test/unit/legacy-admin-trigger-characterization.test.ts` proves a sender-specific trigger overrides global-keyword fallback; absent sender-specific trigger uses global fallback; normalization and stable invalid-input behavior are deterministic | Behavior rewritten from inspection; no legacy source copied | Reserved invented identifiers only; no customer, credential, provider, or runtime data |

This is a characterization boundary, not active migration/cutover. It does not decode provider payloads, validate current group/admin membership, load/mutate configuration, invoke a worker, dedupe, admit delivery, send a reply, or alter legacy/Production behavior.

| Legacy evidence                                                              | V2 owner                                                                | Behavioral evidence                                                                                                                                                 | Licensing                                                   | Fixture review                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lib/worker.js` status gate in `handleMessage()` and `_isWithinTimeWindow()` | Issue #67; `src/modules/automation/application/automation-evaluator.ts` | `test/unit/automation-evaluator.test.ts` proves inactive OPS rejection before time/group gates plus inclusive normal/overnight time windows from an injected minute | Behavior rewritten from inspection; no legacy source copied | Reserved invented identifiers and minute-of-day values only; no customer, credential, provider, or runtime data |

The V2 evaluator accepts only explicit synthetic status and minute-of-day inputs. It preserves the observed legacy active-status and inclusive/overnight window semantics without reading a clock, configuration, or external state. It does not characterize entitlement/balance, delivery, provider payload, or worker behavior.
