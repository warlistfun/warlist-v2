# WARLIST V2 Unified Operational Migration Roadmap

> **Status:** `OM-01`–`OM-18.8` are landed bounded slices at their recorded evidence ceilings. OM-A is closed only through `OM-11`; OM-B is `PARTIALLY VERIFIED` with `OM-12`–`OM-18.8` landed. `OM-19`–`OM-69` are `NOT STARTED`. Operational Migration as a whole remains `PARTIALLY VERIFIED`. No implementation Issue is active or authorized by this document alone.
>
> **Governing contract:** [`operational-migration-master.md`](operational-migration-master.md). Active authorization: [`execution-roadmap.md`](execution-roadmap.md).

## 1. One-roadmap rule

WARLIST 2.0 uses one backend-first Operational Migration roadmap. Phase letters group dependencies; they are not separate products or a post-migration feature track.

```text
OM-A  OM-01–OM-11  landed core bot/delivery evidence (closed subset)
  -> OM-B  OM-12–OM-20  landed runtime seams + runnable backend/disposable acceptance
  -> OM-C  identity, authentication, and onboarding backend
  -> OM-D  usable mobile-first customer Web
  -> OM-E  Saweria billing and entitlement
  -> OM-F  required admin and Android Web/PWA-compatible access
  -> OM-G  hosted operation, migration, and recovery
  -> OM-H  immutable release and Production cutover
```

Every new implementation Issue has one bounded outcome and at most two independently testable acceptance criteria. Global parity, safety, verification, review, CI, merge, cleanup, checkpoint, handoff, and approval requirements are not hidden AC.

## 2. Status and supersession

- `OM-01–OM-11` retain their original numbers, landed implementation, Issue/PR evidence, and bounded evidence ceilings; OM-A remains closed only at that boundary.
- `OM-12–OM-18.8` retain their original numbers and landed implementation as partially verified OM-B subsets; they do not close OM-B or the whole migration.
- The former planning-only `OM-15–OM-44` rows never started. They are superseded by the `OM-15–OM-69` board below; no implementation history is rewritten.
- The former Pakasir slices are replaced by Saweria slices. Provider-neutral financial safety invariants are preserved.
- OPS ID + PIN, deferred customer UI, and a separate post-migration roadmap are superseded by the owner-approved Google/WhatsApp auth, usable product, Android, and Saweria direction.
- PR #124 and PR #130 remain landed frontend foundations. They do not close any integrated product slice below.

### Status legend

| Status               | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `NOT STARTED`        | Planning only; no implementation authority or completion evidence           |
| `AUTHORIZED`         | Owner approved exactly one bounded Issue                                    |
| `IN PROGRESS`        | The authorized Issue has a real active handle                               |
| `PARTIALLY VERIFIED` | Useful evidence exists but the slice outcome is incomplete                  |
| `VERIFIED`           | Slice is landed; CI/review/closure/ref/tree/checkpoint evidence is complete |
| `BLOCKED`            | A named blocker and safe next resolution are recorded                       |
| `SUPERSEDED`         | An unstarted plan was replaced by a newer explicit decision                 |

A slice never closes its parent phase automatically.

## 3. Phase OM-A — Preserved core backend and bot authority

**Range:** `OM-01–OM-11`
**Status:** `VERIFIED` at bounded synthetic/local/disposable evidence ceilings
**Objective:** Preserve the already landed Baileys lifecycle, automation, delivery, entitlement, boot, ownership, and config authority foundations without pretending they form one runnable or Production-ready product.

| Slice   | Landed outcome                                     | Evidence                                                           | Ceiling                                                                         |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `OM-01` | Local Baileys connection lifecycle parity          | Issue #132 / PR #133                                               | Fake socket and temporary credential root                                       |
| `OM-02` | Inbound event and transport-guard parity           | Issue #136 / PR #137                                               | Synthetic inbound/fake transport                                                |
| `OM-03` | Pairing request and safe onboarding projection     | Issue #140 / PR #141; corrective Issue #162 / PR #163 / `ba6dc624` | Fake socket; no real pairing; pending-command correlation fence corrected later |
| `OM-04` | Local credential ownership boundary                | Issue #142 / PR #145                                               | Synthetic filesystem/ownership                                                  |
| `OM-05` | Reconnect, logout, stop, and explicit reset parity | Issue #146 / PR #147                                               | Fake socket and synthetic credential root                                       |
| `OM-06` | Database-gated one Baileys send invocation         | Issue #148 / PR #149                                               | Disposable PostgreSQL/fake socket                                               |
| `OM-07` | Durable `SENT` evidence and replay suppression     | Issue #150 / PR #151                                               | Disposable PostgreSQL/fake transport                                            |
| `OM-08` | Durable `AMBIGUOUS` evidence and recovery fence    | Issue #152 / PR #153                                               | Disposable PostgreSQL/fake transport                                            |
| `OM-09` | Confirmation admission and deduplication           | Issue #154 / PR #155                                               | Disposable PostgreSQL/fake transport                                            |
| `OM-10` | Atomic confirmation and daily entitlement debit    | Issue #156 / PR #157                                               | Disposable PostgreSQL/fake transport                                            |
| `OM-11` | Ambiguous delivery manual recovery                 | Issue #158 / PR #159                                               | Disposable PostgreSQL/fake transport                                            |

### OM-A exit verdict

- Core cross-seam traceability is preserved and not reopened.
- No real account/provider acceptance, runnable application, hosted operation, customer migration, financial effect, deployment, or Production behavior is inferred.
- Any future defect found in these paths requires one separately authorized corrective Issue; roadmap reconciliation alone is not evidence of a defect.

## 4. Phase OM-B — Runtime seams, runnable backend, and disposable Baileys acceptance

**Range:** `OM-12–OM-20`
**Status:** `PARTIALLY VERIFIED` — `OM-12`–`OM-19` landed; `OM-20` not started
**Objective:** Compose the preserved backend/bot seams into one runnable non-Production path, then prove the core automation outcome with an explicitly approved disposable WhatsApp account before auth/product work consumes it.

### Landed OM-B baseline — preserved, not reopened

| Slice     | Landed outcome                                   | Evidence                          | Ceiling                                                       |
| --------- | ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------- |
| `OM-12`   | Canonical active-tenant discovery                | Issue #164 / PR #165 / `d5dc513e` | Synthetic/local; no composed boot                             |
| `OM-13`   | Current worker ownership and restart fencing     | Issue #166 / PR #167 / `fc54dddb` | Synthetic/local; no provider authority                        |
| `OM-14`   | Monotonic worker config application and recovery | Issue #168 / PR #170 / `bcc41dfa` | Synthetic/local; no hosted config                             |
| `OM-15`   | Runnable application and loopback HTTP adapter   | Issue #173 / PR #174 / `2b8b45dd` | Local loopback; injected worker/repo                          |
| `OM-16`   | Concrete worker process and active-tenant boot   | Issue #176 / PR #177 / `42881098` | Synthetic/local; no provider account                          |
| `OM-17`   | Shutdown, readiness, and runtime diagnostics     | Issue #178 / PR #179 / `98f9978a` | Synthetic/local; no hosted operation                          |
| `OM-18`   | Disposable pairing-code lifecycle acceptance     | Issue #184 / PR #187 / `b2ba5613` | One approved disposable account                               |
| `OM-18.7` | Disposable QR pairing acceptance                 | Issue #192 / PR #193 / `35a1b95`  | One approved disposable QR scan to `OPEN`                     |
| `OM-18.8` | Disposable QR credential resume acceptance       | Issue #194 / PR #195 / `8023850`  | One approved root resumes after one controlled worker restart |
| `OM-19`   | Disposable live inbound-to-decision acceptance   | Issue #198 / PR #199              | One approved disposable group/admin/message fixture           |

These ten landed slices are evidence for OM-B, not phase closure.

### OM-15 — Runnable application and HTTP adapter composition

- **Prerequisites:** OM-01–OM-14; freeze the exact maintained HTTP adapter choice against current Node/TypeScript/API requirements before implementation.
- **Status:** `VERIFIED` at the local loopback/injected-adapter ceiling through Issue #173 / PR #174 / merge `2b8b45dda237efcd7dd612cebf6eccc9f592ad94`.
- **Acceptance criteria (2/2):**
  1. One explicit entrypoint composes the existing repository, application, worker, HTTP, and built-Web boundaries without import-time effects or duplicate business logic.
  2. One non-public listener serves the versioned API envelope and approved static/Web routes with runtime validation and deterministic startup-failure unwind.
- **Explicit exclusions:** No auth, customer state, real account, public deployment, hosted project, payment, or Production action.

### OM-16 — Concrete worker process and canonical active-tenant boot

- **Prerequisites:** OM-15.
- **Status:** `VERIFIED` through Issue #176 / PR #177 / merge `42881098f466c973e9c1db571da3dbdf6eb48c94` at its recorded synthetic/local ceiling.
- **Acceptance criteria (2/2):**
  1. The runnable application discovers canonical active tenants and starts each through the existing exact tenant/generation/child ownership and IPC path.
  2. Child exit, replacement, partial start, and unavailable tenant state remain fenced and cannot create duplicate current worker authority.
- **Explicit exclusions:** No real account/provider effect, customer/runtime data, hosted deployment, or Production start.

### OM-17 — Coordinated shutdown, readiness, and safe runtime diagnostics

- **Prerequisites:** OM-15–OM-16.
- **Status:** `VERIFIED` through Issue #178 / PR #179 / merge `98f9978a1649d4175b9cb7aa4d51f94772483ded` at its recorded synthetic/local ceiling.
- **Acceptance criteria (2/2):**
  1. Signal, repeated-stop, and partial-start paths execute one bounded reverse-order shutdown and leave workers/resources in explicit terminal states.
  2. Liveness, readiness, degradation, and correlated diagnostics truthfully distinguish process, database, worker, and provider ceilings without exposing sensitive material.
- **Explicit exclusions:** No public monitor, external account, deployment, credential content, customer data, or Production claim.

### OM-18 — Disposable account pairing and lifecycle acceptance

- **Prerequisites:** OM-15–OM-17; explicit disposable-account/provider approval; isolated credential root.
- **Status:** `VERIFIED` through Issue #184 / PR #187 / merge `b2ba561339a07a2f10d0861274a85a9b3cc37834` at its one approved disposable-account ceiling.
- **Acceptance criteria (2/2):**
  1. An approved disposable WhatsApp account completes pairing, credential save, open, retryable reconnect, terminal logout, and explicit reset/re-pair through the runnable path.
  2. Logs, IPC, API, diagnostics, and artifacts contain no QR, pairing material, credential payload, raw phone/JID, customer content, or unsafe provider payload.
- **Evidence ceiling:** The live acceptance used pairing code. Real QR generation and scan are verified only at the approved disposable/local ceiling through OM-18.7.
- **Explicit exclusions:** No customer account, Production credential, campaign, financial state, public deployment, or cross-host credential copy.

### OM-18.7 — Disposable QR pairing acceptance

- **Prerequisites:** OM-18; explicit disposable-account/provider approval for one QR scan; fresh isolated credential root.
- **Status:** `VERIFIED` through Issue #192 / PR #193 / merge `35a1b95625151343ebc990f5d091c6e65411c91c` at its one approved disposable-account ceiling.
- **Acceptance criteria (2/2):**
  1. One owner-approved disposable WhatsApp account completes a live QR scan through the concrete runnable Baileys path from a fresh isolated credential root; credentials are saved and the worker reaches `OPEN`.
  2. The raw QR is ephemeral, not persisted, and confined to a loopback-only acceptance surface; it never crosses worker IPC or the primary API and never appears in diagnostics, logs, repository content, screenshots, or test/CI artifacts.
- **Explicit exclusions:** No pairing-code retest or repeat of the OM-18 reconnect/logout/reset lifecycle; no customer/public Web, identity/onboarding, inbound/outbound message, customer/Production credential, deployment, or Production action.

### OM-18.8 — Disposable QR credential resume acceptance

- **Prerequisites:** OM-18.7; explicit disposable-account/provider approval for one QR scan; one fresh isolated credential root retained across exactly one controlled worker restart.
- **Status:** `VERIFIED` through Issue #194 / PR #195 / merge `80238506afac9824082fa81dd8cf8f406baf621b` at its one approved disposable-account ceiling.
- **Acceptance criteria (2/2):**
  1. With one owner-approved disposable WhatsApp account and one fresh isolated credential root, complete exactly one live QR scan through the concrete runnable Baileys path; stop the first worker after `OPEN`, then start a new worker against the same root and observe `OPEN` without offering or scanning another QR.
  2. During the bounded run, raw QR material remains ephemeral and loopback-only; it never crosses worker IPC, the primary API, diagnostics, logs, repository content, screenshots, or test/CI artifacts. After the resumed `OPEN`, stop the worker and remove the isolated credential root; verify cleanup without reading or retaining credential contents.
- **Provider/credential approval boundary:** Do not generate or scan a live QR, create credentials, or retain the root through the controlled restart without explicit owner approval naming that disposable-account/provider action and root scope.
- **Explicit exclusions:** No pairing-code retest; no reconnect/logout/reset/re-pair matrix; no inbound/outbound message, group fixture, customer account, public/hosted listener, Production credential, deployment, financial effect, customer data, or Production action.
- **Recovery/cleanup boundary:** On failure, stop the isolated worker and remove only the approved root. Never inspect, copy, restore, or retain credential contents; any retry needs fresh owner approval and a new root.

### OM-19 — Disposable live inbound-to-decision acceptance

- **Prerequisites:** OM-18.7–OM-18.8; explicit approval of disposable group, admin, and message fixtures.
- **Status:** `VERIFIED` through Issue #198 / PR #199 at its one approved disposable-group/admin/message ceiling.
- **Acceptance criteria (2/2):**
  1. One approved disposable live inbound event traverses transport guards, normalization, and the characterized automation gates to one correlated accepted/rejected result.
  2. History/replay, `fromMe`, wrong group/admin, malformed/no-text, stale/pre-connect, disabled, schedule, and no-entitlement cases produce the expected safe decision without unauthorized send.
- **Evidence:** One approved disposable bot reached `OPEN`; bounded initial `fromMe` synchronization events stopped at the transport guard, then the sole approved admin trigger in the isolated disposable group produced one correlated `FORWARDED → WRONG_GROUP` decision at config revision `1`. No delivery/send command or provider output occurred; bounded forced termination removed the exact isolated credential root and path absence was verified.
- **Evidence ceiling:** This proves one rejected live decision and the characterized safe guard matrix. It does not prove an accepted live decision, delivery, confirmation, entitlement mutation, graceful shutdown with an open pairing-browser connection, broader group/account compatibility, customer traffic, hosted operation, or Production.
- **Explicit exclusions:** No customer messages, broad traffic, billing, notification campaign, public deployment, or Production operation.

### OM-20 — Disposable delivery, confirmation, and entitlement acceptance

- **Prerequisites:** OM-19; explicit external-send approval for one bounded disposable case.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. One accepted disposable inbound event acquires current durable authority, performs at most one Baileys send, persists truthful `SENT`/`AMBIGUOUS` evidence, and processes an approved confirmation.
  2. Duplicate/replay/restart/stale-worker cases do not resend or double-debit; disposable evidence does not preserve a once-per-business-date eligibility rule and instead enforces the canonical timestamp ceiling of confirmed assignment plus the fixed nine-hour work duration plus configured cooldown.
- **Explicit exclusions:** No exactly-once network claim, customer account, campaign, billing provider, public deployment, or Production traffic.

### OM-B exit criteria

- One runnable non-Production backend exists with deterministic lifecycle, listener, static/API boundary, readiness, and diagnostics.
- The core bot journey is verified with a disposable account at its approved evidence ceiling.
- All real-account material is isolated, redacted, revocable, and never becomes repository or hosted business data.

## 5. Phase OM-C — Canonical identity, authentication, and onboarding backend

**Range:** `OM-21–OM-30`
**Status:** `NOT STARTED`
**Objective:** Build the server-side identity and onboarding contracts before integrated UI, using Google-only registration and optional WhatsApp-number/WARLIST-password login on one canonical Supabase user.

### OM-21 — Supabase same-user auth feasibility proof

- **Prerequisites:** OM-B; official current Supabase documentation; explicit isolated disposable-project approval.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A disposable proof determines whether one Google-created Supabase user can safely gain phone/password login while preserving the exact same user ID and without exposing admin/service-role authority to the client.
  2. Registration, phone collision, wrong password, logout/revocation, recovery, and phone-change results are recorded as `SUPPORTED`, `UNSUPPORTED`, or `REQUIRES_OWNER_REVISION` with no workaround hidden in implementation.
- **Explicit exclusions:** No Production Supabase project, customer identity, shadow password store, auto-merge, app source implementation, or live rollout.

### OM-22 — Canonical auth, membership, and session persistence

- **Prerequisites:** OM-21 `SUPPORTED` or an owner-approved revised contract.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Forward-only schema/repositories represent canonical Supabase user linkage, unique verified WhatsApp identity, membership, legal/onboarding state, and revocable session/auth provenance without storing end-user passwords.
  2. Constraints and adversarial PostgreSQL tests reject duplicate phone ownership, duplicate membership, client-selected tenant, partial enrollment, and cross-tenant access atomically.
- **Explicit exclusions:** No UI, Production user migration, service-role key in browser, real customer, passkey, or admin-auth implementation.

### OM-23 — Google-only registration and idempotent tenant creation

- **Prerequisites:** OM-22.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A verified Google/Supabase session creates or resumes exactly one WARLIST user, owner membership, and tenant idempotently; no phone/OPS/PIN registration path exists.
  2. Missing/forged/expired identity, collision, retry, and concurrent registration fail closed without trial, tenant, membership, or session drift.
- **Explicit exclusions:** No Web screen, WhatsApp login, pairing, customer migration, hosted Production project, or public rollout.

### OM-24 — Google login, logout, and browser-session security

- **Prerequisites:** OM-23.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Google login establishes a regenerated, bounded, server-validated session whose tenant comes only from canonical principal membership; logout revokes/destroys it completely.
  2. CSRF, cookie, expiry, unauthorized/forbidden, fixation, replay, rate-limit, and cross-tenant tests return stable generic errors without leaking identity existence or privileged state.
- **Explicit exclusions:** No UI, WhatsApp password, admin realm, customer migration, public rollout, or Production credential.

### OM-25 — Pair-derived WhatsApp identity binding

- **Prerequisites:** OM-24 and OM-18 lifecycle evidence.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Only the canonical number derived from a successful current pairing can bind to the authenticated Google-created user; browser-supplied number identity is never authoritative.
  2. Existing-owner collision, stale pairing, re-pair, concurrent bind, and retry fail closed without auto-merge, reassignment, duplicate user, or credential leakage.
- **Explicit exclusions:** No password activation, UI, customer account, OTP, notification number, or Production pairing.

### OM-26 — WhatsApp-number login activation and same-user proof

- **Prerequisites:** OM-21 `SUPPORTED`; OM-25.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A recently authenticated user activates a WARLIST Password for the verified paired number through Supabase Auth without storing/verifying that password in WARLIST business storage.
  2. Disposable integration proves Google login and WhatsApp-number/password login return the same Supabase user, WARLIST membership, and tenant; unknown number or wrong password cannot register or enumerate a user.
- **Explicit exclusions:** No OTP, OPS ID/PIN, app password database, auto-merge, customer account, or Production rollout.

### OM-27 — Auth recovery, phone change, and abuse controls

- **Prerequisites:** OM-26.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Google re-authentication resets WARLIST Password or changes the paired phone on the same user only after new pairing, recent-auth, and collision checks.
  2. Generic failures, throttling/progressive delay/CAPTCHA policy, session revocation, audit redaction, and recovery replay tests prevent enumeration and credential leakage.
- **Explicit exclusions:** No self-service recovery without Google, OTP, passkey, customer migration, or Production account action.

### OM-28 — Resumable onboarding and legal state contract

- **Prerequisites:** OM-23–OM-27.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Canonical server state represents versioned legal acceptance and resumable stages for account, pairing, WhatsApp-login activation, group/admin, rules/schedule, review, activation, and completion.
  2. Refresh/back/retry/expiry/conflict/concurrent-session tests resume from committed state and never let browser/local storage claim completion.
- **Explicit exclusions:** No UI, invented legal acceptance, provider effect beyond approved pairing seam, or customer migration.

### OM-29 — Server-side group, admin, and configuration provenance

- **Prerequisites:** OM-28 and a current connected disposable worker seam.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Safe group/admin directories plus target/admin/trigger/schedule and user-owned per-vendor cooldown writes validate current server-side provenance, bounded duration, and exact revision before commit.
  2. Missing/stale/forged/foreign membership, ambiguous trigger ownership, invalid cooldown, conflict, and provider unavailability preserve canonical state without partial activation or worker effect; canonical projections expose the fixed nine-hour work duration and server-derived next-eligible timestamp.
- **Explicit exclusions:** No UI, client-trusted JID/phone authority, broad provider scan, customer group, or Production effect.

### OM-30 — Atomic activation, re-pair, and onboarding closure

- **Prerequisites:** OM-28–OM-29.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Review/activation validates required committed stages and atomically reaches setup-complete, active config, entitlement eligibility, and current worker start without stale or partial state; confirmed assignment atomically advances per-user/per-vendor eligibility to assignment time plus nine hours plus the committed cooldown, including across business-date boundaries.
  2. Missing/invalid/revoked Baileys state becomes `REPAIR_REQUIRED`; re-pair resumes the same user/tenant/onboarding contract without credential restore, tenant duplication, or lost config.
- **Explicit exclusions:** No UI, mandatory cross-host credential backup, customer migration, public rollout, or Production action.

### OM-C exit criteria

- Google-only registration and both approved login methods resolve to one canonical user/tenant under disposable proof.
- Session, collision, tenant, legal, onboarding, pairing, activation, and `REPAIR_REQUIRED` contracts are server-owned and adversarially tested.
- No OPS ID/PIN end-user credential, browser tenant authority, duplicate-account workaround, or shadow password store exists.

## 6. Phase OM-D — Usable mobile-first customer Web

**Range:** `OM-31–OM-38`
**Status:** `NOT STARTED`
**Objective:** Complete the fresh customer Web against real approved backend contracts so WARLIST is usable from desktop and Android browsers before Android packaging/client expansion.

### OM-31 — Public legal surfaces and authenticated Web runtime

- **Prerequisites:** OM-15 and landed PRs #124/#130; owner-approved current legal copy.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The existing fresh Web foundation serves approved Terms, Privacy, and Refund surfaces plus conventional direct routes without copying legacy source or advertising unavailable behavior.
  2. Browser runtime consumes the canonical versioned API/error envelope and handles unavailable, unauthorized, stale, and route-error states accessibly at mobile and desktop widths.
- **Explicit exclusions:** No fake business API/data, auth UI, provider action, public deployment, CDN expansion, or Production publication.

### OM-32 — Google registration/login Web journey

- **Prerequisites:** OM-23–OM-24 and OM-31.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Formal-`Anda` registration/login, callback, route protection, logout, and session-expiry screens complete the real Google/Supabase path without handling Google passwords or privileged tokens.
  2. Cancelled, denied, expired, duplicate, retry, forbidden, and offline/stale paths show safe recovery and never claim tenant/session success before the server.
- **Explicit exclusions:** No WhatsApp login UI, onboarding, fake OAuth, customer identity, public deployment, or Production rollout.

### OM-33 — WhatsApp login and activation Web journey

- **Prerequisites:** OM-25–OM-27 and OM-32.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Login offers Google or enabled WhatsApp number + WARLIST Password, and post-pair activation clearly separates WARLIST Password from Google/WhatsApp credentials.
  2. Unknown/wrong/collision/re-auth/recovery/phone-change paths use generic accessible errors, recent-auth gates, canonical state, and no credential persistence in browser storage.
- **Explicit exclusions:** No OTP, OPS ID/PIN, fake account, customer credential, or Production rollout.

### OM-34 — Pairing, relink, and `REPAIR_REQUIRED` Web journey

- **Prerequisites:** OM-18.7, OM-25, OM-30, and OM-33.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Authenticated users complete bounded pairing-code/QR, expiry, open, relink, logout, and explicit repair flows using safe short-lived projections only.
  2. Refresh/back/retry/disconnect/terminal logout and `REPAIR_REQUIRED` states recover from canonical server state without exposing or caching QR, credential, phone/JID, or provider payload material.
- **Evidence boundary:** OM-34 verifies the customer Web journey over the provider seam; it does not replace or repeat OM-18.7 provider-level QR acceptance.
- **Explicit exclusions:** No customer credential fixture, automatic reset, cross-host credential restore, public deployment, or Production pairing.

### OM-35 — Group and admin selection Web journey

- **Prerequisites:** OM-29 and OM-34.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Connected users load safe current group/admin projections and commit one target plus valid admin ownership through server provenance and revision contracts.
  2. Empty/stale/disconnected/forged/conflict/retry paths preserve prior canonical selection and provide an accessible next action without client-authoritative identifiers.
- **Explicit exclusions:** No multi-group expansion, raw JID display, fake provider list, customer data, or Production effect.

### OM-36 — Trigger, schedule, review, and activation Web journey

- **Prerequisites:** OM-28–OM-30 and OM-35.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Users configure the approved admin trigger/keyword, time window, and their cooldown for each vendor, review exact pending state and server-derived next eligibility, and activate only through the atomic server completion contract.
  2. Validation, ambiguous trigger ownership, invalid cooldown, stale revision, retry, back/refresh, partial failure, and incomplete setup remain recoverable and never fabricate eligibility, completion, or worker success.
- **Explicit exclusions:** No new automation product rules, multi-rule sets, client-only validation authority, public deployment, or Production effect.

### OM-37 — Dashboard, status, settings, and bot control Web journey

- **Prerequisites:** OM-30 and OM-36.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The dashboard renders separate canonical setup, WhatsApp, bot, entitlement, freshness, and activity states; settings and bot control return the exact committed revision/state.
  2. Loading/empty/offline/stale/unauthorized/forbidden/conflict/degraded/disconnected/repair/retry paths preserve the last confirmed render without treating it as current truth.
- **Explicit exclusions:** No raw aggregate/credentials/logs, fake metrics, realtime infrastructure without need, billing UI, or Production publication.

### OM-38 — Entitlement/history Web and integrated Web hardening

- **Prerequisites:** OM-31–OM-37.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Users can inspect paginated entitlement/delivery history and understand balance, confirmed consumption, ambiguous/manual-attention, and empty states from safe canonical projections.
  2. End-to-end browser evidence covers auth through activation/dashboard/settings/history at agreed desktop and Android widths, keyboard/screen-reader semantics, 200% text, reduced motion, security headers, no overflow, and no secret/PII leakage.
- **Explicit exclusions:** No billing checkout yet, native Android package, analytics expansion, public deploy, customer data, or Production claim.

### OM-D exit criteria

- A disposable user can register/login, activate WhatsApp login, complete onboarding, pair/re-pair, activate the bot, use dashboard/settings, and inspect entitlement/history through real approved contracts.
- The Web is freshly built, mobile-first, accessible, and canonical-state-driven; it does not copy legacy implementation or fabricate unavailable state.
- Saweria billing remains the next backend-first dependency before commercial usability is complete.

## 7. Phase OM-E — Saweria billing and entitlement

**Range:** `OM-39–OM-46`
**Status:** `NOT STARTED`
**Objective:** Integrate the separately tested Saweria gateway into WARLIST's canonical billing/entitlement path and expose truthful customer payment behavior without modifying or re-auditing the gateway artifact.

### OM-39 — Saweria billing state and trust contract

- **Prerequisites:** OM-C; current integration contract for the separately tested gateway artifact.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Forward-only schema/repositories represent tenant-owned checkout intent, provider transaction/evidence, requested/final amount, expiry, status, idempotency, reconciliation, and manual-attention state independently of mutable tenant aggregates.
  2. Constraints and repository tests enforce tenant isolation, unique order/provider identity, monotonic terminal state, bounded amounts/days, persist-before-effect ordering, and transactional entitlement correlation.
- **Explicit exclusions:** No gateway modification/re-audit, network call, Pakasir adapter, multi-provider framework, UI, or financial effect.

### OM-40 — WARLIST-to-gateway adapter boundary

- **Prerequisites:** OM-39; exact approved gateway interface/version/deployment boundary.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. One narrow WARLIST adapter validates and maps checkout creation plus status/signal inputs from the existing Saweria gateway without importing its unofficial endpoint logic into WARLIST domain/application code.
  2. Synthetic timeout, malformed response, unknown outcome, duplicate signal, signature/timestamp/replay, and unavailable gateway cases produce bounded truthful evidence without credit or blind retry.
- **Explicit exclusions:** No modification or re-audit of `/home/marlo/Payment-Gateway-Saweria-WEBHOOK`, real transaction, Pakasir, speculative provider factory, or Production wiring.

### OM-41 — Idempotent Saweria checkout creation

- **Prerequisites:** OM-39–OM-40.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A validated tenant checkout command persists one intent before at most one gateway create call and returns only a bounded safe QR/payment projection.
  2. Idempotency reuse, unresolved-invoice limit, timeout, restart, conflicting input, and gateway error converge on canonical created/pending/ambiguous state without duplicate intent or charge assumption.
- **Explicit exclusions:** Fake gateway only unless separately approved; no real money, customer account, UI, or Production operation.

### OM-42 — Saweria signal and authoritative payment verification

- **Prerequisites:** OM-41.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Gateway signals are authenticated, timestamp/replay bounded, correlated to one current checkout, and treated as prompts for authoritative verification rather than financial truth.
  2. Malformed, forged, duplicate, out-of-order, wrong-amount/order, expired, unavailable, and conflicting evidence cannot terminally mark paid or credit entitlement.
- **Explicit exclusions:** No real financial mutation without approval, browser-trusted payment result, Pakasir, pricing change, or Production callback.

### OM-43 — Atomic Saweria settlement and entitlement credit

- **Prerequisites:** OM-42.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Verified paid evidence settles the exact tenant checkout and appends one correlated entitlement credit in one database transaction.
  2. Duplicate/concurrent/replayed/conflicting settlement and injected transaction failure return canonical state without double credit, partial payment, or ledger drift.
- **Explicit exclusions:** No manual balance edit, customer transaction, pricing expansion, coupon work, or Production financial effect.

### OM-44 — Restart reconciliation and manual attention

- **Prerequisites:** OM-41–OM-43.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Restart/outage recovery discovers durable creating/pending/ambiguous payments and reconciles them from gateway evidence without another checkout or guessed settlement.
  2. Expired, unavailable, inconsistent, and non-terminal evidence reaches a truthful retryable/manual-attention state with safe operator diagnostics and no balance drift.
- **Explicit exclusions:** No blind polling loop, guessed paid/expired truth, customer financial mutation, or Production scheduler.

### OM-45 — Customer billing and payment Web journey

- **Prerequisites:** OM-41–OM-44 and OM-D.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Authenticated users create one checkout and inspect safe creating/pending/paid/failed/expired/ambiguous/reconciling/payment-history states through canonical server confirmation.
  2. Refresh/back/offline/timeout/retry/duplicate-submit/expired-QR/manual-attention flows remain accessible and never treat browser redirect, local timer, QR disappearance, or gateway signal as paid truth.
- **Explicit exclusions:** No customer transaction without explicit isolated approval, direct gateway/browser call, fake success, public deployment, or Production billing.

### OM-46 — Approved disposable Saweria acceptance and phase closure

- **Prerequisites:** OM-39–OM-45; explicit minimum disposable financial scope/account/amount approval.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. One approved disposable Saweria transaction traverses checkout, gateway evidence, WARLIST verification, atomic settlement, entitlement credit, and customer status for the exact tenant once.
  2. Duplicate signal/reload/restart/reconciliation evidence proves no second charge intent or credit, and logs/artifacts contain no secret, credential, raw customer identity, or unsafe financial payload.
- **Explicit exclusions:** No Production money/account, campaign, gateway modification/re-audit, Pakasir, pricing rollout, or unbounded transaction testing.

### OM-E exit criteria

- Saweria is the only active WARLIST 2.0 payment target; Pakasir-specific V2 work is absent.
- Payment intent, evidence, settlement, entitlement, reconciliation, customer status, and approved disposable external behavior agree.
- A gateway callback/signal or browser state never becomes financial truth by itself.

## 8. Phase OM-F — Admin product and Android-browser access

**Range:** `OM-47–OM-53`
**Status:** `NOT STARTED`
**Objective:** Complete required owner operations and prove customer usability from Android browsers through the same API, identity, tenant, billing, and recovery contracts. An installable PWA shell is optional; native Android packaging is not implied.

### OM-47 — Distinct admin authentication and safe summary

- **Prerequisites:** OM-C, OM-E.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A distinct owner/admin principal, regenerated/revoked session, CSRF, throttling, capability middleware, and audit boundary protect all admin routes independently from customer auth.
  2. `/admin` renders only safe tenant/worker/finance summary DTOs; unauthorized, fixation, logout, IDOR, and redaction tests expose no raw aggregates, credentials, JIDs, paths, provider payloads, or unrestricted logs.
- **Explicit exclusions:** No shared admin/customer boolean, plaintext final credential, destructive action, direct store/provider call, or Production admin account.

### OM-48 — Admin tenant detail and diagnostics

- **Prerequisites:** OM-47.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Admin tenant list/detail and worker/payment diagnostics use canonical query services, bounded filters/pagination, freshness, stable state/error codes, and redacted audit identity.
  2. Cross-tenant, missing, stale, oversized, and unavailable queries fail safely without raw customer, credential, process, filesystem, or provider internals.
- **Explicit exclusions:** No mutation, unrestricted export/log browser, customer data fixture, or Production query.

### OM-49 — Admin stop, reset, and staged deletion

- **Prerequisites:** OM-47–OM-48 and current worker ownership/recovery contracts.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Stop/reset/re-pair operations require explicit capability, reason, current revision, idempotency, step-up/re-auth where applicable, terminal ownership proof, and audit evidence.
  2. Tenant deletion is staged/recoverable and cannot remove business or credential state from an HTTP handler; retry/partial failure/stale worker cannot revive or externally act for the tenant.
- **Explicit exclusions:** No immediate permanent delete, incidental credential deletion, customer/Production mutation, or hidden filesystem shortcut.

### OM-50 — Coupon and admin finance operations

- **Prerequisites:** OM-E and OM-47.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Customer coupon redemption and admin create/deactivate/list behavior use durable idempotent reservation/application/commit semantics and credit tenant entitlement exactly once.
  2. Admin finance/payment/coupon views and authorized recovery commands derive from canonical payment/ledger state with redacted audit evidence and no manual paid/balance truth.
- **Explicit exclusions:** No pricing expansion, direct database edit, Production financial mutation, Pakasir, or broad support export.

### OM-51 — Android browser compatibility and mobile interaction proof

- **Prerequisites:** OM-D, OM-E; stable versioned API and approved Web/API journeys.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The customer Web completes the approved auth, pairing/onboarding, dashboard, settings, bot-control, entitlement, and recovery journeys in agreed Android browsers without a second backend or client-side business authority.
  2. Android browser evidence covers viewport/orientation, touch targets, safe-area/keyboard behavior, back/refresh, text scaling, offline/stale, QR/pairing projection, and no horizontal overflow or secret leakage.
- **Explicit exclusions:** No native Android package, Play Store publication, service-worker push product, new backend, direct privileged Supabase mutation, customer credential, or Production distribution.

### OM-52 — Optional installable Web/PWA shell decision

- **Prerequisites:** OM-51 and the corresponding verified Web/API journeys; explicit owner approval before implementation.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The decision records whether an installable PWA shell reduces customer friction; no decision or a `NO_PWA` decision leaves the verified Android-browser path as the accepted delivery.
  2. If approved, the shell installs/updates and handles launch, offline/stale, session expiry, logout, and `REPAIR_REQUIRED` without storing secrets, adding push-campaign behavior, or changing canonical server state.
- **Explicit exclusions:** No native Android package, Android-only business logic, customer account, push notification product, public distribution, or Production effect.

### OM-53 — Cross-client billing, accessibility, and release-candidate proof

- **Prerequisites:** OM-45–OM-46 and OM-51–OM-52.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Android-browser users complete entitlement/history and Saweria checkout/status/reconciliation journeys with the same financial truth and idempotency as desktop Web.
  2. Browser/device evidence covers screen sizes, text scaling, keyboard/TalkBack semantics where available, touch targets, back/deep-link behavior, no-secret client state, and reproducible candidate Web assets; an approved PWA is tested by the same criteria.
- **Explicit exclusions:** No native Android package, Play Store/public release, push campaigns, analytics expansion, customer transaction, or Production distribution.

### OM-F exit criteria

- Required admin operations use distinct auth, safe DTOs, canonical services, staged destructive behavior, and audit evidence.
- Android-browser Web completes the required customer journeys through the same backend contracts; an approved PWA remains a thin delivery shell, not a second product backend.
- Native Android packaging and public distribution remain outside the 2.0 acceptance path unless separately approved; neither is inferred from a local candidate build.

## 9. Phase OM-G — Hosted operation, migration, and recovery

**Range:** `OM-54–OM-62`
**Status:** `NOT STARTED`
**Objective:** Prove hosted business operation, legacy migration, portable restore, `REPAIR_REQUIRED`, and blank-host recovery in isolation before Production.

### OM-54 — Isolated hosted business database and runtime roles

- **Prerequisites:** OM-B–OM-F; explicit isolated hosted-project approval; current official service limits.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. An isolated PostgreSQL/Supabase project applies current migrations through a migration role while runtime uses separate least-privilege credentials and configuration.
  2. Hosted tenant/RLS/role tests prove runtime cannot cross tenants, alter schema, obtain privileged auth/service authority, or access WhatsApp credentials.
- **Explicit exclusions:** No Production project, customer data, Baileys auth, public deployment, or cutover.

### OM-55 — Hosted pool, readiness, and outage behavior

- **Prerequisites:** OM-54.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Bounded pool, timeout, SSL/configuration, startup, shutdown, capacity, and readiness behavior is verified against healthy, unavailable, and recovered hosted states.
  2. Database degradation prevents unclaimed automation/payment/entitlement effects, exposes actionable safe state, and reconciles from durable authority after recovery.
- **Explicit exclusions:** No Production project, customer/provider effect, credential, public deployment, or cutover.

### OM-56 — Hosted runtime isolation and observability

- **Prerequisites:** OM-54–OM-55.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Application/worker boundaries sanitize child environment, isolate tenant credential volumes, deny source/backup/Podman-socket/other-tenant access, and run least-privileged/non-root where feasible.
  2. Structured logs, metrics, readiness, reconciliation, storage/capacity, and alert signals are actionable and redact identity, credentials, messages, payment payloads, and internal paths.
- **Explicit exclusions:** No Production host, customer data, external monitoring campaign, public deployment, or credential copy.

### OM-57 — Read-only legacy inventory and responsibility disposition

- **Prerequisites:** current safe legacy source/docs; explicit scope before any runtime/customer-data inspection.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Every allowed legacy source/schema responsibility has file-level relevance, licensing, sensitivity, and `MIGRATE`, `REPLACE`, `RETIRE`, or `EXCLUDE` disposition without reading protected values.
  2. Telegram, PWA push, Fonnte, Pakasir, notifications, admin, coupons, onboarding, payment, data, and operator responsibilities have explicit owner-approved V2 destinations; none silently disappears.
- **Explicit exclusions:** No protected value read, runtime/customer/credential access, code copy, deletion, dual-write, or Production mutation.

### OM-58 — Versioned synthetic legacy upcaster

- **Prerequisites:** OM-57 and current canonical schema.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A deterministic versioned upcaster transforms an invented legacy corpus into canonical user/tenant/config/entitlement/payment/coupon/delivery/audit migration records with source revision/checksum evidence.
  2. Unsupported, corrupt, duplicate, interrupted, and retried input fails safely or resumes without partial/duplicate canonical state.
- **Explicit exclusions:** No live customer/runtime value, Baileys credential migration, uncontrolled dual-write, or Production mutation.

### OM-59 — Migration counts, invariants, and resumability

- **Prerequisites:** OM-58.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Pre/post counts and ownership, config, entitlement, payment, coupon, delivery, identity, and audit invariants produce a redacted deterministic report and abort on mismatch.
  2. Repeated, interrupted, resumed, and rollback-compatible synthetic runs converge idempotently without loss, duplicate credit, duplicate tenant, or credential/business-state mixing.
- **Explicit exclusions:** No live customer data, credential migration, dual-write, destructive cleanup, or Production action.

### OM-60 — Business backup, restore, and portable database exit

- **Prerequisites:** OM-54–OM-59.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Versioned encrypted business-database export/restore reproduces schema revisions, approved counts/invariants, users/tenants/config/delivery/entitlement/payment/coupon/audit state in an isolated target.
  2. The PostgreSQL-portable exit path, retention, key ownership, restore ordering, and measured RPO/RTO evidence remain separate from Baileys credential/session handling.
- **Explicit exclusions:** No Production backup, customer data, Baileys auth archive, cross-environment copy, or cutover.

### OM-61 — Blank-host rebuild and `REPAIR_REQUIRED` recovery

- **Prerequisites:** OM-56 and OM-60; disposable clean Linux host.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. A clean host is reproducibly bootstrapped, receives an exact candidate artifact/config reference, reconnects/restores the isolated business database, and reaches truthful readiness within measured time.
  2. Valid local disposable auth may be reused under exact fencing; missing/corrupt/revoked/untrusted auth becomes `REPAIR_REQUIRED`, and customer re-pair restores service without duplicate worker authority or lost business config.
- **Explicit exclusions:** No Production host, mandatory auth backup/restore, customer credential, DNS switch, or public traffic.

### OM-62 — Isolated full migration, recovery, and rollback rehearsal

- **Prerequisites:** OM-54–OM-61.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. One isolated rehearsal runs synthetic export/upcast/import, hosted start, Web/Android-browser/admin/bot/Saweria-safe synthetic smoke, invariant report, and recovery from an induced interruption.
  2. An induced migration/startup failure executes the documented previous-compatible application/data rollback and verifies counts, readiness, business invariants, worker fencing, and repair states.
- **Explicit exclusions:** No Production backup/data, customer/provider traffic, real credential, public deployment, DNS, or cutover.

### OM-G exit criteria

- Hosted roles/isolation, pool/degradation, observability, legacy disposition, migration, restore, portable exit, blank-host rebuild, repair, and rollback are evidenced in isolation.
- Canonical business recovery never depends on restoring a possibly invalid Baileys session.
- RTO/RPO are measured from drills rather than guessed.

## 10. Phase OM-H — Immutable release and Production cutover

**Range:** `OM-63–OM-69`
**Status:** `NOT STARTED`
**Objective:** Build and promote one recoverable candidate, then replace legacy WARLIST at `warlist.fun` only after explicit Production/customer/provider/financial approval.

### OM-63 — Immutable artifact and release provenance

- **Prerequisites:** OM-G and clean canonical source.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. CI builds one reproducible immutable application/Web artifact with version, commit, dependency provenance, SBOM/license/boundary/secret checks, and verified digest; runtime/customer state is excluded.
  2. Current and previous-good artifacts plus schema/application compatibility are recorded and retrievable without rebuilding or mutating a source checkout.
- **Explicit exclusions:** No Production deploy, DNS/service mutation, customer/provider traffic, credential inclusion, or live install.

### OM-64 — Candidate runtime isolation and service definition

- **Prerequisites:** OM-56 and OM-63.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Versioned runtime/service definitions run the immutable artifact with explicit read-only application, protected writable state, resource limits, graceful shutdown, health/readiness, and least privilege.
  2. Worker/tenant volume, environment, network, process, socket, backup, source, and deploy-authority isolation tests prevent cross-tenant/host-management access and preserve repair/recovery boundaries.
- **Explicit exclusions:** No Production host mutation, customer credential, public deployment, or cutover.

### OM-65 — Isolated candidate preflight, start, and business smoke

- **Prerequisites:** OM-63–OM-64.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Migration, configuration, required-secret-presence, dependency, storage, capacity, compatibility, and ownership preflight fails closed before candidate start.
  2. The exact artifact starts without source mutation and passes readiness plus bounded synthetic Web/Android/admin/bot/payment/recovery business smoke.
- **Explicit exclusions:** No Production deploy, public DNS/edge, customer/provider traffic, real credential, or financial effect.

### OM-66 — Candidate previous-good rollback drill

- **Prerequisites:** OM-65.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Induced application, migration, readiness, and business-smoke failures trigger the documented bounded rollback to exact previous-good application/data compatibility.
  2. Post-rollback counts, invariants, worker fencing, readiness, Web/Android-browser/admin behavior, and `REPAIR_REQUIRED` recovery are verified without losing protected state.
- **Explicit exclusions:** No Production rollback, customer data, credential copy, provider traffic, or DNS mutation.

### OM-67 — Production path, edge, and responsibility inventory

- **Prerequisites:** OM-57 and OM-63–OM-66; read-only Production metadata scope.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Actual `warlist.fun` edge/origin, service, path, port, artifact, writable-state, database, secret-reference, monitoring, backup, and operator ownership are verified without exposing values.
  2. Every active legacy Telegram/PWA/Fonnte/Pakasir/notification/admin/customer/public-route responsibility has a verified replacement/retire/rollback disposition and compatibility redirect/content decision.
- **Explicit exclusions:** No dev/staging publication, Production mutation, credential/customer value read, DNS/service change, or silent responsibility removal.

### OM-68 — Production migration, backup, abort, and approval gate

- **Prerequisites:** OM-62–OM-67; explicit scoped read-only migration preflight approval.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. Integrity-verified business backup, migration manifest/checkpoint, counts/invariants, maintenance window, previous-good compatibility, worker fencing, abort thresholds, recovery owners, and rollback commands are frozen and independently reviewed.
  2. Production, customer-data, WhatsApp/provider, Saweria/financial, deploy, edge, cutover, and rollback approvals are explicit before any mutation; missing approval leaves the cutover blocked.
- **Explicit exclusions:** No implicit approval, uncontrolled dual-write, cross-environment credential copy, cutover mutation, or feature expansion.

### OM-69 — Production cutover and bounded WARLIST 2.0 acceptance

- **Prerequisites:** Every applicable OM-A–OM-H predecessor `VERIFIED`; OM-68 approvals; exact immutable candidate.
- **Status:** `NOT STARTED`.
- **Acceptance criteria (2/2):**
  1. The approved candidate migrates/cuts over once at `warlist.fun`; bounded counts/invariants plus approved Web, Android-browser, admin, bot, auth/onboarding, Saweria, repair, readiness, and observability checks decide acceptance.
  2. Any failed abort threshold immediately stops rollout and executes/verifies previous-good rollback; successful acceptance records exact evidence, residual risk, recovery state, and owner sign-off.
- **Explicit exclusions:** No dev/staging publication, feature expansion, implicit approval, uncontrolled dual-write, cross-environment credential copy, unbounded acceptance, or continued rollout after failure.

### OM-H exit criteria

- Artifact provenance, runtime isolation, preflight, candidate smoke, previous-good rollback, actual Production mapping, migration backup/abort, approvals, and cutover evidence agree.
- Required Web (including Android-browser usability) and optional approved PWA product, Google/WhatsApp auth, onboarding, bot, Saweria, admin, recovery, and observability outcomes work through canonical state.
- WARLIST 2.0 is accepted only from bounded business evidence and explicit owner sign-off, never from process state or HTTP `200` alone.

## 11. Explicitly unscheduled product ideas

These are not hidden post-migration phases and are not required for WARLIST 2.0 unless a later owner decision amends this authority:

- native Android APK/Play Store client;
- passkeys/WebAuthn;
- Google Sheets/Contacts projections;
- WhatsApp notification campaigns;
- customer-service AI agent;
- multi-group/rule-set expansion;
- analytics expansion;
- microservices, Kubernetes, broker, replicas, or multi-region operation.

Historical Markdown may remain as provenance. It does not authorize these ideas.

## 12. Per-slice closure rule

```text
one owner-authorized Issue with <= 2 AC
  -> provenance + prior/V2 evidence matrix
  -> RED-GREEN minimum implementation
  -> focused/proportional verification
  -> bounded review when concrete risk requires it
  -> PR + remote CI + squash merge
  -> Issue/ref/tree/cleanup parity
  -> durable local checkpoint
  -> exactly one next-slice recommendation + prerequisites + exact /new
  -> stop
```

A recommendation is not authorization. External/account/hosted/financial/customer-data/deployment/Production effects require explicit approval at the exact owning slice.

## 13. Current recommendation

**Recommended next slice:** `OM-20 — Disposable delivery, confirmation, and entitlement acceptance`.

**Ready because:** OM-19 composed canonical inbound decisions into the runnable worker path and proved one approved disposable live inbound event reaches a correlated safe rejection without delivery or send.

**Still excluded:** OM-20 implementation and any external send until separately authorized for one bounded disposable case; customer/runtime data, hosted deployment, billing provider, public traffic, and Production effects.

Stop after OM-19 is checkpointed. Do not open OM-20 in the same session.
