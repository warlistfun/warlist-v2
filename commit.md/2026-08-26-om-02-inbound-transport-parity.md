# OM-02 inbound event and transport-guard parity — 2026-08-26

## Scope

Issue #136 only. Added one concrete synthetic/local inbound `messages.upsert` path through the existing Baileys child, IPC v1, Node transport, runtime, diagnostics, normalizer, and evaluator seams. Added the tracked parity matrix at `docs/operational-migration/om-02-inbound-transport-parity.md` and completed the BF-08 simulator protected-path boundary.

## Files changed

- `src/modules/whatsapp/infrastructure/baileys-worker-child.ts`
- `src/interfaces/worker-ipc/contract.ts`
- `src/modules/whatsapp/infrastructure/node-worker-command-transport.ts`
- `src/modules/whatsapp/application/worker-runtime-service.ts`
- `src/modules/whatsapp/application/worker-diagnostics-service.ts`
- `src/debug-automation.ts`
- focused unit tests under `test/unit/`
- current-state/readme/roadmap docs and the OM-02 parity matrix

No legacy checkout, customer/runtime path, credential, provider, deployment, or Production state was changed.

## RED → GREEN evidence

- Existing checkpoint recorded the initial inbound tracer RED (`0 !== 1`) and requestId guard sabotage RED (`INVALID_MESSAGE` vs expected `HISTORY_REPLAY`).
- During final hardening, the blank-conversation quoted fallback test first went RED (`1 !== 0`), then passed after the child selected normalized conversation text before deciding whether quoted fallback applies.
- The protected-fixture symlink alias test first went RED (missing expected exception), then passed after canonicalizing the path before read.
- The official LID participant test first went RED (`0 !== 1`), then passed after accepting the official `@lid` participant form.
- Final focused proof passed **33/33** tests.

## Commands actually run

- `npm ci` — passed; 310 packages installed; 0 vulnerabilities reported by npm.
- `npm run lint` — passed.
- `npm run typecheck` — passed for root and web projects.
- `node --import tsx --test test/unit/baileys-inbound-event.test.ts test/unit/worker-ipc-contract.test.ts test/unit/worker-diagnostics-service.test.ts test/unit/automation-simulator.test.ts` — passed, 33/33.
- `npm run check` — passed: format, lint, typecheck, backend tests **276/276**, web tests **16/16**, build, and repository boundary (`163` tracked paths).
- `git diff --check` — passed.
- Final protected-path scan — no protected tracked or changed paths; no tracked symlinks or binary/runtime artifacts.
- Official dependency check — package declaration and installed package both report `@whiskeysockets/baileys@6.7.23`.

## Review and evidence ceiling

One bounded independent trust-boundary/async-lifecycle review returned **PASS — no material findings**. Its explicit residual ceiling matches the owner decision: only normalized bounded text may cross IPC; raw provider payloads, JIDs, provider message IDs, and all text in diagnostics remain prohibited. The reviewer modified no files and ran no external effect.

Synthetic/local product-parity evidence is bounded to transport guards and the existing normalizer/evaluator seam. Provider declarations are source-backed from the exact official 6.7.23 package. Real provider/account behavior, ordering under a live account, pairing, QR, credentials, network contact, customer/runtime data, outbound send, delivery/confirmation/entitlement, hosted DB, dev/staging, deployment, cutover, and Production remain `UNVERIFIED`/not run. The concrete child/transport remains uncomposed by a runnable application entrypoint (`PARTIALLY VERIFIED`).

## Recovery / rollback

Before publication, rollback is the complete local diff against `36f331dc645f1e288450205db66ced7dddd7e6aa`; do not reset unrelated checkouts. After publication, rollback requires a scoped reviewed revert/revert PR. No runtime/customer/credential state was created.

## Publication gate

Only after the review verdict is verified against the final diff: stage the exact intended files, commit with Issue #136 scope, push `feat/om-02-inbound-transport-parity`, create/read back the PR against `main`, wait for live CI, merge, comment Issue #136, verify closure/ref/tree parity, remove only the clean landed OM-02 worktree/branch, and write the final durable checkpoint with exactly one next-slice recommendation. Do not start OM-03.
