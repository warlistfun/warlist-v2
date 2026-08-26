# WARLIST V2 Operational Migration Roadmap

> **Status:** `OM-01 VERIFIED`; `OM-02 VERIFIED`; Operational Migration remains incomplete. This roadmap is a planning/status board governed by [`operational-migration-master.md`](operational-migration-master.md). Each later slice requires a new explicit owner decision and one bounded GitHub Issue with at most five acceptance criteria.

## Status legend

- `NOT STARTED` — no implementation authority or landed evidence.
- `AUTHORIZED` — owner approved one bounded Issue; no completion claim.
- `IN PROGRESS` — the authorized Issue is being implemented.
- `PARTIALLY VERIFIED` — useful landed evidence exists but the slice exit criteria are incomplete.
- `VERIFIED` — slice is landed and its closure/ref/tree/checkpoint evidence is complete.
- `BLOCKED` — cannot proceed safely; blocker and immediate resolution are recorded.

A slice status never closes its phase automatically. `VERIFIED` means only the stated slice boundary.

Numerical order is the default dependency order. A later slice may start only when its required earlier behavior is `VERIFIED` or the roadmap explicitly records a different dependency approved by the owner.

## Current decision point

- Backend Foundation remains `PARTIALLY VERIFIED` and non-operational.
- Issues #132 (`OM-01`) and #136 (`OM-02`) are verified synthetic/local slices; neither closes Operational Migration or Phase OM-A.
- No WhatsApp provider, credential, hosted database, customer, deployment, or Production action is authorized.
- No slice after OM-02 is authorized.

## Phase OM-A — Core WhatsApp/Baileys path

**Objective:** Reproduce the legacy WhatsApp automation path through the existing V2 seams, one observable behavior at a time, without changing product flow or performing a bulk worker rewrite.

| Slice   | Outcome                                            | Key parity/safety boundary                                                                                                                                                                                                                                                                                              | Explicit exclusions                                                                                                                          | Status                                                   |
| ------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `OM-01` | **Local Baileys connection lifecycle parity**      | Characterize legacy start, local auth save, open/close/logged-out state, and terminal stop; compose one concrete Baileys child through the existing runtime/IPC/diagnostics/local-directory seams; deterministic fake-socket proof first.                                                                               | No inbound automation, pairing UI, outbound send, pool, hosted DB, real account without separate approval.                                   | `VERIFIED` — Issue #132; local fake-socket evidence only |
| `OM-02` | **Inbound event and transport-guard parity**       | Decode live-shaped `messages.upsert`; accept only characterized live events; preserve history/replay, `fromMe`, stale/pre-connect, quoted/no-text, identity, and safe-redaction behavior; enforce the full protected-fixture path policy for the affected debug path (`BF-08`); feed the existing normalizer/evaluator. | No external send, confirmation, product redesign, or duplicate evaluator.                                                                    | `VERIFIED` — Issue #136; local synthetic evidence only   |
| `OM-03` | **Pairing and local credential ownership parity**  | Preserve QR/pairing/reconnect/logout behavior needed by current onboarding while enforcing one owner, protected local auth state, safe errors, terminal reset/stop, and no credential leakage.                                                                                                                          | No customer credentials, Production auth copy, provider send, or credential storage in PostgreSQL/Supabase.                                  | `NOT STARTED`                                            |
| `OM-04` | **Claim-gated Baileys send and provider evidence** | Continue `ACCEPTED` through existing delivery admission/claim; invoke one concrete Baileys send attempt; preserve provider identity and truthful `SENT`/`AMBIGUOUS` evidence across failure/crash; revalidate and close affected `BF-10` scope.                                                                         | No blind retry, bulk notification, billing change, or exactly-once claim. Real send requires disposable account/group and explicit approval. | `NOT STARTED`                                            |
| `OM-05` | **Confirmation, entitlement, and recovery parity** | Preserve confirmation-listener timing, at-most-once daily debit, restart/replay behavior, and explicit ambiguous/manual-reconciliation state across the concrete worker path.                                                                                                                                           | No new entitlement product rules, payment-provider switch, or automatic ambiguous resend.                                                    | `NOT STARTED`                                            |

### OM-A exit criteria

- One correlated path is traceable from worker start through inbound decision, send evidence, confirmation, and entitlement outcome.
- Legacy normal-flow results are parity-tested; every difference is classified under the master contract.
- Raw credentials, QR/pairing material, JIDs, provider message IDs, and provider payloads never leave the protected adapter boundary; only the explicitly authorized bounded normalized text projection may cross IPC, and diagnostics contain no text.
- A real provider/account path remains `PARTIALLY VERIFIED` until separately approved isolated acceptance evidence exists.

## Phase OM-B — Operational application parity

**Objective:** Replace the operational responsibilities around the core worker without reintroducing Telegram coupling, direct persistence, duplicate business logic, or unsafe operator behavior.

| Slice   | Outcome                                                   | Key parity/safety boundary                                                                                                                                                                                                                                                              | Explicit exclusions                                                                                                   | Status        |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| `OM-06` | **Active-tenant boot and monotonic config application**   | Discover only canonical active tenants, start one current owner, apply exact committed config revisions, recover after restart, and close directly affected `BF-06`/`BF-07` boundaries before concrete effect.                                                                          | No full-record config transport, stale revision rollback, or provider effect before authority.                        | `NOT STARTED` |
| `OM-07` | **Runnable composition, readiness, and safe diagnostics** | Add one explicit V2 runtime entrypoint/listener; compose existing repository/worker/HTTP lifecycles; expose truthful readiness and correlation-based diagnostics; resolve the concrete runtime portion of `BF-03`.                                                                      | No deployment, process-manager change, public environment, or Production claim.                                       | `NOT STARTED` |
| `OM-08` | **User enrollment and onboarding parity**                 | Preserve current registration/setup outcomes while deriving tenant authority from trusted identity, validating group/admin provenance, making completion atomic, and fixing confirmed legacy ownership/collision defects plus the affected expiry/decoder boundaries (`BF-12`/`BF-13`). | PIN/passkey rollout, UI redesign, customer migration, and default shared credentials remain excluded.                 | `NOT STARTED` |
| `OM-09` | **Authenticated user application parity**                 | Preserve the required legacy login/session, dashboard status, committed automation configuration, worker status/control, and user-visible error outcomes through canonical V2 API/application services.                                                                                 | No visual redesign, direct database/provider access, mobile app, billing implementation, or new product flow.         | `NOT STARTED` |
| `OM-10` | **Owner/admin operational parity**                        | Migrate required dashboard, tenant/OPS list/detail, worker stop/status, reset, finance/coupon views, and staged deletion through canonical application services with safe DTOs and audit evidence.                                                                                      | No broad admin redesign, raw aggregate/log exposure, or direct credential deletion from HTTP handlers.                | `NOT STARTED` |
| `OM-11` | **Pakasir billing and entitlement parity**                | Preserve current checkout/verification/settlement behavior behind the existing billing/ledger boundaries; prove ambiguous create, duplicate settlement, restart reconciliation, and balance integrity; close affected `BF-11` scope before hosted financial operation.                  | No Saweria switch, real financial mutation without approval, pricing change, or speculative multi-provider framework. | `NOT STARTED` |

### OM-B exit criteria

- Required user and operator flows no longer depend on Telegram-owned orchestration or direct legacy store/provider calls.
- One runnable non-Production composition reports truthful readiness and safe diagnostics.
- Active config, tenant identity, worker ownership, billing, and entitlement transitions are durable and recoverable.
- Every active Telegram-owned responsibility is preserved through V2 services or explicitly retired by an owner-approved product decision.
- Product-visible differences have explicit owner approval; confirmed legacy defects have regression evidence.

## Phase OM-C — Hosted operation and migration rehearsal

**Objective:** Prove V2 can operate against the selected hosted database and migrate legacy business state recoverably without touching Production or mixing credential environments.

| Slice   | Outcome                                               | Key parity/safety boundary                                                                                                                                                                                                              | Explicit exclusions                                                                               | Status        |
| ------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `OM-12` | **Hosted PostgreSQL/Supabase operational proof**      | Verify current official limits, bounded pool/config/readiness, runtime role, RLS defense-in-depth, export/restore, monitoring, pause/read-only degradation, and portable exit using an owner-approved isolated project.                 | No Production project, customer data, WhatsApp credentials, deployment, or cutover.               | `NOT STARTED` |
| `OM-13` | **Read-only legacy inventory and migration contract** | Complete the file-level relevance/licensing/sensitivity/parity inventory (`BF-05`), then build a versioned upcaster/migrator from synthetic legacy corpora; map counts and invariants without reading protected values or dual-writing. | No live customer/runtime read, credential migration, destructive cleanup, or Production mutation. | `NOT STARTED` |
| `OM-14` | **End-to-end migration and restore rehearsal**        | Rehearse synthetic export/import, business/local-credential backup separation, restore, invariant comparison, restart recovery, and rollback to a previous-compatible state.                                                            | No Production backup copy, real credentials, provider traffic, or public deployment.              | `NOT STARTED` |

### OM-C exit criteria

- Hosted behavior, capacity/degradation, runtime roles, backup, restore, and PostgreSQL exit path are evidenced in isolation.
- Synthetic legacy migration is resumable, checkpointed, and produces an explicit pre/post invariant report.
- Business database state and local credential state have coordinated but separate recovery procedures.

## Phase OM-D — Immutable release and cutover

**Objective:** Produce a recoverable release candidate and replace legacy WARLIST only after explicit Production approval.

| Slice   | Outcome                                        | Key parity/safety boundary                                                                                                                                                                                                                                                                  | Explicit exclusions                                                                                                                             | Status        |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `OM-15` | **Immutable candidate and rollback rehearsal** | Revisit branch/release enforcement risk (`BF-04`), build provenance/hash-verified current and previous-good artifacts, then run migration preflight, candidate start, readiness/business smoke, and rollback drill in an approved isolated target.                                          | No Production deployment, DNS/service mutation, or customer/provider traffic.                                                                   | `NOT STARTED` |
| `OM-16` | **Production cutover and bounded acceptance**  | Verify actual service/path/port mapping, backup and abort criteria; confirm every active legacy notification/PWA responsibility is preserved or owner-approved for retirement; obtain explicit approval; cut over once; run bounded business checks; roll back immediately on failed gates. | No implicit approval, uncontrolled dual-write, credential copying between environments, feature expansion, or silent notification-flow removal. | `NOT STARTED` |

### OM-D exit criteria

- Previous-good application and data compatibility are proven.
- Cutover, rollback, ownership, and recovery evidence are explicit.
- Tenant/config/delivery/entitlement/payment counts and invariants match the approved migration contract.
- Active legacy Telegram, notification, PWA, and operator responsibilities are either parity-proven or explicitly retired by an owner-approved decision; none disappears silently.
- Production acceptance is based on bounded business evidence, not process state or HTTP `200` alone.

## Deferred enhancements

The following are not Operational Migration slices and remain unauthorized until separately promoted from Enhancements:

- PIN/passkey product rollout;
- WhatsApp notification campaigns and PWA replacement;
- Google Sheets/Contacts projections;
- Saweria adapter/cutover;
- native mobile application;
- frontend/admin visual redesign;
- unrelated product expansion.

## Per-slice closure rule

Every slice follows this sequence:

```text
one owner-authorized Issue
  -> legacy/V2 parity matrix
  -> RED-GREEN minimum implementation
  -> proportional verification
  -> bounded review when risk requires it
  -> PR + green CI + squash merge
  -> Issue/ref/tree/cleanup parity
  -> durable local checkpoint
  -> exactly one next-slice recommendation + exact /new
  -> stop
```

The checkpoint format and required fields are defined in [`operational-migration-master.md`](operational-migration-master.md). Recommendation never equals authorization.

## Recommendation rule

Normally recommend the next numerical slice after all prerequisites are `VERIFIED`. If it is blocked, recommend the smallest prerequisite or immediate blocker resolution and explain why. Never jump to a deferred enhancement while a correctness, security, data-integrity, worker, migration, backup/restore, or rollback blocker remains on the active path.
