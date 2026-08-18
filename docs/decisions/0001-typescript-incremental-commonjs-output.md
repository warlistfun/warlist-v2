# ADR 0001: TypeScript with Initial CommonJS Output

- **Status:** Accepted

## Context

Legacy WARLIST is CommonJS JavaScript. Combining architecture, language, and module-system migrations would increase risk.

## Decision

All new backend code is strict TypeScript compiled to CommonJS initially. Existing behavior migrates incrementally.

## Alternatives

ESM immediately; remain JavaScript; mass conversion.

## Consequences

Runtime compatibility stays simpler while TypeScript improves contracts. ESM remains a separate future decision.
