# ADR 0006: Durable Delivery Claims and Ambiguous Outcomes

- **Status:** Accepted; claim foundation implemented

## Context

External WhatsApp delivery cannot provide application-level exactly-once guarantees, especially across crashes and retries.

## Decision

Require one durable winning claim before send, fence stale workers, persist attempt identity, and classify unknown crash-after-send outcomes as ambiguous. The implemented claim foundation uses one PostgreSQL statement to verify the exact current UUID tenant worker, advance an operation fence, set its owner/lease, and create one attempt bound to that fence. Sender and outcome transitions remain future work.

## Alternatives

Send before persistence; blind retry; claim exactly-once delivery.

## Consequences

Duplicate risk is bounded and auditable, but ambiguous operations require reconciliation rather than automatic replay.
