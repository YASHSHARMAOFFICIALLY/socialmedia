-- Canonical metric vocabulary. A cross-platform total is only ever produced for metrics flagged `comparable`.
CREATE TABLE metric_definitions (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  unit        text NOT NULL CHECK (unit IN ('count', 'seconds', 'ratio')),
  description text NOT NULL,
  comparable  boolean NOT NULL DEFAULT false,
  caveat      text
);
INSERT INTO metric_definitions (key, label, unit, description, comparable, caveat) VALUES
  ('impressions',   'Impressions',     'count', 'Times the content was displayed (platform definition of an impression)', false, NULL),
  ('views',         'Views',           'count', 'Plays/views as each platform counts them (YouTube view, Instagram view, ...)', false, NULL),
  ('reach',         'Reach',           'count', 'Unique accounts that saw the content', false, NULL),
  ('likes',         'Likes',           'count', 'Likes / positive reactions', true,  'Platforms define a like differently (e.g. reaction types); totals add platform-reported counts.'),
  ('comments',      'Comments',        'count', 'Comments / replies on the content', true,  'X replies are counted as comments.'),
  ('shares',        'Shares',          'count', 'Shares / sends', false, NULL),
  ('reposts',       'Reposts',         'count', 'Reposts / retweets', false, NULL),
  ('quotes',        'Quote posts',     'count', 'Quote posts (X)', false, NULL),
  ('saves',         'Saves',           'count', 'Times saved (Instagram)', false, NULL),
  ('bookmarks',     'Bookmarks',       'count', 'Times bookmarked (X)', false, NULL),
  ('profile_visits','Profile visits',  'count', 'Profile visits attributed to the content', false, NULL),
  ('avg_watch_time_seconds', 'Average watch time', 'seconds', 'Average time the video was played', false, NULL),
  ('followers',     'Followers',       'count', 'Followers / subscribers of the account', true,  'Not de-duplicated: the same person can follow you on several platforms.'),
  ('interactions',  'Interactions',    'count', 'DERIVED: sum of likes, comments, shares, reposts, quotes, saves and bookmarks that the platform reports', true, 'Each platform contributes only the components it reports; see `components` per platform.');

-- A collection target = something we poll for metrics (an account, or one published post destination).
CREATE TABLE analytics_targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  social_account_id uuid NOT NULL,
  platform          text NOT NULL,
  scope             text NOT NULL CHECK (scope IN ('account', 'post')),
  job_id            uuid,                                  -- publishing job (post scope)
  external_post_id  text,
  published_at      timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'disabled')),
  next_collect_at   timestamptz NOT NULL DEFAULT now(),
  enqueued_at       timestamptz,                           -- when the sweeper last queued it (re-queued if the message was lost)
  claim_token       uuid,                                  -- consumer lease: only one collector runs per target
  claimed_until     timestamptz,
  failures          integer NOT NULL DEFAULT 0,
  last_collected_at timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (job_id, workspace_id) REFERENCES publishing_jobs(id, workspace_id) ON DELETE CASCADE,
  CHECK ((scope = 'post') = (job_id IS NOT NULL))
);
CREATE UNIQUE INDEX analytics_targets_account_uniq ON analytics_targets(social_account_id) WHERE scope = 'account';
CREATE UNIQUE INDEX analytics_targets_job_uniq ON analytics_targets(job_id) WHERE scope = 'post';
CREATE INDEX analytics_targets_due_idx ON analytics_targets(next_collect_at) WHERE status = 'active';

-- Raw API responses, append-only (history is never rewritten).
CREATE TABLE analytics_snapshots (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  target_id         uuid NOT NULL REFERENCES analytics_targets(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL,
  platform          text NOT NULL,
  scope             text NOT NULL,
  job_id            uuid,
  external_post_id  text,
  source            text NOT NULL,                         -- which API call produced it
  collected_at      timestamptz NOT NULL DEFAULT now(),
  raw               jsonb NOT NULL
);
CREATE INDEX analytics_snapshots_target_idx ON analytics_snapshots(target_id, collected_at DESC);

-- Normalized metrics, append-only. value NULL + availability says WHY there is no number; 0 is a real zero.
CREATE TABLE analytics_metrics (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id       bigint NOT NULL REFERENCES analytics_snapshots(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL,
  social_account_id uuid NOT NULL,
  platform          text NOT NULL,
  scope             text NOT NULL,
  job_id            uuid,
  external_post_id  text,
  metric_key        text NOT NULL REFERENCES metric_definitions(key),
  original_name     text NOT NULL,                         -- the platform's own metric name
  definition        text,                                  -- the platform's own definition / unit note
  value             numeric,
  availability      text NOT NULL CHECK (availability IN ('available', 'unavailable')),
  period            text NOT NULL DEFAULT 'lifetime' CHECK (period IN ('lifetime', 'day')),
  components        text[],                                -- derived metrics: which inputs were summed
  collected_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((availability = 'available') = (value IS NOT NULL))
);
CREATE INDEX analytics_metrics_account_idx ON analytics_metrics(social_account_id, metric_key, collected_at DESC);
CREATE INDEX analytics_metrics_job_idx ON analytics_metrics(job_id, metric_key, collected_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX analytics_metrics_ws_idx ON analytics_metrics(workspace_id, collected_at DESC);

CREATE FUNCTION analytics_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER analytics_snapshots_no_update BEFORE UPDATE ON analytics_snapshots FOR EACH ROW EXECUTE FUNCTION analytics_append_only();
CREATE TRIGGER analytics_metrics_no_update BEFORE UPDATE ON analytics_metrics FOR EACH ROW EXECUTE FUNCTION analytics_append_only();

-- Derived, rebuildable roll-ups: last known value in each day/week/month bucket and the change since the previous bucket.
CREATE TABLE analytics_aggregates (
  workspace_id      uuid NOT NULL,
  scope             text NOT NULL,
  target_id         uuid NOT NULL REFERENCES analytics_targets(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL,
  platform          text NOT NULL,
  job_id            uuid,
  metric_key        text NOT NULL REFERENCES metric_definitions(key),
  grain             text NOT NULL CHECK (grain IN ('day', 'week', 'month')),
  bucket_start      date NOT NULL,
  last_value        numeric,
  delta             numeric,                                -- NULL = no earlier bucket to compare with (NOT zero)
  samples           integer NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, metric_key, grain, bucket_start)
);
CREATE INDEX analytics_aggregates_ws_idx ON analytics_aggregates(workspace_id, grain, bucket_start, metric_key);

-- Bumped on every collection; part of dashboard cache keys so cached responses never outlive new data.
CREATE TABLE analytics_versions (workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE, version bigint NOT NULL DEFAULT 1);
