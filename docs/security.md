# Security (As Built)

## Trust boundary

This repository contains source and synthetic tests only. It has no application credentials or Production integration.

The repository-boundary checker inspects tracked path names through Git and rejects protected runtime/customer path patterns without reading their contents. `.gitignore` is defense in depth, not the primary proof.

The local WhatsApp credential-directory adapter establishes only a machine-local path boundary. It requires an explicit canonical root and an exact tenant/generation/child owner, uses `0700` root/tenant directories plus one per-tenant `0600` empty exclusive lock, and rejects concurrent, foreign, stale, symlinked, replaced, or unsafe access with stable path-free errors. Socket creation, lazy Baileys key access, and credential saves run through the current infrastructure-only capability; stop waits for release. Only an exact-owner explicit reset may delete that tenant directory, and incomplete reset/release keeps the lock fenced. The adapter performs no credential-payload I/O, and neither the capability nor its absolute path may cross an API, IPC, diagnostic, log, repository, or hosted-database boundary.

The uncomposed OM-06 sender accepts only an exact bounded `ACCEPTED` input and invokes the current Baileys child sender only after the exact PostgreSQL claim and durable begin succeed for the trusted tenant/attempt/fence/worker identity. Its proof uses a fake socket only; it adds no provider retry, durable success evidence, credential, diagnostic payload, hosted database, or live provider effect.

CI must use read-only repository permissions, synthetic data, pinned actions, and no application/provider secrets. A secret finding must be removed from both the tree and Git history; adding it to `.gitignore` afterward is insufficient.

License, dependency, font, icon, and third-party attribution must be resolved before legacy assets or source are distributed from this repository.
