ALTER TABLE delivery_operations
  ADD COLUMN scheduled_start_at timestamptz;

CREATE OR REPLACE FUNCTION reject_delivery_scheduled_start_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at THEN
    RAISE EXCEPTION 'scheduled_start_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_operations_scheduled_start_immutable
  BEFORE UPDATE ON delivery_operations
  FOR EACH ROW EXECUTE FUNCTION reject_delivery_scheduled_start_change();
