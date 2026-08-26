# WARLIST V2 Operational Migration Roadmap

> **Status:** `OM-01 VERIFIED`; `OM-02 VERIFIED`; `OM-03 VERIFIED`; `OM-04 VERIFIED`; Operational Migration remains incomplete. This planning/status board is governed by [`operational-migration-master.md`](operational-migration-master.md). Every new implementation Issue from `OM-03` onward has at most two independently testable acceptance criteria and still requires a new explicit owner decision.

## Two-AC reslice summary

- Verified history: `OM-01`–`OM-04`.
- Roadmap range: `OM-01`–`OM-44`.
- Remaining work: 40 slices, `OM-05`–`OM-44`.
- Phase ranges: OM-A `OM-01`–`OM-11` (7 remaining), OM-B `OM-12`–`OM-29` (18), OM-C `OM-30`–`OM-38` (9), OM-D `OM-39`–`OM-44` (6).
- The 14 former unstarted slices each used an Issue ceiling of five AC. Preserving that ceiling as `2 + 2 + 1` originally yielded `14 × 3 = 42` post-`OM-02` Issues without padding a one-AC outcome or increasing scope.
- This reslice changes only Issue size and numbering after `OM-02`; the established parity, safety, external-effect, verification, PR/CI/merge, cleanup, checkpoint, recommendation, prerequisite, exact `/new`, and stop flow remains unchanged.
- Mandatory global gates are not extra AC, and hidden sub-AC are forbidden. If current evidence makes a planned outcome unnecessary, the roadmap must be corrected explicitly rather than padding its Issue.

The former post-`OM-02` labels were planning-only and never started, so they are superseded as follows:

| Former planned slice | Current at-most-two-AC slices |
| -------------------- | ----------------------------- |
| `OM-03`              | `OM-03–OM-05`                 |
| `OM-04`              | `OM-06–OM-08`                 |
| `OM-05`              | `OM-09–OM-11`                 |
| `OM-06`              | `OM-12–OM-14`                 |
| `OM-07`              | `OM-15–OM-17`                 |
| `OM-08`              | `OM-18–OM-20`                 |
| `OM-09`              | `OM-21–OM-23`                 |
| `OM-10`              | `OM-24–OM-26`                 |
| `OM-11`              | `OM-27–OM-29`                 |
| `OM-12`              | `OM-30–OM-32`                 |
| `OM-13`              | `OM-33–OM-35`                 |
| `OM-14`              | `OM-36–OM-38`                 |
| `OM-15`              | `OM-39–OM-41`                 |
| `OM-16`              | `OM-42–OM-44`                 |

## Status legend

- `NOT STARTED` — no implementation authority or landed evidence.
- `AUTHORIZED` — owner approved one bounded Issue; no completion claim.
- `IN PROGRESS` — the authorized Issue is being implemented.
- `PARTIALLY VERIFIED` — useful landed evidence exists but the slice exit criteria are incomplete.
- `VERIFIED` — slice is landed and its closure/ref/tree/checkpoint evidence is complete.
- `BLOCKED` — cannot proceed safely; blocker and immediate resolution are recorded.

A slice status never closes its phase automatically. Numerical order is the default dependency order unless the owner explicitly approves a different recorded dependency.

## Current decision point

- Backend Foundation remains `PARTIALLY VERIFIED` and non-operational.
- Issues #132 (`OM-01`), #136 (`OM-02`), #140 (`OM-03`), and #142 (`OM-04`) are verified synthetic/local slices; none closes Operational Migration or OM-A.
- No WhatsApp provider, credential, hosted database, customer, deployment, financial, or Production action is authorized.
- No slice after `OM-04` is authorized. The next recommendation is `OM-05`, not permission to start it.

## Phase OM-A — Core WhatsApp/Baileys path

**Range:** `OM-01–OM-11`. **Remaining:** 7.

**Objective:** Reproduce the legacy WhatsApp automation path through the existing V2 seams, one observable behavior at a time, without changing product flow or performing a bulk worker rewrite.

### OM-01 — Local Baileys connection lifecycle parity

- **Source scope:** landed OM-01.
- **Status:** `VERIFIED` — Issue #132; local fake-socket evidence only.
- **Acceptance criteria:** Historical landed Issue; the new two-AC ceiling is not retroactive.
- **Explicit exclusions:** No inbound automation, pairing UI, outbound send, pool, hosted DB, or real account without separate approval.

### OM-02 — Inbound event and transport-guard parity

- **Source scope:** landed OM-02.
- **Status:** `VERIFIED` — Issue #136; local synthetic evidence only.
- **Acceptance criteria:** Historical landed Issue; the new two-AC ceiling is not retroactive.
- **Explicit exclusions:** No external send, confirmation, product redesign, or duplicate evaluator.

### OM-03 — Pairing request and safe onboarding projection

- **Source scope:** landed OM-03.
- **Status:** `VERIFIED` — Issue #140; local fake-socket evidence only.
- **Acceptance criteria (2/2):**
  1. A synthetic pairing request reaches the current Baileys child through the existing runtime/IPC identity fence and exposes only the bounded onboarding state required by the characterized legacy flow.
  2. Repeated request, open, close, and terminal-stop transitions are deterministic without QR/pairing material, credential payload, JID, or raw provider update in diagnostics.
- **Evidence:** [`operational-migration/om-03-safe-pairing-projection.md`](operational-migration/om-03-safe-pairing-projection.md).
- **Explicit exclusions:** No real account pairing, customer credential, provider send, hosted DB, or Production effect.

### OM-04 — Local credential ownership boundary

- **Source scope:** former OM-03.
- **Status:** `VERIFIED` — Issue #142; local synthetic-filesystem/fake-socket evidence only.
- **Acceptance criteria (2/2):**
  1. Exactly one current tenant/generation owner may use its tenant-scoped local credential root; concurrent, foreign, and stale owners fail closed.
  2. Path hardening and owner-only permissions prevent root escape or credential payload leakage across IPC, diagnostics, and repository boundaries.
- **Evidence:** [`operational-migration/om-04-local-credential-ownership.md`](operational-migration/om-04-local-credential-ownership.md).
- **Explicit exclusions:** No Production auth copy, PostgreSQL/Supabase credential storage, customer credential, or unapproved filesystem cleanup.

### OM-05 — Reconnect, logout, and explicit reset parity

- **Source scope:** former OM-03.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Retryable reconnect, terminal logout, stop, and explicit reset preserve the characterized legacy outcome while deleting only the fenced current root; ordinary pairing/status actions never delete auth state implicitly.
- **Explicit exclusions:** No real account action, Production auth copy, customer credential, provider send, or unrelated filesystem cleanup.

### OM-06 — Delivery claim to one Baileys send invocation

- **Source scope:** former OM-04.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. An `ACCEPTED` decision must acquire current database delivery authority before any sender call; unavailable persistence, duplicate work, or stale tenant/attempt/fence/worker identity invokes nothing.
  2. One valid authority invokes the concrete Baileys sender at most once with correlated bounded input through the existing delivery seam.
- **Explicit exclusions:** Synthetic/fake transport only unless a disposable account/group and external send are separately approved; no retry, confirmation, or billing change.

### OM-07 — Durable sent evidence and replay suppression

- **Source scope:** former OM-04.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A successful concrete send persists the bounded provider-identity projection and truthful `SENT` outcome under the same current attempt/fence before completion is reported.
  2. Duplicate delivery, restart, and replay observe durable `SENT` evidence and perform no second provider invocation.
- **Explicit exclusions:** No raw provider identity in diagnostics, blind retry, confirmation, entitlement debit, or exactly-once provider claim.

### OM-08 — Ambiguous send evidence and recovery fence

- **Source scope:** former OM-04.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Timeout, crash, unknown provider outcome, restart, and stale-worker races persist and preserve `AMBIGUOUS` manual-reconciliation evidence without automatic resend, closing the affected `BF-10` boundary for this path.
- **Explicit exclusions:** No automatic ambiguous resend, bulk notification, billing change, or Production provider traffic.

### OM-09 — Confirmation admission and durable deduplication

- **Source scope:** former OM-05.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Only a valid confirmation correlated to the current tenant/delivery/attempt is admitted; malformed, foreign, and stale confirmations fail closed.
  2. Duplicate, out-of-order, and post-restart confirmations converge on one durable confirmation outcome without another send.
- **Explicit exclusions:** No entitlement debit, new confirmation product rule, provider switch, or customer/provider action without separate approval.

### OM-10 — Atomic confirmation and entitlement debit

- **Source scope:** former OM-05.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Confirmation settlement and the existing daily entitlement debit commit atomically once under current tenant/delivery authority.
  2. Concurrent duplicate, replay, and injected transaction failure prove rollback and prevent double debit or balance drift.
- **Explicit exclusions:** No pricing/rule change, payment-provider change, manual balance mutation, or Production financial effect.

### OM-11 — Ambiguous delivery manual recovery parity

- **Source scope:** former OM-05.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Ambiguous delivery, restart, replay, and authorized manual resolution converge to an allowed terminal delivery/entitlement state without automatic resend or debit.
- **Explicit exclusions:** No automatic ambiguous resend, new operator product flow, provider switch, or Production mutation.

### OM-A exit criteria

- One correlated path is traceable from worker start through inbound decision, send evidence, confirmation, and entitlement outcome.
- Legacy normal-flow results are parity-tested; every difference is classified under the master contract.
- Raw credentials, QR/pairing material, JIDs, provider message IDs, and provider payloads stay inside the protected adapter boundary; only the explicitly authorized bounded projection may cross IPC.
- Real provider/account behavior remains `PARTIALLY VERIFIED` until separately approved isolated acceptance evidence exists.

## Phase OM-B — Operational application parity

**Range:** `OM-12–OM-29`. **Remaining:** 18.

**Objective:** Replace the operational responsibilities around the core worker without reintroducing Telegram coupling, direct persistence, duplicate business logic, or unsafe operator behavior.

### OM-12 — Canonical active-tenant discovery

- **Source scope:** former OM-06.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Boot discovers only canonical active tenants using the existing repository contract and preserves tenant isolation.
  2. Inactive, malformed, unavailable, or unauthorized tenant records start no worker and expose only safe bounded evidence.
- **Explicit exclusions:** No config mutation, provider effect, hosted deployment, or Production start.

### OM-13 — Current worker ownership and restart fencing

- **Source scope:** former OM-06.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Each active tenant has exactly one current worker owner with correlated tenant/generation/child identity.
  2. Restart and replacement fence stale owners and recover the current owner without duplicate provider authority.
- **Explicit exclusions:** No config application, provider effect before authority, hosted deployment, or Production change.

### OM-14 — Monotonic config application and recovery

- **Source scope:** former OM-06.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Workers apply and recover only the exact committed config revision; stale rollback and unscoped full-record propagation fail closed, resolving affected `BF-06`/`BF-07` boundaries.
- **Explicit exclusions:** No provider effect before authority, speculative config transport, hosted deployment, or Production change.

### OM-15 — Runnable application startup composition

- **Source scope:** former OM-07.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. One explicit V2 entrypoint composes existing repository, worker, and HTTP lifecycles in deterministic start order without import-time effects.
  2. Startup failure unwinds only started resources in reverse order and returns a bounded safe failure.
- **Explicit exclusions:** No process-manager change, public environment, deployment, or Production claim.

### OM-16 — Coordinated shutdown and lifecycle recovery

- **Source scope:** former OM-07.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Shutdown signals trigger one coordinated reverse-order stop and reach a terminal state without abandoning resources.
  2. Repeated stop, partial-start shutdown, and bounded cleanup failure remain deterministic and recoverable.
- **Explicit exclusions:** No process-manager change, deployment, public environment, or Production action.

### OM-17 — Truthful readiness and safe diagnostics

- **Source scope:** former OM-07.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Readiness remains distinct from liveness and correlation-based diagnostics expose only closed safe states/errors across starting, healthy, degraded, and failed dependencies, resolving the runtime portion of `BF-03`.
- **Explicit exclusions:** No public monitoring endpoint, deployment, process-manager change, credential/customer/raw-provider data, or Production claim.

### OM-18 — Trusted enrollment identity and tenant authority

- **Source scope:** former OM-08.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Enrollment derives tenant authority from the authenticated principal; client-selected tenant or owner identity cannot override it.
  2. Cross-tenant, duplicate, and ownership-collision attempts fail closed with safe audit evidence and no partial enrollment.
- **Explicit exclusions:** No PIN/passkey rollout, customer migration, default shared credential, or UI redesign.

### OM-19 — Server-side group and admin provenance

- **Source scope:** former OM-08.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Current server-side group/admin provenance is validated before enrollment or automation ownership is accepted.
  2. Missing, stale, forged, or foreign provenance blocks atomically without partial state or provider effect.
- **Explicit exclusions:** No client-trusted group/admin identity, real provider lookup without approval, customer migration, or product redesign.

### OM-20 — Atomic onboarding completion and retry recovery

- **Source scope:** former OM-08.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. The characterized registration/setup outcome commits required tenant/config/worker state atomically and retry-safe, resolving relevant ownership, expiry, decoder, and collision boundaries (`BF-12`/`BF-13`).
- **Explicit exclusions:** No PIN/passkey rollout, customer migration, UI redesign, or provider effect without authority.

### OM-21 — Authenticated session and dashboard-read parity

- **Source scope:** former OM-09.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Required legacy login/session and dashboard-status outcomes are served from canonical V2 state under trusted authenticated identity.
  2. Expired, unauthorized, missing, and cross-tenant requests return bounded safe user-visible errors without state or provider mutation.
- **Explicit exclusions:** No PIN/passkey rollout, visual redesign, mobile app, billing implementation, or direct database/provider access.

### OM-22 — Authenticated config mutation parity

- **Source scope:** former OM-09.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Required automation configuration reads and commits run through canonical application services with exact-revision state.
  2. Stale, conflicting, invalid, and failed mutations preserve canonical state and the characterized safe user-visible outcome.
- **Explicit exclusions:** No visual redesign, direct database/provider access, worker control, billing implementation, or new product flow.

### OM-23 — Authenticated worker status and control parity

- **Source scope:** former OM-09.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Required worker status/control operations and runtime failures preserve the characterized user-visible outcomes through canonical V2 services.
- **Explicit exclusions:** No visual redesign, direct database/provider access, billing implementation, mobile app, or new product flow.

### OM-24 — Owner/admin tenant list and detail parity

- **Source scope:** former OM-10.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Required owner/admin dashboard and tenant/OPS list/detail reads come from canonical services with characterized filters and status outcomes.
  2. Safe DTO and authorization evidence prevents raw aggregate, log, credential, or cross-tenant exposure.
- **Explicit exclusions:** No broad admin redesign, direct store/provider call, customer-data migration, or credential operation.

### OM-25 — Owner/admin worker reset and staged deletion

- **Source scope:** former OM-10.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Required worker status, stop, and reset actions use current lifecycle ownership and never delete credential state directly from an HTTP handler.
  2. Staged deletion is authorized, auditable, dependency-aware, and fail-safe across retry or partial failure.
- **Explicit exclusions:** No broad admin redesign, immediate destructive deletion, raw credential access, or Production customer-state mutation.

### OM-26 — Owner/admin finance and coupon parity

- **Source scope:** former OM-10.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Required finance/coupon views and mutations preserve existing product semantics, authorization, balance/coupon invariants, and safe audit evidence through canonical services.
- **Explicit exclusions:** No pricing change, provider switch, real financial mutation without approval, or admin redesign.

### OM-27 — Pakasir checkout creation and ambiguous outcome

- **Source scope:** former OM-11.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A validated idempotent checkout command persists its intent before one injected Pakasir create call.
  2. Success, timeout, and provider error persist truthful created or ambiguous evidence without duplicate checkout intent.
- **Explicit exclusions:** Fake provider only unless financial/provider mutation is separately approved; no Saweria, pricing change, or multi-provider framework.

### OM-28 — Pakasir verification and idempotent settlement

- **Source scope:** former OM-11.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Verification/callback admission validates current checkout identity and authenticity before applying settlement.
  2. Duplicate, out-of-order, replayed, or conflicting settlement cannot double-credit entitlement or drift the ledger/balance.
- **Explicit exclusions:** No real financial mutation without approval, pricing change, Saweria switch, or speculative provider abstraction.

### OM-29 — Pakasir restart reconciliation and integrity

- **Source scope:** former OM-11.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Restart, outage, conflict, and retry reconcile pending/ambiguous checkout state from canonical provider evidence without another charge or balance drift, resolving `BF-11` before hosted financial operation.
- **Explicit exclusions:** No real financial mutation without approval, Saweria switch, pricing change, or guessed ambiguous settlement.

### OM-B exit criteria

- Required user and operator flows no longer depend on Telegram-owned orchestration or direct legacy store/provider calls.
- One runnable non-Production composition reports truthful readiness and safe diagnostics.
- Active config, tenant identity, worker ownership, billing, and entitlement transitions are durable and recoverable.
- Every active Telegram-owned responsibility is preserved through V2 services or explicitly retired by an owner-approved product decision.
- Product-visible differences have explicit owner approval; confirmed legacy defects have regression evidence.

## Phase OM-C — Hosted operation and migration rehearsal

**Range:** `OM-30–OM-38`. **Remaining:** 9.

**Objective:** Prove V2 can operate against the selected hosted database and migrate legacy business state recoverably without touching Production or mixing credential environments.

### OM-30 — Isolated hosted project and runtime-role proof

- **Source scope:** former OM-12.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. An owner-approved isolated PostgreSQL/Supabase project uses current official limits and least-privilege runtime roles.
  2. Hosted RLS/tenant-isolation tests prove the runtime role cannot cross tenant boundaries or obtain schema/secret authority outside its contract.
- **Explicit exclusions:** No Production project, customer data, WhatsApp credential, deployment, or cutover.

### OM-31 — Hosted pool, readiness, and degradation proof

- **Source scope:** former OM-12.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Bounded pool, timeout, configuration, and readiness behavior is verified against the isolated hosted project under healthy and unavailable states.
  2. Monitoring plus pause/read-only/degraded behavior stays actionable and fail-safe without admitting unauthorized external effects.
- **Explicit exclusions:** No Production project, customer data, WhatsApp credential, deployment, provider effect, or cutover.

### OM-32 — Hosted backup, restore, and portable exit

- **Source scope:** former OM-12.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Export/restore and the PostgreSQL-portable exit path reproduce schema revisions, approved counts/invariants, and credential separation in an isolated target under current hosted-plan constraints.
- **Explicit exclusions:** No Production backup/project, customer data, WhatsApp credential, deployment, or cutover.

### OM-33 — Read-only legacy inventory and disposition

- **Source scope:** former OM-13.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The allowed legacy source/schema surface has a file-level relevance, licensing, sensitivity, and parity inventory without reading protected values.
  2. Every inventoried item has one evidenced disposition—migrate, replace, retire, or exclude—with protected/runtime/customer/credential paths default-denied.
- **Explicit exclusions:** No live customer/runtime read, credential access, code copy, destructive cleanup, dual-write, or Production mutation.

### OM-34 — Versioned synthetic legacy upcaster

- **Source scope:** former OM-13.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A versioned deterministic upcaster transforms an invented legacy corpus into the current migration contract with explicit source revision/checksum evidence.
  2. Unsupported, corrupt, duplicate, interrupted, and retried input fails safely or resumes without partial/duplicate canonical state.
- **Explicit exclusions:** No live legacy value, customer/runtime data, credential migration, dual-write, or Production mutation.

### OM-35 — Migration counts, invariants, and resumability

- **Source scope:** former OM-13.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. Pre/post counts and business invariants produce a safe report; repeated/interrupted synthetic runs resume idempotently and abort on any mismatch.
- **Explicit exclusions:** No live customer/runtime read, credential migration, destructive cleanup, dual-write, or Production mutation.

### OM-36 — End-to-end synthetic export/import rehearsal

- **Source scope:** former OM-14.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A synthetic business export/import rehearsal uses the approved versioned migration contract.
  2. The imported candidate passes the approved pre/post invariant report in an isolated environment.
- **Explicit exclusions:** No Production backup copy, real credential, provider traffic, public deployment, or customer data.

### OM-37 — Separated backup, restore, and restart recovery

- **Source scope:** former OM-14.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Business-database and local-credential backup manifests remain coordinated but separate, with no credential payload crossing the database path.
  2. Integrity-verified restore reaches the expected readiness and restart-recovery state in isolation.
- **Explicit exclusions:** No Production backup copy, real credential, provider traffic, public deployment, or customer data.

### OM-38 — Previous-compatible rollback rehearsal

- **Source scope:** former OM-14.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. An induced migration/startup failure executes bounded rollback to a previous-compatible state and verifies post-rollback invariants, readiness, and restart recovery.
- **Explicit exclusions:** No Production backup copy, real credential, provider traffic, public deployment, or customer data.

### OM-C exit criteria

- Hosted behavior, capacity/degradation, runtime roles, backup, restore, and PostgreSQL exit path are evidenced in isolation.
- Synthetic legacy migration is resumable, checkpointed, and produces an explicit pre/post invariant report.
- Business database state and local credential state have coordinated but separate recovery procedures.

## Phase OM-D — Immutable release and cutover

**Range:** `OM-39–OM-44`. **Remaining:** 6.

**Objective:** Produce a recoverable release candidate and replace legacy WARLIST only after explicit Production approval.

### OM-39 — Release enforcement and artifact provenance

- **Source scope:** former OM-15.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The `BF-04` branch/release enforcement risk is resolved for the candidate path and release starts from a reviewed clean canonical commit.
  2. Current and previous-good artifacts are reproducible, immutable, provenance-recorded, and hash-verified before use.
- **Explicit exclusions:** No Production deployment, DNS/service mutation, customer/provider traffic, or credential inclusion.

### OM-40 — Candidate preflight, start, and bounded smoke

- **Source scope:** former OM-15.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Migration, configuration, required-secret-presence, dependency, and capacity preflight fails closed in an approved isolated target.
  2. The immutable candidate starts without source-checkout mutation and passes readiness plus bounded synthetic business smoke.
- **Explicit exclusions:** No Production deployment, DNS/service mutation, customer/provider traffic, or real credential.

### OM-41 — Candidate previous-good rollback drill

- **Source scope:** former OM-15.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. An induced failed candidate gate executes documented application/data rollback and verifies previous-good readiness, bounded smoke, counts, and recovery invariants.
- **Explicit exclusions:** No Production deployment, DNS/service mutation, customer/provider traffic, or real credential.

### OM-42 — Production path and responsibility inventory

- **Source scope:** former OM-16.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Actual service/path/port ownership and dependency mapping are verified against the approved cutover target.
  2. Every active legacy notification, PWA, and operator responsibility has a verified preserve-or-owner-approved-retire disposition.
- **Explicit exclusions:** No cutover mutation, implicit approval, customer/provider traffic, credential copy, or silent responsibility removal.

### OM-43 — Production backup, abort, and approval gate

- **Source scope:** former OM-16.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Integrity-verified backups, previous-good compatibility, abort thresholds, and recovery ownership are frozen before cutover.
  2. All required Production, customer/provider, financial, cutover, and rollback approvals are explicit before any mutation begins.
- **Explicit exclusions:** No implicit approval, cutover mutation, uncontrolled dual-write, credential copying between environments, or feature expansion.

### OM-44 — Production cutover and bounded acceptance

- **Source scope:** former OM-16.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (1/2):**
  1. The explicitly approved immutable candidate cuts over once; bounded business/count/invariant gates decide acceptance and any failed gate immediately executes and verifies previous-good rollback.
- **Explicit exclusions:** No feature expansion, implicit approval, uncontrolled dual-write, cross-environment credential copy, unbounded acceptance, or continued rollout after failure.

### OM-D exit criteria

- Previous-good application and data compatibility are proven.
- Cutover, rollback, ownership, and recovery evidence are explicit.
- Tenant/config/delivery/entitlement/payment counts and invariants match the approved migration contract.
- Active legacy Telegram, notification, PWA, and operator responsibilities are parity-proven or explicitly retired by an owner-approved decision; none disappears silently.
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

Every slice keeps the existing sequence:

```text
one owner-authorized Issue with at most 2 AC
  -> legacy/V2 parity matrix
  -> RED-GREEN minimum implementation
  -> proportional verification
  -> bounded review when risk requires it
  -> PR + green CI + squash merge
  -> Issue/ref/tree/cleanup parity
  -> durable local checkpoint
  -> exactly one next-slice recommendation + prerequisites + exact /new
  -> stop
```

The checkpoint format and required fields remain defined in [`operational-migration-master.md`](operational-migration-master.md). Recommendation never equals authorization.

## Recommendation rule

Normally recommend the next numerical slice after all prerequisites are `VERIFIED`. If it is blocked, recommend the smallest prerequisite or immediate blocker resolution and explain why. Never jump to a deferred enhancement while a correctness, security, data-integrity, worker, migration, backup/restore, or rollback blocker remains on the active path.
