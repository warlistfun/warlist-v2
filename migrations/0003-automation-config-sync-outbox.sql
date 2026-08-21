CREATE TABLE IF NOT EXISTS automation_config_sync_outbox (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  config_revision bigint NOT NULL CHECK (config_revision > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_FLIGHT', 'APPLIED', 'RETRYABLE_FAILURE', 'NON_RETRYABLE_FAILURE')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token text,
  lease_until timestamptz,
  failure_code text,
  next_attempt_at timestamptz,
  PRIMARY KEY (tenant_id, config_revision),
  CHECK (claim_token IS NULL OR claim_token ~ '^[a-z0-9_:-]{1,160}$'),
  CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (
    (status = 'IN_FLIGHT' AND claim_token IS NOT NULL AND lease_until IS NOT NULL AND failure_code IS NULL AND next_attempt_at IS NULL)
    OR (status = 'RETRYABLE_FAILURE' AND claim_token IS NULL AND lease_until IS NULL AND failure_code IS NOT NULL AND next_attempt_at IS NOT NULL)
    OR (status IN ('PENDING', 'APPLIED', 'NON_RETRYABLE_FAILURE') AND claim_token IS NULL AND lease_until IS NULL AND next_attempt_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS automation_config_sync_outbox_due_idx
  ON automation_config_sync_outbox (status, next_attempt_at, lease_until, tenant_id, config_revision);
