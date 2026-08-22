CREATE TABLE entitlement_ledger (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entry_type text NOT NULL CHECK (entry_type IN (
    'CREDIT_PAYMENT', 'CREDIT_COUPON', 'DEBIT_CONFIRMED_DELIVERY', 'ADJUSTMENT'
  )),
  units integer NOT NULL CHECK (units BETWEEN -1000000 AND 1000000 AND units <> 0),
  business_key text NOT NULL CHECK (business_key ~ '^[a-z0-9_:-]{1,160}$'),
  correlation_id text NOT NULL CHECK (correlation_id ~ '^[a-z0-9_:-]{1,160}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, business_key),
  CHECK (
    (entry_type IN ('CREDIT_PAYMENT', 'CREDIT_COUPON') AND units > 0)
    OR (entry_type = 'DEBIT_CONFIRMED_DELIVERY' AND units < 0)
    OR entry_type = 'ADJUSTMENT'
  )
);

CREATE INDEX entitlement_ledger_tenant_created_idx
  ON entitlement_ledger (tenant_id, created_at, id);

-- ponytail: projection stays a SUM query; add a materialized projection only after measured read pressure.
