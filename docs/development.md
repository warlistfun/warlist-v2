# Development

## Setup

```bash
npm ci
npm run check
```

Use Node.js `^20.19.0`, `^22.13.0`, or `>=24`; Node 22 is primary. Direct dependencies are pinned exactly and `package-lock.json` is canonical.

## Workflow

1. Start from a bounded GitHub Issue.
2. Write one behavioral test and observe the expected failure.
3. Implement the minimum passing behavior.
4. Run the focused test and applicable full checks.
5. Review security, repository boundaries, compatibility, and docs.
6. Open a PR and report CI state honestly.

Do not copy legacy directories wholesale. Migrate behavior and individually reviewed source only when its owning slice begins.
