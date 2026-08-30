# WARLIST V2 Unified Operational Migration Contract

> **Status:** Canonical planning and execution contract. Current authorization lives in [`execution-roadmap.md`](execution-roadmap.md); sequence and slice status live in [`operational-migration-roadmap.md`](operational-migration-roadmap.md). This contract does not by itself authorize provider/account access, credentials, customer/runtime data, hosted configuration, financial effects, deployment, cutover, rollback, or Production changes.

## 1. Outcome

Migrate WARLIST incrementally into one directly usable WARLIST 2.0 while preserving valid backend/bot behavior, replacing owner-superseded product behavior, and keeping every important path deterministic, testable, debuggable, recoverable, and tenant-safe.

There is no separate post-migration implementation track in the WARLIST 2.0 acceptance path. The one roadmap ends only after:

```text
core bot and delivery authority
  -> runnable backend and approved provider acceptance
  -> canonical identity and authentication
  -> complete onboarding and customer Web
  -> Saweria billing and entitlement
  -> required admin and Android Web/PWA-compatible customer access
  -> hosted migration and disaster recovery
  -> immutable release and Production cutover
```

Backend correctness stays first. “Unified” does not authorize frontend, Android, billing, or Production work before their server contracts and safety prerequisites exist.

## 2. Authority and provenance

Authority is split deliberately:

1. [`execution-roadmap.md`](execution-roadmap.md) is the active execution authority.
2. This contract defines invariants, decision precedence, parity/change rules, evidence, safety, and closure protocol.
3. [`operational-migration-roadmap.md`](operational-migration-roadmap.md) owns the ordered slice board and status.
4. Current source, tests, executable schemas, migrations, and current-state docs prove as-built behavior.
5. Owner-approved product contracts decide intentional future behavior.
6. Legacy source/tests are read-only behavior references; protected runtime/customer/credential paths are never fixtures.
7. Issues, PRs, CI, merge commits, and checkpoints provide bounded evidence.
8. Historical plans and brainstorming are provenance and gap input only; they do not become scope by being written down.

Every decision-bearing artifact used by a slice must be classified before implementation:

| Provenance             | Meaning                                                   | Use                                                                                                                |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OWNER_FINAL`          | Explicit latest owner decision                            | Defines product direction unless technically impossible or unsafe; blockers must be reported, not silently changed |
| `CURRENT_AUTHORITY`    | Canonical roadmap/contract/accepted ADR                   | Governs work until explicitly reconciled                                                                           |
| `AS_BUILT_EVIDENCE`    | Current source/test/schema/runtime-safe proof             | Establishes what exists and its evidence ceiling                                                                   |
| `HISTORICAL_REFERENCE` | Old plan, legacy doc, checkpoint, commit note, brainstorm | May reveal requirements or risks; cannot authorize scope                                                           |
| `UNRESOLVED`           | Conflicting or insufficient evidence                      | Stop or preserve safe parity; obtain owner/technical decision                                                      |

A later owner-final decision may supersede planning text but does not erase valid landed evidence. Record both facts.

## 3. Owner-final WARLIST 2.0 product contract

### 3.1 Identity and authentication

WARLIST 2.0 uses:

- Google OAuth through Supabase for registration and login;
- Google as the initial recovery path;
- an optional verified WhatsApp number + **Kata Sandi WARLIST** login on the same canonical Supabase user;
- server-derived user, membership, and tenant authority;
- a separate admin authentication realm/capability boundary.

It does not use OPS ID or a short PIN as the end-user credential. OPS ID may remain a public identifier only.

New users register only through Google. Pairing proves initial control of the canonical WhatsApp number; pairing itself is not a WARLIST login session. The phone/password method can be activated only after successful Google registration and pairing. Google and WhatsApp login must resolve to the same canonical Supabase user and WARLIST tenant.

This exact same-user flow is `BLOCKED_ON_FEASIBILITY_PROOF` until official Supabase behavior plus a disposable isolated integration test proves it. No slice may “solve” the gap by creating duplicate WARLIST users, storing a shadow application password, trusting a browser-supplied phone number, auto-merging accounts, or weakening collision checks.

### 3.2 Customer product

The migration is not complete without a fresh, mobile-first customer product built from zero:

```text
public landing and legal pages
  -> Google registration/login or enabled WhatsApp login
  -> legal acceptance
  -> WhatsApp pairing
  -> activate WhatsApp login
  -> select group and admin
  -> configure trigger/keyword and schedule
  -> review and activate
  -> dashboard/status
  -> settings and bot control
  -> entitlement/history
  -> Saweria billing/payment state
  -> relink/REPAIR_REQUIRED recovery
```

Legacy screens and code are capability/content/failure-mode references only. Browser, Android-browser/PWA, and admin clients consume the same versioned WARLIST API and canonical server state. They never receive service-role credentials, choose tenant authority, or directly mutate privileged Supabase/business/provider state.

### 3.3 Android

Android access is inside Operational Migration through the required mobile-first responsive Web journey, verified in Android browsers. An installable PWA shell is optional and enters scope only if the owner approves it as the smallest useful delivery choice. A native Android APK/Play Store client is not a WARLIST 2.0 acceptance requirement unless the owner separately approves it. No client may create a second backend or client-side business authority.

Android is a client, not a second backend. It reuses identity, tenant, onboarding, billing, recovery, and business contracts.

### 3.4 Saweria

Saweria is the WARLIST 2.0 payment gateway. Pakasir-specific implementation is not the V2 target.

The already-tested artifact at `/home/marlo/Payment-Gateway-Saweria-WEBHOOK` remains separate. Do not modify or re-audit it unless the owner explicitly requests that. WARLIST integration owns only its side of the contract:

```text
checkout intent
  -> durable provider request identity
  -> gateway acceptance/status/signal
  -> authoritative WARLIST verification/reconciliation
  -> idempotent settlement
  -> tenant-scoped entitlement credit exactly once
  -> customer/admin status and recovery
```

Keep provider-specific transport behind the existing billing/application boundary. This is not permission to build speculative multi-provider infrastructure.

### 3.5 Retirement and explicit non-scope

Retire Telegram control/product coupling and legacy PWA push only after every active responsibility has a verified replacement or owner-approved retirement disposition. Do not automatically port Fonnte or legacy notification behavior.

Unless later promoted by an explicit owner decision, these are not WARLIST 2.0 acceptance requirements:

- native Android APK/Play Store client;
- passkeys/WebAuthn;
- Google Sheets or Contacts projections;
- WhatsApp notification campaigns;
- customer-service AI agent;
- multi-group/rule-set expansion;
- analytics expansion;
- microservices, Kubernetes, external brokers, or multi-region operation.

They do not require a second roadmap now.

## 4. Preserved behavior baseline

OM-01–OM-18 are landed bounded subsets. OM-A is closed only through OM-11; OM-12–OM-18 are landed subsets of OM-B, which remains open. OM-18's live evidence used pairing code; planned OM-18.7 owns the unverified live QR scan. Reconciliation may correct status documentation, but it must not reopen, renumber, diminish, or rewrite landed implementation history without a separately evidenced defect.

The core path remains:

```text
application boot
  -> discover canonical active tenant
  -> acquire current worker ownership
  -> start locally owned Baileys worker
  -> load/save protected local auth
  -> observe connection and pairing state
  -> receive and normalize inbound event
  -> evaluate automation gates
  -> acquire durable delivery authority
  -> perform at most the admitted external attempt
  -> persist SENT or AMBIGUOUS evidence
  -> admit/process confirmation
  -> consume entitlement atomically once
  -> apply exact committed config revision
  -> expose safe customer/operator state and recovery
```

Preserved product/business behavior includes group/admin/keyword ordering, bot/status/schedule gates, dedupe, daily entitlement rules, reply construction, delivery ambiguity, confirmation, and explicit operator-visible states unless the owner approves a change or a defect is proven.

## 5. Change classification

Every observable legacy/V2 difference must be classified before implementation.

| Class                   | Meaning                                                                                 | Required action                                                                |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PARITY`                | Intentional legacy behavior remains correct                                             | Preserve input, precedence, output, and side effects                           |
| `CONFIRMED_BUG_FIX`     | Legacy behavior reproducibly violates product/correctness/security/data/recovery intent | Minimum fix plus legacy/V2 regression evidence                                 |
| `SAFETY_HARDENING`      | Fail closed on malformed, unauthorized, timeout, concurrency, crash, or cleanup paths   | Prove normal happy path is preserved                                           |
| `OWNER_APPROVED_CHANGE` | Latest owner intentionally changes product behavior                                     | Implement the approved replacement and record supersession                     |
| `RETIRE`                | Responsibility is intentionally removed                                                 | Prove no active dependency remains or provide explicit replacement/disposition |
| `UNKNOWN`               | Evidence cannot resolve intent                                                          | Preserve safe parity or stop for a decision; never guess                       |

Confirmed security, tenant, credential, duplicate-send, double-credit, stale-authority, corrupt-persistence, replay, and unbounded-cleanup defects are not features to preserve.

Owner-approved changes in this roadmap include Google/WhatsApp authentication replacing OPS ID/PIN, Saweria replacing Pakasir as V2 provider, fresh customer UI from zero, Android-browser/mobile-Web access (with an optional approved PWA shell), and retirement of Telegram/legacy PWA push after responsibility disposition.

## 6. Mandatory slice evidence matrix

Every behavior slice includes:

| Prior source/contract            | Synthetic or approved transition                        | Prior/required result            | Classification    | Required V2 result                                | Evidence                                                                        |
| -------------------------------- | ------------------------------------------------------- | -------------------------------- | ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Exact symbol/path/owner contract | Invented fixture or explicitly approved isolated effect | Observed or owner-final behavior | One class from §5 | Preserved, corrected, replaced, or retired result | RED/GREEN test, command, browser run, provider acceptance, or bounded rehearsal |

Rules:

- inspect only the end-to-end path owned by the slice;
- use current V2 authority and source before historical plans;
- never use runtime/customer/credential data as fixtures;
- preserve known-good evidence even when old interpretation/status was stale;
- one happy example is not proof for error, timeout, restart, replay, accessibility, or recovery;
- unit tests do not prove browser/provider/hosted behavior;
- provider/account behavior remains `UNVERIFIED` until an explicitly approved isolated acceptance run exercises it.

## 7. Backend-first dependency gates

No client slice may fabricate a missing server contract.

### Runtime gate

Auth, onboarding, billing, admin, Web, and Android integration require one runnable non-Production backend with deterministic startup/shutdown, real listener/static composition, versioned runtime validation, truthful readiness, and safe diagnostics.

### Auth gate

Integrated auth UI requires canonical principal/session contracts, tenant derivation, collision denial, CSRF/cookie/session security, logout revocation, generic credential errors, brute-force controls, and the disposable same-user feasibility proof.

### Onboarding gate

Onboarding UI requires server-backed resumable stages, bounded pairing projection, canonical phone derivation, group/admin provenance, revisioned config, atomic activation, and `REPAIR_REQUIRED` recovery.

### Payment gate

Billing UI and financial smoke require durable order identity, persist-before-effect ordering, bounded gateway contracts, signal authenticity/replay protection, authoritative verification, idempotent transactional settlement, restart reconciliation, and manual-attention states.

### Android gate

Android-browser verification follows stable Web/API/auth/onboarding/payment/re-pair contracts. An optional PWA shell may share schemas and design tokens, but it cannot duplicate business logic or privileged state. Native Android packaging remains outside the 2.0 acceptance gate unless separately approved.

### Release gate

Customer migration and Production require tenant isolation, least privilege, backup/restore, business/credential separation, blank-host rebuild, old/new worker fencing, immutable artifacts, previous-good compatibility, rollback, and explicit approvals.

## 8. Anti-overengineering contract

Use the first rung that solves the authorized behavior:

1. Do not add code when an existing seam already represents the behavior.
2. Prefer Node.js/TypeScript/PostgreSQL/browser/native platform behavior before a new dependency.
3. Reuse pinned dependencies before adding another.
4. Add one concrete implementation for the current product path.
5. Extract an abstraction only for a second real use or a trust boundary.
6. Make the minimum explicit change that passes product, parity, and safety evidence.

Do not introduce without proven need:

- DI/service-locator/plugin frameworks;
- microservices, Kubernetes, Redis/broker, workflow engine, or distributed scheduler;
- a provider factory for Saweria alone;
- generic retry/reconciliation infrastructure before concrete failure semantics exist;
- duplicate worker, credential, normalizer, evaluator, delivery, ledger, auth, onboarding, billing, or API implementations;
- broad legacy rewrites or mass conversion;
- speculative config flags, tables, DTOs, components, services, or directories.

## 9. Slice contract

Each session owns exactly one bounded GitHub Issue and one externally meaningful vertical outcome.

- New OM implementation Issues freeze at most two independently testable acceptance criteria.
- Global parity, safety, verification, publication, cleanup, checkpoint, and handoff requirements are completion gates, not hidden AC.
- If a result cannot fit honestly into two AC, reslice before coding.
- One writer owns a slice; specialist audits/reviews may run independently.

Before implementation freeze:

- outcome and at most two AC;
- owner product contract and affected prior behavior;
- exact source/test/contracts in scope;
- evidence matrix rows;
- dependencies and explicit exclusions;
- external-effect/approval boundary;
- focused verification and CI expectations;
- concrete risk triggers requiring independent review;
- recovery/revert contract.

Behavior changes use RED-GREEN-REFACTOR:

1. write one failing behavioral test or observe an honest missing-path proof;
2. verify the intended RED;
3. implement the minimum GREEN result;
4. run focused checks;
5. inspect the exact diff and protected boundary;
6. publish the frozen diff promptly;
7. run remote CI and any risk-required review;
8. fix at most one bounded review/CI cycle before escalating a remaining blocker.

### Timebox

- Target PR-ready within 60 minutes of active engineering.
- At 60 minutes, stop optional research/refactor and reduce to the smallest complete outcome.
- At 90 minutes, stop implementation, leave the path safe, checkpoint, and recommend a smaller continuation.
- Only security, data-integrity, trust-boundary, or lifecycle correctness may justify the minimum safe extension.

Do not pull a later slice into the current Issue.

## 10. Debuggability and product proof

Every slice leaves the smallest real reproduction appropriate to its layer:

- focused test or safe synthetic command;
- browser path for user-visible behavior;
- disposable provider/account integration for provider claims;
- hosted isolated proof for hosted behavior;
- recovery/rollback rehearsal for operability claims.

Async boundaries expose stable safe state/error codes and correlation identity. Outputs exclude passwords, OAuth tokens, service-role keys, credentials, QR/pairing material, phone/JID/customer content, provider payloads, and unrestricted logs.

A process running, HTTP `200`, a screenshot, a unit test, a callback, or a successful local fixture is not whole-product correctness.

## 11. External-effect and data gates

Synthetic/fake transport and disposable local PostgreSQL evidence are allowed. These require explicit owner scope at the exact slice:

- real/disposable WhatsApp account pairing or credential creation;
- external inbound/outbound messages;
- Supabase project/OAuth/provider configuration;
- Saweria/gateway network or financial effect;
- hosted database/project mutation;
- legacy customer/runtime-data inspection or migration;
- deployment, restart, DNS/edge, cutover, rollback, or Production action.

Use only disposable accounts and invented data for approved acceptance before Production. Never type, print, commit, copy, or document secrets, passwords, OAuth tokens, QR, pairing material, phone/JID, customer messages, or raw provider payloads.

The Saweria gateway artifact remains unmodified and is not re-audited by WARLIST integration work unless explicitly requested.

## 12. Recovery contract

Canonical business database state is durable and must have tested backup/restore, portable export, migration invariants, and previous-compatible rollback.

Baileys auth is sensitive, local, revocable, and not canonical business state:

```text
local session intact and valid -> reuse under exact ownership
missing/corrupt/revoked/untrusted -> REPAIR_REQUIRED -> customer re-pairs
```

Do not promise cross-host auth continuity. Encrypted auth backup is a later optimization only after an isolated disposable-account drill proves encryption, key ownership, tenant-scoped restore, revocation, provider acceptance, and old/new worker fencing.

A clean-host recovery claim requires a measured rehearsal:

```text
fence old host/workers
  -> provision clean Linux host
  -> apply reproducible bootstrap
  -> deploy exact artifact digest
  -> restore/reconnect business database
  -> reuse valid local auth or mark REPAIR_REQUIRED
  -> verify readiness and business invariants
  -> switch approved edge origin
```

## 13. Completion and checkpoint protocol

A slice is complete only after:

- every AC is verified or honestly classified;
- focused evidence and remote CI pass, or unavailable infrastructure is classified truthfully;
- the smallest reproduction is recorded;
- risk-required review passes the exact current head with no material finding;
- PR file list/scope are verified;
- squash merge, Issue closure, live-main ref/tree parity, cleanup, and protected-state preservation are verified;
- current-state docs change only where reality changed.

Then write a durable local checkpoint unless publication is requested:

```text
docs/checkpoints/session-checkpoint-YYYY-MM-DD-om-NN-<slug>.md
```

Record outcome status, Issue/PR/refs/CI, classification matrix, real commands/results, files, reproduction path, external effects not run, residual risk, recovery, phase/slice status, and exactly one next-slice recommendation with prerequisites and exact `/new` prompt.

Stop after the checkpoint. Recommendation is not authorization.

## 14. Phase and WARLIST 2.0 closure

A merged slice never closes a phase. A phase closes only when all applicable slices and exit criteria are landed, evidence ceilings are explicit, current source/docs agree, and next-phase authorization is explicit.

WARLIST 2.0 closes only after all applicable OM-A through OM-H criteria are verified, including usable Web on desktop and Android browsers, auth/onboarding, Saweria, admin, hosted/recovery, migration, immutable release, rollback, and explicitly approved Production acceptance. An installable PWA or native Android package is not implied by this closure rule.

No unstarted future item is made complete by appearing in this contract. No missing provider, hosted, migration, browser, Android, recovery, or Production evidence may be inferred from lower-layer tests.
