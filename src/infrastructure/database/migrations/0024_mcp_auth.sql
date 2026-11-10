-- MCP credentials. Only SHA-256 hashes of secrets are stored; raw tokens are shown once and never logged.
-- A grant is "this user lets this client act in this workspace with these scopes". Access tokens hang off a grant, so revoking the grant kills them all.
CREATE TABLE mcp_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('pat', 'device')),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  scopes            text[] NOT NULL CHECK (cardinality(scopes) > 0),
  refresh_hash      text UNIQUE,                 -- device grants only: current refresh token
  prev_refresh_hash text UNIQUE,                 -- previous one: presenting it again means theft, and the whole grant is revoked
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  last_used_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_grants_ws_idx ON mcp_grants(workspace_id, created_at DESC);
CREATE INDEX mcp_grants_user_idx ON mcp_grants(user_id);

CREATE TABLE mcp_access_tokens (
  token_hash text PRIMARY KEY,
  grant_id   uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_access_tokens_grant_idx ON mcp_access_tokens(grant_id);

-- RFC 8628 device authorization: the CLI shows a code, the user approves it in a browser session, the CLI polls for the tokens.
CREATE TABLE mcp_device_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash text NOT NULL UNIQUE,
  user_code        text NOT NULL UNIQUE,
  client_name      text NOT NULL,
  scopes           text[] NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  user_id          text REFERENCES "user"("id") ON DELETE CASCADE,
  workspace_id     uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at       timestamptz NOT NULL,
  last_polled_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
