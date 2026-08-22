ALTER TABLE delivery_operations
  DROP CONSTRAINT delivery_operations_status_check,
  ADD CONSTRAINT delivery_operations_status_check
    CHECK (status IN ('PREPARED', 'CLAIMED', 'SENT', 'AMBIGUOUS', 'CONFIRMED')),
  ADD CONSTRAINT delivery_operations_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED', 'SENT', 'AMBIGUOUS')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_id, attempt_number),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES delivery_operations (tenant_id, id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS delivery_attempts_tenant_operation_idx
  ON delivery_attempts (tenant_id, operation_id, attempt_number);
