# OM-06 database-gated Baileys send

**Scope:** Issue #148. Invented identifiers, disposable PostgreSQL 16, and one fake Baileys socket only.

## Legacy/V2 parity matrix

| Legacy source/behavior                                                               | Classification                   | Required V2 result                                                                                                                                                                     | Evidence                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `lib/worker.js` prepares delivery and persists `SENDING` before `sock.sendMessage()` | `PARITY` plus `SAFETY_HARDENING` | An `ACCEPTED` synthetic input must win the existing PostgreSQL claim and exact durable begin before the Baileys sender can run.                                                        | `om-06-baileys-delivery-authority.test.ts` valid-authority path |
| Legacy process-local replay/lock guard                                               | `SAFETY_HARDENING`               | PostgreSQL admits one concurrent claimant; unavailable persistence, duplicate work, or stale/foreign tenant, operation, attempt, fence, generation, or child identity invokes nothing. | Focused disposable-PostgreSQL concurrent/stale matrix           |
| Legacy calls `sock.sendMessage(target, { text })` once after admission               | `PARITY`                         | The existing claim seam passes one immutable bounded correlation/worker/delivery envelope to the current Baileys child, which calls its injected fake socket at most once.             | Exact-envelope and fake-socket call assertions                  |

## Evidence ceiling

```bash
node --import tsx --test test/integration/om-06-baileys-delivery-authority.test.ts
```

This proof does not settle `SENT`, persist provider identity, suppress replay after success, add retry/confirmation/billing, or compose an application runtime. Those OM-07-or-later outcomes remain outside OM-06. No real account, provider/network, credential, customer/runtime data, hosted database, dev/staging, deployment, financial state, or Production action was used.
