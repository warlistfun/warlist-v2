ALTER TABLE delivery_attempts
  DROP CONSTRAINT delivery_attempts_provider_message_id_check,
  ADD CONSTRAINT delivery_attempts_provider_message_id_check
    CHECK (provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9_:-]{1,160}$');
