-- Provider webhooks: stored verbatim-after-verification, deduplicated by the provider's event id, processed asynchronously with retries.
-- Receiving and processing are separate states, so a crash between "200 OK" and "applied" is healed by the sweeper.
CREATE TABLE billing_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  event_id        text NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,                       -- short reason only, never provider response bodies
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  UNIQUE (provider, event_id)
);
CREATE INDEX billing_webhook_events_due_idx ON billing_webhook_events(next_attempt_at) WHERE status IN ('received', 'failed');

-- Payments as the provider reported them. Amounts are integer minor units; NULL when the provider did not give an integer.
CREATE TABLE billing_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id     uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  provider            text NOT NULL,
  provider_payment_id text NOT NULL,
  status              text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  amount_minor        bigint CHECK (amount_minor >= 0),
  currency            char(3),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id, status)
);
CREATE INDEX billing_payments_ws_idx ON billing_payments(workspace_id, occurred_at DESC);
