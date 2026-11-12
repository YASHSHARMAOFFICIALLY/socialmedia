-- Media assets are created here because posts reference them; upload/processing endpoints arrive with the media module.
CREATE TABLE media_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('image', 'video')),
  storage_key   text NOT NULL,
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  width         integer,
  height        integer,
  duration_ms   integer,
  status        text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'uploaded', 'ready', 'failed', 'deleted')),
  created_by    text NOT NULL REFERENCES "user"("id"),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, storage_key)
);
CREATE INDEX media_assets_ws_idx ON media_assets(workspace_id, created_at DESC, id);
CREATE TRIGGER media_assets_updated BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by   text NOT NULL REFERENCES "user"("id"),
  title        text,                                    -- internal name / default title
  body         text NOT NULL DEFAULT '',
  hashtags     text[] NOT NULL DEFAULT '{}',
  labels       text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),  -- extended by the publishing phase
  campaign_id  uuid,                                    -- FK added with campaigns
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);
CREATE INDEX posts_ws_created_idx ON posts(workspace_id, created_at DESC, id DESC);
CREATE INDEX posts_ws_status_idx ON posts(workspace_id, status);
CREATE INDEX posts_labels_idx ON posts USING gin(labels);
CREATE TRIGGER posts_updated BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One variant per destination account. NULL caption/hashtags mean "inherit from the post".
CREATE TABLE post_variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL,
  post_id           uuid NOT NULL,
  social_account_id uuid NOT NULL,
  platform          text NOT NULL,
  caption           text,
  title             text,
  description       text,
  hashtags          text[],
  metadata          jsonb NOT NULL DEFAULT '{}',       -- platform-specific (e.g. youtube privacy, instagram media type)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, social_account_id),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id)
);
CREATE INDEX post_variants_post_idx ON post_variants(post_id);
CREATE INDEX post_variants_account_idx ON post_variants(social_account_id);
CREATE TRIGGER post_variants_updated BEFORE UPDATE ON post_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- variant_id NULL = post-level media; a variant with its own rows overrides the post-level media.
CREATE TABLE post_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  post_id      uuid NOT NULL,
  variant_id   uuid,
  media_id     uuid NOT NULL,
  role         text NOT NULL DEFAULT 'media' CHECK (role IN ('media', 'thumbnail')),
  position     integer NOT NULL DEFAULT 0,
  FOREIGN KEY (post_id, workspace_id) REFERENCES posts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id, workspace_id) REFERENCES post_variants(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (media_id, workspace_id) REFERENCES media_assets(id, workspace_id)
);
CREATE INDEX post_media_post_idx ON post_media(post_id, variant_id, position);
CREATE INDEX post_media_media_idx ON post_media(media_id);   -- "where is this asset used?"
