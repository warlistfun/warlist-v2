# WARLIST V2 Execution Roadmap

> **Current execution authority:** This is the active roadmap for WARLIST V2. The older [phase roadmap](roadmap.md) and the durable backend master plan remain preserved historical planning/scope references; they do not authorize implementation beyond the owner-approved execution boundary below.

## 1. Backend Foundation — frozen baseline

**Status:** Frozen at PR #100 for an as-built audit.

This is the final owner-approved implementation baseline. It includes the landed work through PR #100:

- TypeScript modular-monolith composition, strict checks, synthetic-only CI, and repository boundaries.
- Resource-free worker lifecycle, IPC validation, diagnostics, generation/child fencing, and synthetic orchestration.
- Portable PostgreSQL schema/migrations, repository contracts, readiness/telemetry boundaries, and protected local credential-directory boundary.
- Pure automation normalization/evaluation, field-scoped config, exact-revision synchronization, and simulator.
- Delivery claim/fence/ambiguity handling, confirmation, entitlement ledger, and disposable PostgreSQL adversarial proofs.
- Atomic tenant enrollment, strict authenticated-principal tenant derivation, and cross-tenant IDOR authorization proof.

**Boundary:** This is a frozen execution baseline, not a claim that every former phase definition or Production/cutover requirement is technically complete. No additional implementation may be started before the as-built audit and a new explicit owner decision.

## 2. Operational Migration — not started

**Status:** Not started; requires a new explicit owner decision after the as-built audit.

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
