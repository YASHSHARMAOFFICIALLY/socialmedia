-- Outbound: customer-configured endpoints receive signed JSON events (HMAC-SHA256), delivered asynchronously with retries.
CREATE TABLE webhook_endpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url            text NOT NULL,
  secret_enc     text NOT NULL,
  events         text[] NOT NULL DEFAULT '{*}',
  enabled        boolean NOT NULL DEFAULT true,
  failure_streak integer NOT NULL DEFAULT 0,
  disabled_reason text,
  created_by     text NOT NULL REFERENCES "user"("id"),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);
CREATE INDEX webhook_endpoints_ws_idx ON webhook_endpoints(workspace_id);
CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  ref             text NOT NULL,                                -- one delivery per (endpoint, event): emitting twice is harmless
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status     integer,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  UNIQUE (endpoint_id, ref),
  FOREIGN KEY (endpoint_id, workspace_id) REFERENCES webhook_endpoints(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_ep_idx ON webhook_deliveries(endpoint_id, created_at DESC);

-- Inbound: events pushed by platforms (signature-verified before they are stored; deduplicated by payload hash).
CREATE TABLE webhook_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     text NOT NULL,
  kind         text NOT NULL,
  dedupe_key   text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result       text,
  UNIQUE (provider, dedupe_key)
);
