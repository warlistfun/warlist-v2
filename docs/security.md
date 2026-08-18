# Security (As Built)

## Trust boundary

This repository contains source and synthetic tests only. It has no application credentials or Production integration.

The repository-boundary checker inspects tracked path names through Git and rejects protected runtime/customer path patterns without reading their contents. `.gitignore` is defense in depth, not the primary proof.

CI must use read-only repository permissions, synthetic data, pinned actions, and no application/provider secrets. A secret finding must be removed from both the tree and Git history; adding it to `.gitignore` afterward is insufficient.

License, dependency, font, icon, and third-party attribution must be resolved before legacy assets or source are distributed from this repository.
