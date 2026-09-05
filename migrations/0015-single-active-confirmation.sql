CREATE UNIQUE INDEX delivery_operations_one_active_confirmation
  ON delivery_operations (tenant_id)
  WHERE status <> 'CONFIRMED';
