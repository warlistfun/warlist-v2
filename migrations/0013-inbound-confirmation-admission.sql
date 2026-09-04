ALTER TABLE delivery_attempts
  DROP CONSTRAINT delivery_attempts_confirmation_shape_check,
  DROP CONSTRAINT delivery_attempts_tenant_confirmation_key,
  DROP CONSTRAINT delivery_attempts_confirmation_provider_message_id_check,
  DROP COLUMN confirmation_provider_message_id,
  ADD COLUMN confirmation_message_id text,
  ADD CONSTRAINT delivery_attempts_confirmation_message_id_check
    CHECK (confirmation_message_id IS NULL
      OR confirmation_message_id ~ '^[a-z0-9_:-]{1,160}$');

UPDATE delivery_attempts
SET confirmed_at = NULL
WHERE confirmed_at IS NOT NULL;

ALTER TABLE delivery_attempts
  ADD CONSTRAINT delivery_attempts_inbound_confirmation_shape_check CHECK (
    (confirmation_message_id IS NULL AND confirmed_at IS NULL)
    OR (status = 'SENT' AND confirmation_message_id IS NOT NULL
      AND confirmed_at IS NOT NULL AND confirmed_at >= created_at)
  );

CREATE UNIQUE INDEX delivery_attempts_tenant_confirmation_message_id_key
  ON delivery_attempts (tenant_id, confirmation_message_id)
  WHERE confirmation_message_id IS NOT NULL;