# WARLIST 2.0 Repository Rules

## Scope

- Work on one bounded GitHub Issue/slice at a time.
- Follow strict RED-GREEN-REFACTOR for behavior changes.
- Prefer the smallest explicit implementation; do not pre-create empty architecture.
- GitHub Issues, PRs, commits, tests, ADRs, and current-state docs are the change record.

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
