# Operations (As Built)

WARLIST 2.0 has no deployed runtime, service, environment, database, provider connection, or Production release process.

The only operational procedures are local/CI reconstruction and verification:

```bash
npm ci
npm run check
```

The legacy Production system is outside this repository's operational authority. No WARLIST 2.0 workflow may restart, deploy, call, or mutate it during the backend foundation.

Release, backup, restore, migration, readiness, and rollback procedures will be added only when implemented and verified.
