-- Instagram account insights: day-period account metrics reuse analytics_metrics (period = 'day'); audience demographics get their own
-- latest-snapshot table (they are distributions, not counters, so the lifetime/delta aggregates do not apply).
INSERT INTO metric_definitions (key, label, unit, description, comparable, caveat) VALUES
  ('accounts_engaged',   'Accounts engaged',   'count', 'Accounts that interacted with the account''s content in the period (platform estimate)', false, NULL),
  ('profile_links_taps', 'Profile link taps',  'count', 'Taps on the profile''s links and contact buttons in the period', false, NULL)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE analytics_audience (
  social_account_id uuid NOT NULL,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform          text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('follower', 'engaged')),
  breakdown         text NOT NULL CHECK (breakdown IN ('age', 'gender', 'city', 'country')),
  timeframe         text NOT NULL,
  data              jsonb NOT NULL,           -- { "<dimension value>": count }, e.g. {"F.25-34": 120}
  collected_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (social_account_id, kind, breakdown),
  FOREIGN KEY (social_account_id, workspace_id) REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX analytics_audience_ws_idx ON analytics_audience(workspace_id);
