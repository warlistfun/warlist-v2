ALTER TABLE tenant_worker_ownerships
  ADD COLUMN revision bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT tenant_worker_ownerships_revision_check
    CHECK (revision > 0 AND revision <= 9007199254740991);

ALTER TABLE tenant_worker_ownerships
  ALTER COLUMN revision DROP DEFAULT;
