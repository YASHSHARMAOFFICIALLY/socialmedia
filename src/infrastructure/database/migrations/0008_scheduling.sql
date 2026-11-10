-- One schedule per post. Individual platform jobs live in publishing_jobs (status 'scheduled', next_attempt_at = fire time).
CREATE TABLE scheduled_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  post_id         uuid NOT NULL,
  scheduled_at    timestamptz NOT NULL,                    -- the instant, UTC
  timezone        text NOT NULL DEFAULT 'UTC',             -- IANA zone the user scheduled in (for display and DST-aware edits)
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  recurrence_rule text,                                    -- reserved: recurring content is not implemented yet
  created_by      text NOT NULL REFERENCES "user"("id"),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id),
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX scheduled_posts_due_idx ON scheduled_posts(workspace_id, scheduled_at) WHERE status = 'active';
CREATE TRIGGER scheduled_posts_updated BEFORE UPDATE ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Calendar + conflict queries
CREATE INDEX publishing_jobs_calendar_next_idx ON publishing_jobs(workspace_id, next_attempt_at);
CREATE INDEX publishing_jobs_calendar_pub_idx ON publishing_jobs(workspace_id, published_at) WHERE published_at IS NOT NULL;
CREATE INDEX publishing_jobs_account_sched_idx ON publishing_jobs(social_account_id, next_attempt_at) WHERE status IN ('scheduled', 'pending');
CREATE INDEX media_assets_stale_idx ON media_assets(created_at) WHERE status IN ('pending_upload', 'failed');
