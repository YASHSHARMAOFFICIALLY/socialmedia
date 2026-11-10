CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'editor', 'analyst', 'viewer');

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind        text NOT NULL DEFAULT 'business' CHECK (kind IN ('personal', 'startup', 'business', 'client')),
  created_by  text NOT NULL REFERENCES "user"("id"),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workspaces_updated BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  role         workspace_role NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);
-- Every workspace keeps at least one owner (enforced in service inside a transaction; this index speeds the check).
CREATE INDEX workspace_members_owner_idx ON workspace_members(workspace_id) WHERE role = 'owner';

CREATE TABLE workspace_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         workspace_role NOT NULL CHECK (role <> 'owner'),
  token_hash   text NOT NULL UNIQUE,            -- sha256 of the emailed token; raw token never stored
  invited_by   text NOT NULL REFERENCES "user"("id"),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- One open invitation per (workspace, email)
CREATE UNIQUE INDEX workspace_invitations_open_uniq ON workspace_invitations(workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     text REFERENCES "user"("id") ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_ws_created_idx ON audit_logs(workspace_id, id DESC);
