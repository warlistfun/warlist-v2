# Phase 5 authority reconciliation

**Authority:** the durable WARLIST V2 backend master plan, Phase 5 lines 1585–1605. This matrix reconciles the landed Phase 5 foundations through PR #78 plus the final Issue #79 closure change.

## Matrix

| Master-plan requirement                                       | Status   | Evidence                                                                                                                                                                                                                                              | Boundary                                                                                 |
| ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Normalize inbound synthetic messages                       | VERIFIED | Issue #60 / PR #61; `inbound-message-normalizer.ts` and focused tests                                                                                                                                                                                 | Synthetic trust boundary only; provider payload decoding remains excluded.               |
| 2. Build pure evaluator gate by gate                          | VERIFIED | Issues #58/#67/#79; evaluator tests cover bot, OPS, time, group, admin, keyword, entitlement, dedupe, existing-delivery, and accepted paths                                                                                                           | Evaluator remains pure and performs no I/O.                                              |
| 3. Create explicit decision codes                             | VERIFIED | `AutomationDecisionCode` is closed and every code has focused unit evidence                                                                                                                                                                           | No external-send result is claimed.                                                      |
| 4. Add field-scoped/versioned config mutation                 | VERIFIED | Issue #62 / PR #63 plus Issue #79; one-field mutation preserves unrelated config and Phase 5 policy fields, uses expected revision, and atomically creates an exact-revision outbox record                                                            | Stale updates return `CONFIG_VERSION_CONFLICT`.                                          |
| 5. Validate group/admin relationship server-side              | VERIFIED | Issue #79; the mutation service derives tenant identity from trusted context, loads the configured group through a tenant-scoped directory port, and requires every configured admin in the returned current-membership projection before persistence | No provider/Baileys adapter or customer data is introduced.                              |
| 6. Propagate exact committed config version to worker         | VERIFIED | Issues #76/#79; atomic config/outbox commit, claim fencing, dispatcher, and integration proof through `ActiveTenantWorkerService` → ownership fence → `WorkerRuntimeService` → versioned IPC `APPLY_CONFIG` → matching ACK → `APPLIED`                | Concrete OS child-process launch and deployment remain outside Phase 5.                  |
| 7. Build `debug:automation` CLI                               | VERIFIED | Issue #64 / PR #65 plus Issue #79; CLI reproduces all evaluator classes from explicit synthetic fixture state and prints only the decision code                                                                                                       | No environment, repository, provider, or customer data access.                           |
| 8. Migrate one active automation slice at a time              | VERIFIED | Issues #68/#79; active V2 decision service loads canonical committed config, normalizes inbound input, evaluates the full Phase 5 gate set, and stops before external send                                                                            | Provider decoding, delivery claim/send, and legacy/Production cutover remain later work. |
| Evaluator has no transport/database effects                   | VERIFIED | Evaluator imports no adapter and architecture/import-side-effect checks pass                                                                                                                                                                          | Application orchestration owns repository/state ports.                                   |
| Every rejection reason is unit-tested                         | VERIFIED | Focused evaluator and simulator tests cover all closed codes and precedence                                                                                                                                                                           | Synthetic fixtures use invented identifiers only.                                        |
| Stale config update conflicts rather than overwrites          | VERIFIED | Mutation and repository tests prove no config/outbox change on stale expected revision                                                                                                                                                                | Worker synchronization never rolls canonical config back.                                |
| Simulator reproduces decisions without WhatsApp/customer data | VERIFIED | `automation-simulator.test.ts` covers synthetic message, policy, time, and delivery-state fixtures                                                                                                                                                    | Protected paths remain rejected.                                                         |

## Verdict

**Phase 5 is COMPLETE. Phase 6 is AUTHORIZED.**

Phase 5 closes the automation/configuration application boundary, not WARLIST 2.0 deployment or Production readiness. There is still no provider payload decoder, Baileys credential use, external send, concrete child-process launch, hosted Supabase configuration, deployment, migration/cutover, or customer/runtime data access. Delivery claim/send and entitlement debit semantics begin in Phase 6.

## Preserved evidence

PRs #59, #61, #63, #65, #69, #70, #71, #73, #77, and #78 remain valid bounded foundations. Issue #79 supplies only the missing closure composition and does not rewrite their factual evidence.

## Closure gates

- focused RED was observed before each new behavior;
- focused automation/config/worker-sync tests pass;
- `npm run check` must pass on the final diff;
- one independent review must return no blocking finding;
- remote `CI / quality` and `CI / security` must pass before squash merge;
- legacy Production and protected runtime/customer state remain unchanged.
