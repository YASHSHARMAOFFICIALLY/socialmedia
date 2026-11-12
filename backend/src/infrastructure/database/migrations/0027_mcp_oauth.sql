-- Browser OAuth for MCP clients (authorization code + PKCE, dynamic client registration). Same grants/tokens as the device flow.
ALTER TABLE mcp_grants DROP CONSTRAINT mcp_grants_kind_check;
ALTER TABLE mcp_grants ADD CONSTRAINT mcp_grants_kind_check CHECK (kind IN ('pat', 'device', 'oauth'));

-- RFC 7591 public clients (no secret; PKCE protects the code). redirect_uris are matched exactly.
CREATE TABLE mcp_clients (
  client_id     text PRIMARY KEY,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived, single-use authorization codes (only the hash is stored).
CREATE TABLE mcp_auth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scopes         text[] NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
