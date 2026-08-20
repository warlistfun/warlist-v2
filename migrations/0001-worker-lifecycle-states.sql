CREATE TABLE IF NOT EXISTS worker_lifecycle_states (
  tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^tenant_example_[a-z0-9_]+$'),
  state text NOT NULL CHECK (state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING')),
  generation integer NOT NULL CHECK (generation >= 0),
  child_id text,
  quarantined boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
