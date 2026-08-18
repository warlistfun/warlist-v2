# Legacy Characterization Map

No legacy application test or source file is copied in the Phase 0 foundation slice.

Future migration slices must inspect and rewrite behavior with synthetic fixtures, prioritizing:

1. server-session tenant ownership and cross-tenant rejection;
2. worker generation/child fencing and lifecycle;
3. delivery claims, confirmation, and ambiguous outcomes;
4. once-per-day entitlement consumption after confirmation;
5. payment/coupon monotonicity and idempotency;
6. canonical-state propagation and stale-write prevention;
7. graceful shutdown and readiness semantics;
8. logging/diagnostic redaction;
9. admin destructive-action and terminal worker-stop boundaries.

Each future entry must link its legacy evidence path, owning V2 module/Issue, behavioral test, licensing disposition, and synthetic fixture review.
