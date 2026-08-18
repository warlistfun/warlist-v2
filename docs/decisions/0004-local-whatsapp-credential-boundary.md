# ADR 0004: Keep WhatsApp Credentials Local

- **Status:** Accepted

## Context

Baileys auth/session material and live sockets are sensitive machine-local runtime state.

## Decision

Keep WhatsApp credentials, pairing material, sockets, and connection runtime on the bot server. Hosted business storage receives only safe projections.

## Alternatives

Store credential blobs in hosted PostgreSQL; copy credentials between environments.

## Consequences

Credential exposure and cross-environment contamination are reduced. Backup and cutover must coordinate local protected state separately.
