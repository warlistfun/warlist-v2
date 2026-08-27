# WARLIST 2.0 Repository Rules

## Scope

- Work on one bounded GitHub Issue/slice at a time.
- Every new Operational Migration implementation Issue from `OM-03` onward has at most two independently testable acceptance criteria. Mandatory parity, safety, verification, publication, cleanup, checkpoint, and handoff gates remain global gates; do not pad a one-AC outcome or hide extra outcomes inside either AC.
- Operational Migration slices target PR-ready within 60 minutes of active engineering; at 90 minutes, stop, checkpoint, and recommend the remainder as a smaller owner-authorized Issue. Only security, data-integrity, trust-boundary, or lifecycle-correctness blockers justify the minimum necessary extension.
- Follow strict RED-GREEN-REFACTOR for behavior changes.
- Prefer the smallest explicit implementation; do not pre-create empty architecture.
- GitHub Issues, PRs, commits, tests, ADRs, and current-state docs are the change record.
- Operational Migration slices must follow `docs/operational-migration-master.md` and the current status/dependency order in `docs/operational-migration-roadmap.md`; preserve legacy product flow unless a difference is classified and evidenced under that contract.
- After a slice is fully closed, write and verify its durable checkpoint, recommend exactly one next slice with its prerequisites and exact `/new` prompt, then stop. A recommendation is not authorization to open or implement the next Issue.

### Execution-roadmap authority — mandatory for WARLIST V2

- `docs/execution-roadmap.md` is the active execution authority. Backend Foundation remains `PARTIALLY VERIFIED` and non-operational after the as-built audit; Operational Migration has verified synthetic/local `OM-01` through `OM-06` slices. Do not start another implementation slice unless a new explicit owner decision authorizes one bounded Issue.
- The durable WARLIST V2 backend master plan and `docs/roadmap.md` are preserved historical planning/scope references. Consult them for traceability and gap analysis; they do not authorize work beyond the execution roadmap.
- A merged Issue/PR or a verified bounded slice/foundation never proves a historical parent phase complete by itself. Do not create or claim historical phase closure without explicit reconciliation against the master plan.
- No status wording authorizes Production, migration/cutover, provider, credential, customer-data, deployment, or financial actions.
- Current guardrail: Phase 4 is **Supabase schema and repository foundation** in the master plan. Disposable local PostgreSQL evidence is a verified subset only; it is not Phase 4 closure evidence for the master plan.

## Hard boundaries

Never read from, copy, generate, commit, or use as fixtures:

```text
.env*
ops/
auth/
sessions/
logs/
data/
baileys/
qr/
uploads/runtime/
warlist-cache/
.baileys-backup/
backup/
node_modules/
*.db*
*.sqlite*
```

Use invented identifiers and reserved example domains. Never include customer data, phone/JID values, credentials, QR/session material, provider payloads, or secrets.

The legacy `/home/marlo/warlist` checkout serves Production. Do not edit it, change its remote, install dependencies there, restart its service, deploy it, or mutate runtime/customer/provider state without separate explicit approval.

## Architecture

- TypeScript strict; compile to CommonJS initially.
- Modular monolith with ports/adapters, no DI framework.
- Domain/application code must not import Express, database clients, Baileys, provider SDKs, process IPC, or concrete adapters.
- No import-time file writes, timers, connections, workers, listeners, provider calls, or environment reads outside future config/bootstrap boundaries.
- Runtime validation is required at untrusted boundaries when those boundaries are introduced.

## Verification

Before publication, obtain focused GREEN evidence for changed behavior and review the exact diff, secret/runtime-path findings, generated artifacts, Git history, and repository status. Once the diff is frozen, commit, push, and open/read back the PR immediately.

Remote PR CI is the default canonical gate. Do not run `npm ci` plus `npm run check` locally merely to duplicate CI; run the local canonical gate before publication only when another repository rule explicitly requires it, or after publication when CI is unavailable or a concrete failure needs diagnosis.

Independent review is required only for concrete auth, tenant-isolation, credential, payment/entitlement, schema/migration, concurrency/async-lifecycle, Production/release risk, or an explicit repository rule. Start one bounded reviewer after PR publication and concurrently with CI. A timeout leaves the PR published and blocks only merge; do not start a replacement reviewer in the same session. One surgical fix/re-review cycle is the ceiling.

A passing HTTP response or process state is not business correctness. Report VERIFIED, PARTIALLY VERIFIED, FAILED, UNVERIFIED, or BLOCKED honestly.

## Production

This repository has no Production deployment workflow during backend foundation. Adding deploy credentials, self-hosted runners, Production endpoints, or provider secrets requires a separately approved release design with rollback evidence.
