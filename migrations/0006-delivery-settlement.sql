ALTER TABLE delivery_operations
  DROP CONSTRAINT delivery_operations_status_check,
  ADD CONSTRAINT delivery_operations_status_check
    CHECK (status IN ('PREPARED', 'CLAIMED', 'SENDING', 'SENT', 'AMBIGUOUS', 'CONFIRMED')),
  DROP CONSTRAINT delivery_operations_claim_shape_check,
  ADD CONSTRAINT delivery_operations_claim_shape_check CHECK (
    (status = 'PREPARED' AND claim_owner IS NULL AND claim_fence = 0
      AND claim_lease_until IS NULL AND worker_generation IS NULL AND worker_child_id IS NULL)
    OR (status IN ('CLAIMED', 'SENDING', 'SENT', 'AMBIGUOUS', 'CONFIRMED')
      AND claim_owner IS NOT NULL AND claim_fence > 0
      AND claim_lease_until IS NOT NULL AND worker_generation IS NOT NULL
      AND worker_child_id IS NOT NULL)
  );

ALTER TABLE delivery_attempts
  ADD COLUMN provider_message_id text,
  ADD CONSTRAINT delivery_attempts_provider_message_id_check
    CHECK (provider_message_id IS NULL OR provider_message_id ~ '^[a-z0-9_:-]{1,160}$');

ALTER TABLE delivery_operations
  ADD CONSTRAINT delivery_operations_attempt_settlement_shape_check CHECK (
    status NOT IN ('SENT', 'AMBIGUOUS') OR claim_owner IS NOT NULL
  );

-- ponytail: no provider-aware reconciliation; add it with confirmation/ledger slice.
