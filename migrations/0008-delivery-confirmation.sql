ALTER TABLE delivery_operations
  ADD COLUMN confirmation_business_key text,
  ADD COLUMN confirmation_correlation_id text,
  ADD CONSTRAINT delivery_operations_confirmation_business_key_check
    CHECK (confirmation_business_key IS NULL OR confirmation_business_key ~ '^[a-z0-9_:-]{1,160}$'),
  ADD CONSTRAINT delivery_operations_confirmation_correlation_id_check
    CHECK (confirmation_correlation_id IS NULL OR confirmation_correlation_id ~ '^[a-z0-9_:-]{1,160}$'),
  ADD CONSTRAINT delivery_operations_confirmation_shape_check CHECK (
    (status = 'CONFIRMED' AND confirmation_business_key IS NOT NULL
      AND confirmation_correlation_id IS NOT NULL)
    OR (status <> 'CONFIRMED' AND confirmation_business_key IS NULL
      AND confirmation_correlation_id IS NULL)
  );
