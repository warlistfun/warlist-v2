# WARLIST V2 Operational Migration Master Contract

> **Status:** Canonical planning contract. Current slice status and authorization live in [`execution-roadmap.md`](execution-roadmap.md) and [`operational-migration-roadmap.md`](operational-migration-roadmap.md). This document defines how each owner-authorized slice must preserve legacy behavior, classify corrections, avoid overengineering, prove completion, and hand off to the next session. It does not authorize implementation, provider access, credentials, customer data, hosted configuration, deployment, or Production changes.

## 1. Outcome

Migrate WARLIST incrementally from the legacy implementation into WARLIST V2 while preserving the user-observable product flow and making every important path smaller, deterministic, testable, and easier to debug.

The migration is not a greenfield redesign. Its default rule is:

> **Preserve the legacy product flow; simplify the implementation; do not inherit a confirmed bug.**

Success means a solo developer or Hermes can trace an event from the owning entry point to its terminal state without guessing through global state, hidden side effects, or duplicated business logic.

## 2. Authority and evidence

Authority is split deliberately:

1. [`execution-roadmap.md`](execution-roadmap.md) is the active execution authority and records whether work is authorized.
2. This document is the canonical Operational Migration contract: invariants, parity rules, correction rules, safety boundaries, and completion protocol.
3. [`operational-migration-roadmap.md`](operational-migration-roadmap.md) is the phase/slice status board and recommended sequence.
4. Current source, tests, executable schemas, and migrations prove as-built behavior.
5. The legacy source and its tests are read-only behavior references. Protected runtime/customer/credential paths are never migration fixtures.
6. GitHub Issues, PRs, CI, merge commits, and checkpoints provide bounded change evidence.

A roadmap row, recommendation, merged slice, or checkpoint never authorizes the next slice automatically. Owner authorization is required for each bounded Issue and separately for provider, credential, hosted, deployment, financial, customer-data, or Production effects.

## 3. Behavior baseline

The migration begins from the behavior actually implemented in legacy WARLIST, not from a rewritten idealization. The relevant legacy path is inspected read-only before each slice.

The core flow to preserve is:

```text
application boot
  -> discover active tenant/OPS
  -> start locally owned WhatsApp worker
  -> load/save local Baileys auth state
  -> observe connection state
  -> receive live Baileys event
  -> apply transport guards
  -> normalize inbound message
  -> evaluate automation gates in the characterized order
  -> acquire durable delivery authority
  -> perform at most the authorized external attempt
  -> persist sent or ambiguous evidence
  -> process confirmation
  -> consume entitlement once
  -> expose safe status and operator actions
```

Transport behavior that must be characterized before migration includes live `messages.upsert` handling, history/replay rejection, `fromMe`, stale/pre-connect messages, quoted/no-text payloads, connection/reconnect/logout state, local credential persistence, and terminal stop.

Business behavior that must remain explicit includes bot/status/schedule/group/admin/keyword decisions, daily-use and entitlement rules, deduplication, existing-delivery handling, reply construction, send admission, confirmation, and operator-visible status.

This summary is not a substitute for slice-specific source inspection. Exact precedence, fallback behavior, and output must be locked by the slice parity matrix.

## 4. Change classification

Every observable difference between legacy and V2 must be classified before implementation.

| Class                   | Meaning                                                                                                                                   | Required action                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PARITY`                | Legacy behavior is intentional and safe enough for the migrated boundary.                                                                 | Preserve input, precedence, output, and side effects.                        |
| `CONFIRMED_BUG_FIX`     | Legacy behavior is reproducibly incorrect against product intent or a correctness, security, data-integrity, or recovery invariant.       | Apply the smallest V2 correction and retain legacy/V2 regression evidence.   |
| `SAFETY_HARDENING`      | Malformed input, unauthorized access, timeout, concurrency, crash, or cleanup is made fail-closed without changing the normal happy path. | Prove the happy path remains equivalent and the unsafe path is closed.       |
| `OWNER_APPROVED_CHANGE` | User-visible product behavior is intentionally changed.                                                                                   | Require explicit owner decision recorded in the Issue before implementation. |
| `UNKNOWN`               | Evidence does not establish whether the difference is a bug or intended behavior.                                                         | Preserve parity or stop for an owner decision; never guess.                  |

The owner permits confirmed legacy bugs to be corrected in V2. That permission does not allow speculative cleanup or silent product redesign.

A bug may be corrected inside the current slice only when all are true:

- the legacy behavior is reproduced from source, a characterization test, or a synthetic fixture;
- the expected behavior follows from an explicit product or safety invariant;
- the correction is directly relevant to the authorized slice;
- one regression fails before the fix and passes afterward;
- unrelated happy-path behavior remains unchanged;
- the Issue, PR, and checkpoint label the correction `CONFIRMED_BUG_FIX` or `SAFETY_HARDENING`.

Cross-tenant access, credential leakage, duplicate external send, double financial mutation, stale-worker authority, partial/corrupt persistence, unsafe replay, and unbounded lifecycle cleanup are correctness defects, not features to preserve. Product-visible semantics such as gate order, keyword matching, reply format, daily-use rules, onboarding steps, or reconnect UX require parity unless their bug status is proven or the owner approves a change.

## 5. Mandatory parity matrix

Every implementation slice must include a matrix with at least these columns:

| Legacy source/behavior     | Synthetic input or transition | Legacy result   | Classification           | Required V2 result            | Evidence                                             |
| -------------------------- | ----------------------------- | --------------- | ------------------------ | ----------------------------- | ---------------------------------------------------- |
| Exact relevant symbol/path | Invented fixture only         | Observed result | One class from Section 4 | Preserved or corrected result | RED/GREEN test, command, or bounded acceptance proof |

Rules:

- characterize only the path owned by the current slice;
- do not copy legacy runtime data, credentials, auth state, messages, JIDs, logs, database files, or Git history;
- preserve known-good evidence even when its historical interpretation was wrong;
- one successful example is not parity for error, timeout, restart, or replay behavior;
- provider/account behavior remains `UNVERIFIED` until an explicitly approved isolated acceptance run exercises it.

## 6. Anti-overengineering contract

Use the first rung that solves the authorized behavior:

1. Do not add code when the existing V2 seam already represents the behavior.
2. Prefer Node.js/TypeScript/PostgreSQL/native platform behavior over a new dependency.
3. Reuse an already installed and pinned dependency before adding another.
4. Add one concrete implementation for the current product path.
5. Extract a reusable abstraction only when a second real use or a trust boundary requires it.
6. Make the minimum explicit change that passes the parity and safety evidence.

Operational Migration must not introduce, without a separately proven need:

- a dependency-injection framework, service locator, plugin framework, or internal event bus;
- microservices, Kubernetes, Redis/broker, workflow engine, or distributed scheduler;
- a provider factory with one provider;
- a generic retry/reconciliation framework before the first concrete failure semantics exist;
- duplicate worker lifecycle, IPC, credential-directory, normalizer, evaluator, claim, or ledger implementations;
- a worker pool merely because the legacy repository contains an optional pool path;
- a bulk `WAWorker` rewrite or mass file conversion;
- speculative config flags, adapters, tables, DTOs, or directories “for later.”

Start with one concrete Baileys path and one child process where isolation is required. Keep the existing V2 lifecycle, IPC, diagnostics, local credential-directory, automation, delivery, and persistence seams unless current evidence proves a defect. The current legacy dependency lock is the starting compatibility reference; do not combine a Baileys upgrade with behavior migration unless the current version is proven unusable and the owner accepts a separately evidenced dependency decision.

## 7. Slice contract

Each session owns exactly one bounded GitHub Issue and one externally meaningful vertical behavior.

### Execution timebox

Keep each slice small enough to finish in one focused session:

- **Target:** reach PR-ready state within 60 minutes of active engineering (inspection, implementation, tests, review, and publication preparation).
- **At 60 minutes:** stop optional research, refactoring, and hardening; reduce the slice to the smallest complete path that satisfies its frozen acceptance criteria.
- **At 90 minutes:** stop active implementation, write the durable checkpoint, and hand off unfinished work as a recommended smaller bounded Issue. Do not open it without owner authorization or continue merely to avoid leaving work for the next session.
- **Exception:** only a security, data-integrity, trust-boundary, or lifecycle-correctness blocker may justify the minimum extension needed to leave the current path safe; record the reason in the checkpoint. Cosmetic cleanup, speculative design, and extra evidence do not qualify.
- Passive CI/review/network waiting is not active engineering time, but it does not authorize starting another slice or expanding scope.

Before implementation, freeze:

- one outcome and at most five acceptance criteria;
- legacy symbols/tests and V2 seams in scope;
- the parity matrix rows owned by the slice;
- explicit exclusions and external-effect boundaries;
- verification tier and exact commands;
- whether one bounded independent review is justified by concurrency, security, financial, release, or lifecycle risk.

Behavior changes use strict RED-GREEN-REFACTOR:

1. write one failing behavior/parity regression;
2. observe the intended failure, not a broken fixture;
3. implement the minimum passing change;
4. run focused affected tests;
5. run the canonical gate once before publication, rerunning only after a relevant change;
6. review the exact diff and protected-path boundary;
7. publish only the authorized files and behavior.

Do not pull a later roadmap slice into the current Issue. Record the dependency or finding, finish the smallest safe unit, and defer it.

### Debuggability proof

Every migrated slice must leave one smallest reproducible diagnostic path:

- one exact focused test or safe synthetic command that reproduces its accepted/rejected/error outcome;
- a stable decision/error/state code and correlation identity where the path crosses an asynchronous boundary;
- the owning source path and terminal state named in the Issue, PR, and checkpoint;
- safe output that excludes credentials, QR/pairing material, customer/JID/message content, raw provider payloads, and unrestricted logs.

Do not build a generic debugging framework for this requirement. Reuse the focused test, existing diagnostics, or existing debug command when it already proves the path; add the smallest command only when no reproducible entry point exists.

## 8. External-effect gates

Synthetic/fake transport and disposable local PostgreSQL evidence may be used without touching Production. The following require explicit owner scope before execution:

- real WhatsApp account pairing or credential creation;
- external inbound/outbound messages;
- provider/network mutation;
- hosted Supabase/project configuration;
- legacy runtime/customer-data inspection beyond approved read-only source/schema metadata;
- financial/account mutation;
- deployment, restart, cutover, rollback, or Production action.

Use a disposable account and isolated local credential root for approved WhatsApp acceptance. Never type, print, commit, or copy credentials, QR/pairing material, phone/JID values, customer messages, or raw provider payloads.

## 9. Completion and checkpoint protocol

A slice is complete only after:

- every acceptance criterion is verified or honestly classified;
- relevant focused and canonical gates pass;
- the slice's smallest safe reproduction/debug path is recorded and executable;
- any required bounded review has no unresolved material finding;
- PR scope/file list and CI are verified;
- squash merge, Issue closure, live-main ref/tree parity, remote/local branch cleanup, and protected-path preservation are verified;
- as-built docs are updated only where reality changed.

Immediately after those gates, write a durable checkpoint:

```text
docs/checkpoints/session-checkpoint-YYYY-MM-DD-om-NN-<slug>.md
```

The checkpoint is local and uncommitted by default unless the owner requests publication. It must record:

- outcome status: `VERIFIED`, `PARTIALLY VERIFIED`, `FAILED`, `UNVERIFIED`, or `BLOCKED`;
- Issue, PR, head/merge/live-main refs, CI, parity, and cleanup evidence;
- exact legacy behavior migrated and final parity matrix;
- confirmed bug fixes or hardening, with regression evidence;
- files changed and commands actually run;
- the smallest safe command/test for reproducing the migrated behavior and its stable terminal code/state;
- external/provider/hosted/Production effects that did not run;
- residual risk, blockers, and rollback/recovery notes;
- current roadmap phase/slice status;
- exactly one recommended next slice, why it is next, its prerequisites, and an exact `/new` prompt.

After writing and verifying the checkpoint, recommend the next slice and stop. A recommendation is not authorization. Do not open or implement the next Issue in the same session.

## 10. Choosing the next slice

Recommend the earliest roadmap slice whose prerequisites are landed and whose work:

1. continues the same end-to-end product path;
2. removes the nearest blocker to observable business behavior;
3. reuses existing V2 seams;
4. has the smallest safe blast radius;
5. does not require an unapproved external effect.

If the next sequential slice is blocked, recommend the immediate operational resolution or the smallest prerequisite slice. Do not skip to cosmetic or deferred work merely because it is easier.

## 11. Phase closure

A merged slice never closes its parent phase. A phase may be called complete only when every applicable slice and phase exit criterion is landed, the current source and roadmap agree, residual risk is explicit, and a phase checkpoint records the next-phase authorization state.

Operational Migration as a whole remains incomplete until legacy parity, hosted/runtime operation, migration rehearsal, restore, immutable release, cutover, rollback, and Production acceptance are separately proven. No local test, process state, HTTP `200`, or provider callback establishes Production readiness.

## 12. Deferred enhancements

Operational Migration does not silently include PIN/passkeys, WhatsApp notification campaigns, Google Sheets/Contacts, Saweria cutover, PWA rebuild, native mobile, frontend redesign, or unrelated product expansion. Those remain deferred until separately authorized after the operational replacement path is safe.
