-- Object-storage keys whose rows are gone (e.g. a deleted workspace's media). Filled in the same transaction as the
-- delete, drained by hourly housekeeping, so a crash or a storage outage never leaves personal files behind.
CREATE TABLE storage_deletions (
  storage_key text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);
