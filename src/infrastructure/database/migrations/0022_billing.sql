-- Billing foundation. Money is ALWAYS integer minor units (paise / cents) + ISO currency; never floats.
-- Provider-independent: provider ids live in provider_refs / billing_subscriptions.provider*, never in domain columns.

CREATE FUNCTION billing_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% rows are immutable: publish a new plan version instead', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;

CREATE TABLE billing_plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name       text NOT NULL,
  position   integer NOT NULL,                  -- display order
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A plan version is what a subscriber is on. Prices/entitlements of a version never change (trigger below).
CREATE TABLE billing_plan_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES billing_plans(id),
  version    integer NOT NULL CHECK (version > 0),
  active     boolean NOT NULL DEFAULT true,      -- false = no NEW subscribers; existing ones keep it (grandfathered)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

CREATE TABLE billing_prices (
  plan_version_id uuid NOT NULL REFERENCES billing_plan_versions(id),
  currency        char(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  interval        text NOT NULL CHECK (interval IN ('month', 'year')),
  amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
  provider_refs   jsonb NOT NULL DEFAULT '{}',   -- {"dodo": "<provider product id>"}, filled when the provider product exists
  PRIMARY KEY (plan_version_id, currency, interval)
);

-- kind: flag (limit_value 1/0), value (plain number, e.g. history days), count (live resource count, e.g. connected accounts), metered (usage events per calendar month).
-- limit_value NULL = unlimited.
CREATE TABLE billing_entitlements (
  plan_version_id uuid NOT NULL REFERENCES billing_plan_versions(id),
  feature_key     text NOT NULL CHECK (feature_key ~ '^[a-z_]{2,40}$'),
  kind            text NOT NULL CHECK (kind IN ('flag', 'value', 'count', 'metered')),
  limit_value     bigint CHECK (limit_value >= 0),
  PRIMARY KEY (plan_version_id, feature_key)
);
-- Prices are immutable except provider_refs (mapping a plan to the provider's product is operational, not commercial).
CREATE FUNCTION billing_prices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'provider_refs') IS DISTINCT FROM (to_jsonb(OLD) - 'provider_refs') THEN
    RAISE EXCEPTION 'billing_prices rows are immutable: publish a new plan version instead';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER billing_prices_immutable BEFORE UPDATE OR DELETE ON billing_prices FOR EACH ROW EXECUTE FUNCTION billing_prices_guard();
CREATE TRIGGER billing_entitlements_immutable BEFORE UPDATE OR DELETE ON billing_entitlements FOR EACH ROW EXECUTE FUNCTION billing_immutable();

CREATE TABLE billing_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_version_id          uuid NOT NULL REFERENCES billing_plan_versions(id),
  status                   text NOT NULL CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'canceled')),
  currency                 char(3) NOT NULL CHECK (currency IN ('INR', 'USD')),
  interval                 text NOT NULL CHECK (interval IN ('month', 'year')),
  provider                 text,
  provider_subscription_id text,
  provider_customer_id     text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  canceled_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK ((provider IS NULL) = (provider_subscription_id IS NULL))
);
CREATE TRIGGER billing_subscriptions_updated BEFORE UPDATE ON billing_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- At most one live subscription per workspace; the provider's id is unique so a webhook can never attach to two rows.
CREATE UNIQUE INDEX billing_subscriptions_live_uniq ON billing_subscriptions(workspace_id) WHERE status <> 'canceled';
CREATE UNIQUE INDEX billing_subscriptions_provider_uniq ON billing_subscriptions(provider, provider_subscription_id) WHERE provider IS NOT NULL;

-- Usage is event-based: every unit is an immutable row, idempotent per (workspace, key), so retries never double count.
CREATE TABLE billing_usage_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature_key     text NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  idempotency_key text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX billing_usage_events_ws_feature_idx ON billing_usage_events(workspace_id, feature_key, occurred_at);
CREATE TRIGGER billing_usage_events_immutable BEFORE UPDATE ON billing_usage_events FOR EACH ROW EXECUTE FUNCTION billing_immutable();

-- ---- Seed catalog. PLACEHOLDER prices and limits: replace by inserting a NEW plan version (versions are immutable).
INSERT INTO billing_plans (key, name, position) VALUES ('free', 'Free', 0), ('starter', 'Starter', 1), ('pro', 'Pro', 2), ('agency', 'Agency', 3);
INSERT INTO billing_plan_versions (plan_id, version) SELECT id, 1 FROM billing_plans;

INSERT INTO billing_prices (plan_version_id, currency, interval, amount_minor)
SELECT v.id, c.currency, 'month', c.amount
  FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id
  JOIN (VALUES ('starter','INR',79900),('starter','USD',900),('pro','INR',199900),('pro','USD',2400),('agency','INR',599900),('agency','USD',6900)) AS c(plan, currency, amount) ON c.plan = p.key;

INSERT INTO billing_entitlements (plan_version_id, feature_key, kind, limit_value)
SELECT v.id, e.feature, e.kind, e.lim
  FROM billing_plan_versions v JOIN billing_plans p ON p.id = v.plan_id
  JOIN (VALUES
    ('free','connected_accounts','count',3), ('starter','connected_accounts','count',10), ('pro','connected_accounts','count',30), ('agency','connected_accounts','count',100),
    ('free','seats','count',1), ('starter','seats','count',3), ('pro','seats','count',10), ('agency','seats','count',50),
    ('free','posts_per_month','metered',30), ('starter','posts_per_month','metered',300), ('pro','posts_per_month','metered',3000), ('agency','posts_per_month','metered',NULL),
    ('free','analytics_history_days','value',30), ('starter','analytics_history_days','value',90), ('pro','analytics_history_days','value',366), ('agency','analytics_history_days','value',366),
    ('free','mcp_access','flag',0), ('starter','mcp_access','flag',1), ('pro','mcp_access','flag',1), ('agency','mcp_access','flag',1)
  ) AS e(plan, feature, kind, lim) ON e.plan = p.key;
