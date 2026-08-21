# Security (As Built)

## Trust boundary

This repository contains source and synthetic tests only. It has no application credentials or Production integration.

The repository-boundary checker inspects tracked path names through Git and rejects protected runtime/customer path patterns without reading their contents. `.gitignore` is defense in depth, not the primary proof.

The local WhatsApp credential-directory adapter establishes only a machine-local path boundary. It requires an explicit canonical root, exact tenant UUIDs, current-process ownership, and `0700` directories; rejects symlinks and unsafe paths with stable errors; and performs no credential-payload I/O. Its absolute directory handle is infrastructure-only and must never cross an API, diagnostic, log, or hosted-database boundary.

CI must use read-only repository permissions, synthetic data, pinned actions, and no application/provider secrets. A secret finding must be removed from both the tree and Git history; adding it to `.gitignore` afterward is insufficient.

License, dependency, font, icon, and third-party attribution must be resolved before legacy assets or source are distributed from this repository.
