# WARLIST 2.0 Repository Rules

## Scope

- Work on one bounded GitHub Issue/slice at a time.
- Follow strict RED-GREEN-REFACTOR for behavior changes.
- Prefer the smallest explicit implementation; do not pre-create empty architecture.
- GitHub Issues, PRs, commits, tests, ADRs, and current-state docs are the change record.

### Execution-roadmap authority — mandatory for WARLIST V2

- `docs/execution-roadmap.md` is the active execution authority. Its Backend Foundation is frozen at PR #100 pending as-built audit; do not start implementation unless a new explicit owner decision authorizes one bounded Issue.
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

Before commit and push, run:

```bash
npm ci
npm run check
```

Also review the staged diff, secret/runtime-path findings, generated artifacts, Git history, and repository status. A passing HTTP response or process state is not business correctness. Report VERIFIED, PARTIALLY VERIFIED, FAILED, UNVERIFIED, or BLOCKED honestly.

## Production

This repository has no Production deployment workflow during backend foundation. Adding deploy credentials, self-hosted runners, Production endpoints, or provider secrets requires a separately approved release design with rollback evidence.
