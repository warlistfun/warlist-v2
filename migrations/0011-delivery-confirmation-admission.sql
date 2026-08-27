ALTER TABLE delivery_attempts
  ADD COLUMN confirmation_provider_message_id text,
  ADD COLUMN confirmed_at timestamptz,
  ADD CONSTRAINT delivery_attempts_confirmation_provider_message_id_check
    CHECK (confirmation_provider_message_id IS NULL
      OR confirmation_provider_message_id ~ '^[a-z0-9_:-]{1,160}$'),
  ADD CONSTRAINT delivery_attempts_confirmation_shape_check CHECK (
    (confirmation_provider_message_id IS NULL AND confirmed_at IS NULL)
    OR (status = 'SENT' AND (confirmation_provider_message_id = provider_message_id) IS TRUE
      AND confirmed_at IS NOT NULL AND confirmed_at >= created_at)
  ),
  ADD CONSTRAINT delivery_attempts_tenant_confirmation_key
    UNIQUE (tenant_id, confirmation_provider_message_id);
