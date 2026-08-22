# ADR 0006: Durable Delivery Claims and Ambiguous Outcomes

- **Status:** Accepted; Phase 6 synthetic/PostgreSQL foundation implemented

## Context

External WhatsApp delivery cannot provide application-level exactly-once guarantees, especially across crashes and retries.

## Decision

Require one durable winning claim before send, fence stale workers, persist attempt identity, and classify unknown crash-after-send outcomes as ambiguous. The implemented synthetic/PostgreSQL foundation verifies the exact current UUID tenant worker, advances an operation fence, creates a bound attempt, persists `SENDING` before the injected sender, settles `SENT` or `AMBIGUOUS`, and confirms `SENT` with a replay-safe once-per-WIB-date ledger debit. It has no real provider adapter or automatic ambiguous replay.

## Alternatives

Send before persistence; blind retry; claim exactly-once delivery.

## Consequences

Duplicate risk is bounded and auditable, but ambiguous operations require reconciliation rather than automatic replay.
