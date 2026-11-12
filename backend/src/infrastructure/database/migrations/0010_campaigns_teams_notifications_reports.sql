-- ---------- campaigns
CREATE TABLE campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  description  text,
  start_date   date,
  end_date     date,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by   text NOT NULL REFERENCES "user"("id"),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX campaigns_ws_idx ON campaigns(workspace_id, created_at DESC, id DESC);
CREATE TRIGGER campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE posts DROP COLUMN campaign_id;                     -- membership lives in campaign_posts (single source of truth)
CREATE TABLE campaign_posts (
  campaign_id  uuid NOT NULL,
  post_id      uuid NOT NULL,
  workspace_id uuid NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id),                                       -- a post belongs to at most one campaign
  FOREIGN KEY (campaign_id, workspace_id) REFERENCES campaigns(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX campaign_posts_campaign_idx ON campaign_posts(campaign_id);

-- ---------- approvals (Writer -> Reviewer -> Publisher)
CREATE TABLE approval_policies (
  workspace_id        uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  required            boolean NOT NULL DEFAULT false,
  required_approvals  integer NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 5),
  updated_by          text REFERENCES "user"("id"),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE approval_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL,
  post_id            uuid NOT NULL,
  requested_by       text NOT NULL REFERENCES "user"("id"),
  content_hash       text NOT NULL,                            -- what was submitted: any later edit makes the approval stale
  required_approvals integer NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  UNIQUE (id, workspace_id),
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX approval_one_open_per_post ON approval_requests(post_id) WHERE status = 'pending';
CREATE INDEX approval_requests_ws_idx ON approval_requests(workspace_id, status, created_at DESC);
CREATE TABLE approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL,
  workspace_id uuid NOT NULL,
  reviewer_id  text NOT NULL REFERENCES "user"("id"),
  decision     text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, reviewer_id),
  FOREIGN KEY (request_id, workspace_id) REFERENCES approval_requests(id, workspace_id) ON DELETE CASCADE
);

-- ---------- notifications
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  type         text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}',
  ref          text NOT NULL,                                  -- idempotency key: the same event never notifies twice
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, ref)
);
CREATE INDEX notifications_user_idx ON notifications(workspace_id, user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications(workspace_id, user_id) WHERE read_at IS NULL;
CREATE TABLE notification_preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  type         text NOT NULL,
  in_app       boolean NOT NULL DEFAULT true,
  email        boolean NOT NULL,
  PRIMARY KEY (workspace_id, user_id, type)
);
-- The notification producers read domain events with a cursor, so they never sit inside (or block) publishing transactions.
CREATE TABLE notification_cursors (name text PRIMARY KEY, last_id bigint NOT NULL DEFAULT 0);
ALTER TABLE outbox_events ADD COLUMN attempts integer NOT NULL DEFAULT 0, ADD COLUMN last_error text;

-- ---------- report exports
CREATE TABLE export_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES "user"("id"),
  type         text NOT NULL,
  params       jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  row_count    integer,
  result_csv   text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX export_jobs_ws_idx ON export_jobs(workspace_id, created_at DESC, id DESC);
CREATE INDEX export_jobs_queue_idx ON export_jobs(created_at) WHERE status IN ('queued', 'running');
