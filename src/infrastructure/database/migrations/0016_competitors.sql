-- Competitor intelligence: PUBLIC data only, fetched through each platform's official API with the workspace's own connected account.
-- Kept apart from the core analytics tables on purpose (different data, different trust level, different failure modes).
CREATE TABLE competitors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform         text NOT NULL,
  handle           text NOT NULL,                              -- what the user typed (normalized)
  external_id      text NOT NULL,
  display_name     text NOT NULL,
  avatar_url       text,
  extra_uploads    text,                                       -- platform helper (YouTube uploads playlist id)
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failures         integer NOT NULL DEFAULT 0,
  last_error       text,
  next_collect_at  timestamptz NOT NULL DEFAULT now(),
  claim_until      timestamptz,
  last_collected_at timestamptz,
  added_by         text NOT NULL REFERENCES "user"("id"),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, platform, external_id)
);
CREATE INDEX competitors_due_idx ON competitors(next_collect_at) WHERE status = 'active';
CREATE INDEX competitors_ws_idx ON competitors(workspace_id, created_at);
CREATE TABLE competitor_snapshots (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  competitor_id uuid NOT NULL,
  workspace_id  uuid NOT NULL,
  followers     bigint,                                        -- NULL = hidden/unavailable (never 0)
  posts_count   bigint,
  extra         jsonb NOT NULL DEFAULT '{}',
  collected_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (competitor_id, workspace_id) REFERENCES competitors(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX competitor_snapshots_idx ON competitor_snapshots(competitor_id, collected_at DESC);
CREATE TABLE competitor_posts (
  competitor_id    uuid NOT NULL,
  workspace_id     uuid NOT NULL,
  external_post_id text NOT NULL,
  published_at     timestamptz NOT NULL,
  url              text,
  metrics          jsonb NOT NULL,                             -- latest public metrics; absent key = not provided
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competitor_id, external_post_id),
  FOREIGN KEY (competitor_id, workspace_id) REFERENCES competitors(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX competitor_posts_idx ON competitor_posts(competitor_id, published_at DESC);
