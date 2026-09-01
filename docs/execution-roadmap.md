# WARLIST V2 Execution Roadmap

> **Current execution authority:** WARLIST V2 has one unified, backend-first Operational Migration roadmap. There is no separate post-migration feature roadmap in the WARLIST 2.0 acceptance path.

## 1. Outcome

WARLIST 2.0 is complete only when the migrated backend, customer product, commercial path, operations, recovery, and cutover are integrated and verified as one directly usable system.

The required order is:

```text
landed backend/bot evidence
  -> runnable backend and disposable Baileys acceptance
  -> canonical identity, authentication, and onboarding backend
  -> usable customer Web
  -> Saweria billing and entitlement
  -> admin and Android Web/PWA-compatible customer access
  -> hosted operation, migration, and recovery
  -> immutable release and Production cutover
```

Backend and bot correctness remain first. Frontend, auth, payment, Android, and cutover work may not bypass missing backend contracts or safety gates.

## 2. Current verified baseline

**Canonical snapshot before this reconciliation:** `origin/main@80238506afac9824082fa81dd8cf8f406baf621b`.

### Backend Foundation

**Status:** `PARTIALLY VERIFIED`; not hosted or Production-operational.

The frozen PR #100 foundation plus later bounded overlays provide reusable TypeScript, PostgreSQL, automation, delivery/entitlement, identity, frontend, and worker seams. OM-15 adds one import-safe loopback runnable composition over injected repository/worker boundaries and the built Web. It does not prove concrete active-tenant boot, hosted operation, provider acceptance, deployment, or Production readiness.

### Operational Migration

**Status:** `OM-01`–`OM-18.8` are landed bounded slices at their recorded synthetic/local/disposable evidence ceilings. OM-A is closed only through `OM-11`; OM-B is `PARTIALLY VERIFIED` with `OM-12`–`OM-18.8` landed. Operational Migration as a whole remains `PARTIALLY VERIFIED`.

- `OM-01`–`OM-11`: Issues #132, #136, #140, #142, #146, #148, #150, #152, #154, #156, and #158.
- `OM-12`: Issue #164 / PR #165 / merge `d5dc513e81ab325203c60087f4b1bcdc4a9b09a6`.
- `OM-13`: Issue #166 / PR #167 / merge `fc54dddbce29aee01b5c3afe97ed55b7384ee75e`.
- `OM-14`: Issue #168 / PR #170 / merge `bcc41dfa2f73f75525b06a1feb2f09057e10e195`.
- `OM-15`: Issue #173 / PR #174 / merge `2b8b45dda237efcd7dd612cebf6eccc9f592ad94`.
- `OM-16`: Issue #176 / PR #177 / merge `42881098f466c973e9c1db571da3dbdf6eb48c94`.
- `OM-17`: Issue #178 / PR #179 / merge `98f9978a1649d4175b9cb7aa4d51f94772483ded`.
- `OM-18`: Issue #184 / PR #187 / merge `b2ba561339a07a2f10d0861274a85a9b3cc37834`.
- `OM-18.7`: Issue #192 / PR #193 / merge `35a1b95625151343ebc990f5d091c6e65411c91c`.
- `OM-18.8`: Issue #194 / PR #195 / merge `80238506afac9824082fa81dd8cf8f406baf621b`.

These are valid landed subsets and are not reopened or rewritten by this roadmap reconciliation. OM-18 proves one approved disposable pairing-code lifecycle; OM-18.7 proves one approved disposable QR scan to `OPEN`; OM-18.8 proves one approved isolated QR credential root resumes to `OPEN` after one controlled worker restart without another QR. These slices do not prove customer accounts, broader provider compatibility, hosted operation, customer migration, deployment, financial effect, or Production operation.

The public frontend foundation also exists through PR #124 and PR #130. It is preserved as landed foundation, not counted as integrated customer-product completion.

## 3. Owner-approved product corrections

The following decisions supersede older planning assumptions:

| Area                  | WARLIST 2.0 direction                                                                                                                                           | Superseded direction                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Roadmap               | One unified Operational Migration through usable 2.0                                                                                                            | Separate generic Enhancements/post-migration execution path         |
| End-user registration | Google OAuth through Supabase only                                                                                                                              | OPS ID + PIN registration                                           |
| End-user login        | Google, or verified WhatsApp number + WARLIST Password, on the same canonical Supabase user                                                                     | OPS ID/PIN as end-user credential                                   |
| Onboarding            | Complete resumable customer journey is required                                                                                                                 | Backend-only setup completion                                       |
| Frontend              | Fresh mobile-first Web built from zero is required                                                                                                              | Frontend redesign deferred beyond migration                         |
| Android access        | Mobile-first Web usability in Android browsers is part of OM; an installable PWA is optional; native APK/Play Store is outside scope unless separately approved | Android indefinitely deferred / native package implied              |
| Payment               | Saweria is the WARLIST 2.0 payment gateway                                                                                                                      | Pakasir stabilization as the V2 target                              |
| Gateway artifact      | Integrate the separately tested owner-provided Saweria gateway without modifying or re-auditing it unless explicitly requested                                  | Copying/rebuilding its implementation inside WARLIST                |
| Telegram/PWA push     | Retire after required responsibilities have approved replacements/dispositions                                                                                  | Porting legacy control or push implementation                       |
| Baileys recovery      | Missing, revoked, invalid, or untrusted session becomes `REPAIR_REQUIRED`; customer re-pairs                                                                    | Assuming provider credential restore is canonical business recovery |

The exact Google plus WhatsApp-password same-user flow remains a technical feasibility gate. It must be proven with official Supabase behavior and a disposable isolated account before implementation can claim the contract. It may not be approximated with duplicate WARLIST users, a shadow password database, or client-selected identity.

## 4. Unified phase board

| Phase | Range         | Purpose                                                                        | Status                                  |
| ----- | ------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| OM-A  | `OM-01–OM-11` | Core Baileys, delivery, entitlement, and cross-seam bot authority              | `VERIFIED` at bounded evidence ceilings |
| OM-B  | `OM-12–OM-20` | Landed runtime seams, runnable backend, and disposable real-Baileys acceptance | `PARTIALLY VERIFIED`                    |
| OM-C  | `OM-21–OM-30` | Canonical identity, Google/WhatsApp authentication, and onboarding backend     | `NOT STARTED`                           |
| OM-D  | `OM-31–OM-38` | Directly usable mobile-first customer Web                                      | `NOT STARTED`                           |
| OM-E  | `OM-39–OM-46` | Saweria checkout, settlement, reconciliation, and billing product              | `NOT STARTED`                           |
| OM-F  | `OM-47–OM-53` | Required admin product and Android Web/PWA-compatible access                   | `NOT STARTED`                           |
| OM-G  | `OM-54–OM-62` | Hosted operation, migration, backup/restore, and blank-host recovery           | `NOT STARTED`                           |
| OM-H  | `OM-63–OM-69` | Immutable release, Production migration, cutover, rollback, and acceptance     | `NOT STARTED`                           |

Detailed slice contracts, dependencies, acceptance criteria, and exclusions live in [`operational-migration-roadmap.md`](operational-migration-roadmap.md). Global parity, safety, evidence, checkpoint, and approval rules live in [`operational-migration-master.md`](operational-migration-master.md).

Phase letters are organizational groups inside this one roadmap. They are not separate products or a reason to defer required usability until after migration.

## 5. WARLIST 2.0 acceptance

`OM-69` may close WARLIST 2.0 only when all applicable phase exit criteria are landed and verified, including:

- the core bot path works through the approved real provider/account boundary without weakening delivery, entitlement, tenant, or credential safety;
- Google registration/login and WhatsApp-number/WARLIST-password login resolve to the same canonical user and tenant;
- complete onboarding, pairing/re-pair, dashboard, settings, status, entitlement, billing, and recovery journeys work through canonical server state;
- Saweria success credits the correct tenant entitlement exactly once and restart/reconciliation behavior is proven;
- required admin and Android-browser/mobile-Web outcomes are complete; an optional PWA is included only if separately approved;
- hosted operation, backup/restore, blank-host rebuild, `REPAIR_REQUIRED`, immutable artifact, rollback, and migration invariants are proven;
- explicitly approved Production cutover passes bounded business acceptance, not only process or HTTP checks.

Native Android APK/Play Store packaging, passkeys, Google Sheets/Contacts, notification campaigns, customer-service agents, multi-group expansion, and infrastructure scale-out are not WARLIST 2.0 acceptance requirements unless the owner later explicitly amends this authority. They are not silently scheduled in a second roadmap.

## 6. Current decision point

No implementation slice is active or authorized by this closure reconciliation.

**Exactly one next recommendation:** `OM-19 — Disposable live inbound-to-decision acceptance` after explicit approval for disposable group, admin, and message fixtures. Provider/account action and any isolated credential root still require specific approval in the authorized OM-19 Issue.

A recommendation is not authorization. Every implementation Issue remains bounded to at most two independently testable acceptance criteria. Real account/provider, hosted project, financial, customer-data, deployment, migration, rollback, or Production effects still require their explicit scope and approval at the slice where they occur.

## 7. Safety and authority

- Current source, tests, migrations, and executable schemas prove implemented behavior.
- This execution roadmap authorizes only the owner-approved roadmap direction; it does not make unimplemented slices complete.
- Historical plans and legacy Markdown remain evidence and provenance, not competing execution authority.
- Legacy Production `/home/marlo/warlist`, runtime/customer data, credentials, databases, logs, and protected paths remain untouched.
- No status wording authorizes Production, provider, account, credential, hosted, customer-data, financial, deployment, destructive, cutover, or rollback action by implication.
