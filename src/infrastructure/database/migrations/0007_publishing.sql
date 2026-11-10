CREATE TABLE publishing_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL,
  post_id              uuid NOT NULL,
  variant_id           uuid NOT NULL,
  social_account_id    uuid NOT NULL,
  platform             text NOT NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'processing', 'published', 'failed', 'cancelled')),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),   -- when the job becomes runnable (schedule time or retry time)
  attempt_count        integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 5,
  lease_token          uuid,
  lease_until          timestamptz,
  needs_reconciliation boolean NOT NULL DEFAULT false,       -- outcome unknown: the platform may already have the post
  unknown_since        timestamptz,
  idempotency_key      text NOT NULL UNIQUE,                 -- stable per job; handed to adapters (platform-side dedupe/reconcile marker)
  external_id          text,
  external_url         text,
  published_at         timestamptz,
  failure_kind         text,                                 -- retryable|rate_limited|auth_expired|permanent|unconfirmed|exhausted
  failure_message      text,
  dead_lettered_at     timestamptz,
  last_enqueued_at     timestamptz,
  created_by           text NOT NULL REFERENCES "user"("id"),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, workspace_id) REFERENCES post_variants(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id)
);
-- THE duplicate-publication guard: at most one live (non-failed, non-cancelled) job per variant, enforced by the database.
CREATE UNIQUE INDEX publishing_jobs_one_live_per_variant ON publishing_jobs(variant_id) WHERE status IN ('pending', 'scheduled', 'processing', 'published');
CREATE INDEX publishing_jobs_due_idx ON publishing_jobs(next_attempt_at) WHERE status IN ('pending', 'scheduled');
CREATE INDEX publishing_jobs_lease_idx ON publishing_jobs(lease_until) WHERE status = 'processing';
CREATE INDEX publishing_jobs_ws_idx ON publishing_jobs(workspace_id, created_at DESC, id DESC);
CREATE INDEX publishing_jobs_post_idx ON publishing_jobs(post_id);
CREATE TRIGGER publishing_jobs_updated BEFORE UPDATE ON publishing_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only history of every try.
CREATE TABLE publishing_attempts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  attempt_no    integer NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('started', 'success', 'retryable', 'rate_limited', 'auth_expired', 'permanent', 'unknown')),
  error_message text,
  http_status   integer,
  response      jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  FOREIGN KEY (job_id, workspace_id) REFERENCES publishing_jobs(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (job_id, attempt_no)
);

-- Every status transition, with reason.
CREATE TABLE publishing_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id        uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  from_status   text,
  to_status     text NOT NULL,
  reason        text,
  actor_id      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, workspace_id) REFERENCES publishing_jobs(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX publishing_events_job_idx ON publishing_events(job_id, id);

-- Transactional outbox: written in the same transaction as the job; a relay moves rows to the queue.
CREATE TABLE outbox_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type          text NOT NULL,
  aggregate_id  uuid NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  available_at  timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at, id) WHERE dispatched_at IS NULL;
CREATE INDEX outbox_aggregate_idx ON outbox_events(aggregate_id) WHERE dispatched_at IS NULL;

-- Replay protection for POST /publish.
CREATE TABLE idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key          text NOT NULL,
  post_id      uuid NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
