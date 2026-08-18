# ADR 0006: Durable Delivery Claims and Ambiguous Outcomes

- **Status:** Accepted for future implementation

## Context

External WhatsApp delivery cannot provide application-level exactly-once guarantees, especially across crashes and retries.

## Decision

Require one durable winning claim before send, fence stale workers, persist attempt identity, and classify unknown crash-after-send outcomes as ambiguous.

## Alternatives

Send before persistence; blind retry; claim exactly-once delivery.

## Consequences

Duplicate risk is bounded and auditable, but ambiguous operations require reconciliation rather than automatic replay.
