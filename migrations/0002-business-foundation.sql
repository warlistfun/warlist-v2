CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  public_ops_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DELETING', 'DELETED')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public_ops_id ~ '^[a-z0-9_]{1,64}$'),
  CHECK (updated_at >= created_at)
);
CREATE TABLE IF NOT EXISTS automation_configs (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at)
);
CREATE TABLE IF NOT EXISTS delivery_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  operation_key text NOT NULL,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status = 'PREPARED'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_key),
  CHECK (operation_key ~ '^[a-z0-9_:-]{1,160}$'),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS delivery_operations_tenant_status_idx
  ON delivery_operations (tenant_id, status);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  correlation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (correlation_id ~ '^[a-z0-9_:-]{1,160}$'),
  CHECK (actor_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (actor_id IS NULL OR actor_id ~ '^[a-z0-9_:-]{1,160}$'),
  CHECK (action ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (target_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CHECK (target_id IS NULL OR target_id ~ '^[a-z0-9_:-]{1,160}$')
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON audit_events (tenant_id, created_at, id);
