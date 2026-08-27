# WARLIST V2 Execution Roadmap

> **Current execution authority:** This is the active roadmap for WARLIST V2. The older [phase roadmap](roadmap.md) and the durable backend master plan remain preserved historical planning/scope references; they do not authorize implementation beyond the owner-approved execution boundary below.

## 1. Backend Foundation — frozen implementation baseline

**Status:** `PARTIALLY VERIFIED` and non-operational. PR #100 remains the frozen implementation baseline; separately authorized post-audit remediation evidence is recorded in the [as-built audit](backend-foundation-as-built-audit.md).

PR #100 is the frozen backend implementation baseline. Later separately authorized remediation and frontend slices are bounded overlays; they do not silently redefine or close the Backend Foundation. The baseline includes:

- TypeScript modular-monolith composition, strict checks, synthetic-only CI, and repository boundaries.
- Resource-free worker lifecycle, IPC validation, diagnostics, generation/child fencing, and synthetic orchestration.
- Portable PostgreSQL schema/migrations, repository contracts, readiness/telemetry boundaries, and protected local credential-directory boundary.
- Pure automation normalization/evaluation, field-scoped config, exact-revision synchronization, and simulator.
- Delivery claim/fence/ambiguity handling, confirmation, entitlement ledger, and disposable PostgreSQL adversarial proofs.
- Atomic tenant enrollment, strict authenticated-principal tenant derivation, and cross-tenant IDOR authorization proof.

**Boundary:** This is a frozen implementation baseline, not a claim that every former phase definition or Production/cutover requirement is technically complete. No additional implementation may be started without a new explicit owner decision for one bounded Issue.

## 2. Operational Migration — OM-01 through OM-06 verified subsets

**Status:** Issues #132 (`OM-01`), #136 (`OM-02`), #140 (`OM-03`), #142 (`OM-04`), #146 (`OM-05`), and #148 (`OM-06`) are verified synthetic/local slices. Operational Migration remains incomplete and no later slice is authorized.

The owner-requested planning contract is [`operational-migration-master.md`](operational-migration-master.md), and its phase/slice status board is [`operational-migration-roadmap.md`](operational-migration-roadmap.md). They require legacy-flow parity by default, explicit classification for every behavior difference, minimum non-speculative implementation, at most two acceptance criteria for every new Issue from `OM-03`, durable slice checkpoints, and exactly one next-slice recommendation. The resliced roadmap runs through `OM-44`, with 38 slices remaining (`OM-07`–`OM-44`); no later slice is authorized. OM-01 proves only the synthetic local lifecycle path, OM-02 adds only synthetic inbound guard/IPC/decision evidence, OM-03 adds only a synthetic pairing request with bounded onboarding-state projection, OM-04 adds only the local credential ownership/path boundary, OM-05 adds only fake-socket reconnect/logout/stop plus exact-owner explicit-reset parity, and OM-06 adds only a disposable-PostgreSQL-gated fake-socket send invocation without durable success evidence. None authorizes an external effect.

Potential work needed only if V2 is selected to replace legacy WARLIST operationally:

- concrete runtime composition, WhatsApp worker/process integration, and safe local credential lifecycle;
- canonical hosted database/configuration operation and observability;
- required admin operations and active billing/entitlement capability;
- read-only legacy inventory, migration/parity evidence, backup/restore, immutable release, cutover, and rollback.

This section is not authorization to design, implement, contact providers, migrate data, deploy, or change Production.

## 3. Enhancements — deferred

**Status:** Deferred; roadmap-only.

Potential later capabilities:

- session/token-family foundation and PIN/passkey rollout;
- user notifications and PWA retirement;
- Google Sheets/Contacts projections;
- Saweria adapter;
- other product/UI enhancements.

These items require an explicit owner decision and a separate bounded Issue before implementation.

## Authority and safety

- PR #100 is the final landed implementation in the frozen baseline.
- PR #102 was closed without merge; Issue #101 is `NOT_PLANNED`.
- The legacy phase roadmap and backend master plan are preserved for traceability and gap analysis.
- No status label here authorizes Production, runtime/customer-data, credential, provider, financial, deployment, or destructive action.
