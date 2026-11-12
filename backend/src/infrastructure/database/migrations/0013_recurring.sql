-- A recurring series publishes fresh COPIES of a template post (a post can only be published once). The template stays an editable draft;
-- each occurrence copies its current content, so editing the template changes future occurrences only.
CREATE TABLE recurring_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  template_post_id uuid NOT NULL,
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  interval_n      integer NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 52),
  start_local     text NOT NULL,                                -- wall-clock start "YYYY-MM-DDTHH:mm" in `timezone`
  timezone        text NOT NULL,
  max_count       integer CHECK (max_count BETWEEN 1 AND 366),
  until_date      date,
  account_ids     uuid[],                                       -- NULL = every destination of the template
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  next_no         integer NOT NULL DEFAULT 0,                   -- next occurrence number to materialize
  next_at         timestamptz,                                  -- its UTC instant (NULL when ended)
  created_by      text NOT NULL REFERENCES "user"("id"),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (template_post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX recurring_series_due_idx ON recurring_series(next_at) WHERE status = 'active';
CREATE INDEX recurring_series_ws_idx ON recurring_series(workspace_id, created_at DESC, id DESC);
CREATE TRIGGER recurring_series_updated BEFORE UPDATE ON recurring_series FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE series_occurrences (
  series_id    uuid NOT NULL,
  workspace_id uuid NOT NULL,
  occurrence_no integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  post_id      uuid,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'scheduled', 'failed', 'skipped')),
  claimed_at   timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, occurrence_no),                        -- one row per occurrence: materialization is idempotent
  FOREIGN KEY (series_id, workspace_id) REFERENCES recurring_series(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX series_occurrences_pending_idx ON series_occurrences(created_at) WHERE status IN ('pending', 'processing');
