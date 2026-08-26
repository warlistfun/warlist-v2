# OM-01 local Baileys lifecycle parity

**Scope:** Issue #132. Synthetic fake socket and an isolated temporary credential root only. Real account/provider behavior remains unverified.

## Legacy/V2 parity matrix

| Legacy source/behavior                                                       | Synthetic transition                             | Legacy result                                                                                                        | Classification                   | Required V2 result                                                                                                                       | Evidence                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `lib/worker.js` `start()` lines 376–442                                      | `START_WORKER`                                   | Creates the local auth directory, loads multi-file auth state, creates one socket, and installs lifecycle listeners. | `PARITY`                         | Prepare only the tenant-scoped local directory, create one socket, and ACK through IPC.                                                  | `baileys-worker-child.test.ts`: concrete runtime → transport → child path    |
| `lib/worker.js` lines 433–436                                                | `creds.update`                                   | Calls Baileys `saveCreds()`.                                                                                         | `PARITY`                         | Call the injected auth save function; expose only `CREDENTIALS_SAVE_FAILED` on failure.                                                  | Focused credential-save and redaction assertions                             |
| `lib/worker.js` `_setupConnectionHandler()` lines 674–699                    | `connection.update: open`                        | Marks the worker open and emits status.                                                                              | `PARITY`                         | Emit correlated safe state `OPEN`; no raw update crosses IPC/diagnostics.                                                                | Focused safe diagnostic projection assertions                                |
| `lib/worker.js` lines 689–722                                                | Retryable close (for example status 408)         | Cleans the socket and reconnects after 2 seconds unless stopped.                                                     | `PARITY` plus `SAFETY_HARDENING` | Emit `CLOSED_RETRYING`, dispose listeners/socket, schedule one reconnect, and fence it after stop.                                       | Deterministic manual scheduler; canceled reconnect and late-event assertions |
| `lib/worker.js` lines 692–721                                                | Close with `DisconnectReason.loggedOut`          | Marks logged out and does not reconnect.                                                                             | `PARITY`                         | Emit terminal `LOGGED_OUT`, clean the socket, and schedule no reconnect.                                                                 | Deterministic status 401 fake-socket proof                                   |
| `lib/worker.js` `cleanupSocket()` lines 765–773 and `stop()` lines 1151–1181 | Stop during connected or pending-reconnect state | Removes listeners, closes the socket, clears timers, and becomes terminal.                                           | `PARITY` plus `SAFETY_HARDENING` | Cancel reconnect, remove lifecycle listeners, end once, emit `STOPPED`, ACK stop, and ignore late events; repeated runtime stop is safe. | Focused cleanup, late-event, and idempotent-stop assertions                  |

## Baileys v6.7.23 references

- Official annotated tag object: `v6.7.23` → `cdf9a1682d4b09079b2ceb1b8bb672f55a9dc12f`; it points to commit `e05b16b4aa0d7d3eb2594677e015454af1225b75`.
- Official `Example/example.ts`: `useMultiFileAuthState`, `makeWASocket`, reconnect unless `DisconnectReason.loggedOut`, and `creds.update` → `saveCreds` (lines 27–33, 72–86, 122–125).
- Official `src/Utils/use-multi-file-auth-state.ts`: tenant-directory auth state and `saveCreds()` writing `creds.json` (lines 33–38, 132–134).
- Exact dependency pinned: `@whiskeysockets/baileys@6.7.23`.

## Reproduction and limits

```bash
node --import tsx --test test/unit/baileys-worker-child.test.ts
```

The proof exercises no QR/pairing, inbound messages, outbound send, worker pool, hosted database, real credential, customer data, dev/staging, deployment, or Production path. Provider/account connectivity is **UNVERIFIED** by design.
