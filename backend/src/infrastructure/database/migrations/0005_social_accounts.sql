CREATE TYPE social_account_status AS ENUM ('active', 'needs_reauth', 'disconnected');

CREATE TABLE social_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('instagram', 'x', 'linkedin', 'youtube')),
  external_id   text NOT NULL,
  display_name  text NOT NULL,
  username      text,
  avatar_url    text,
  account_type  text NOT NULL CHECK (account_type IN ('personal', 'organization', 'business', 'channel')),
  status        social_account_status NOT NULL DEFAULT 'active',
  last_error    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  connected_by  text NOT NULL REFERENCES "user"("id"),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, external_id),
  UNIQUE (id, workspace_id)                       -- target for composite tenant-safe FKs
);
CREATE INDEX social_accounts_ws_idx ON social_accounts(workspace_id, created_at, id);
CREATE TRIGGER social_accounts_updated BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tokens are AES-256-GCM ciphertext ("<keyId>.<iv>.<ct>"); never plaintext, never returned by any API.
CREATE TABLE oauth_credentials (
  social_account_id uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  access_token_enc  text NOT NULL,
  refresh_token_enc text,
  expires_at        timestamptz,
  refresh_expires_at timestamptz,
  scopes            text[] NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX oauth_credentials_expiry_idx ON oauth_credentials(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE platform_permissions (
  social_account_id uuid NOT NULL,
  workspace_id      uuid NOT NULL,
  permission        text NOT NULL,
  granted           boolean NOT NULL,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (social_account_id, permission),
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE
);

-- Short-lived, single-use OAuth state. Only a hash of the state is stored.
CREATE TABLE oauth_states (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash           text NOT NULL UNIQUE,
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  platform             text NOT NULL,
  reconnect_account_id uuid,
  code_verifier_enc    text,
  expires_at           timestamptz NOT NULL,
  used_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states(expires_at);
