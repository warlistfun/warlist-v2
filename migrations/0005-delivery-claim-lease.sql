CREATE TABLE tenant_worker_ownerships (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  state text NOT NULL CHECK (state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING')),
  generation integer NOT NULL CHECK (generation >= 0),
  child_id text,
  quarantined boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (child_id IS NULL OR child_id ~ '^[a-z0-9_]{1,160}$')
);

ALTER TABLE delivery_operations
  ADD COLUMN claim_owner text,
  ADD COLUMN claim_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN claim_lease_until timestamptz,
  ADD COLUMN worker_generation integer,
  ADD COLUMN worker_child_id text,
  ADD CONSTRAINT delivery_operations_claim_owner_check
    CHECK (claim_owner IS NULL OR claim_owner ~ '^[a-z0-9_:-]{1,160}$'),
  ADD CONSTRAINT delivery_operations_claim_fence_check CHECK (claim_fence >= 0),
  ADD CONSTRAINT delivery_operations_worker_generation_check
    CHECK (worker_generation IS NULL OR worker_generation > 0),
  ADD CONSTRAINT delivery_operations_worker_child_id_check
    CHECK (worker_child_id IS NULL OR worker_child_id ~ '^[a-z0-9_]{1,160}$'),
  ADD CONSTRAINT delivery_operations_claim_shape_check CHECK (
    (status = 'PREPARED' AND claim_owner IS NULL AND claim_fence = 0
      AND claim_lease_until IS NULL AND worker_generation IS NULL AND worker_child_id IS NULL)
    OR (status IN ('CLAIMED', 'SENT', 'AMBIGUOUS', 'CONFIRMED')
      AND claim_owner IS NOT NULL AND claim_fence > 0
      AND claim_lease_until IS NOT NULL AND worker_generation IS NOT NULL
      AND worker_child_id IS NOT NULL)
  );

ALTER TABLE delivery_attempts
  ADD COLUMN claim_fence integer,
  ADD CONSTRAINT delivery_attempts_claim_fence_check
    CHECK (claim_fence IS NULL OR claim_fence > 0),
  ADD CONSTRAINT delivery_attempts_operation_claim_fence_key
    UNIQUE (tenant_id, operation_id, claim_fence);
