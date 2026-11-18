-- Pricing v2 (2026-11-18). New plan version for every plan; v1 stays for anyone already on it (grandfathered).
--  * USD = everyone outside India, INR = India (Dodo charges the INR price by billing country: "Localized prices, by country").
--  * Yearly = 10 x monthly (two months free).
--  * Free gets MCP (Claude, ChatGPT, Cursor) so people can try the main feature, capped at 10 AI-published posts a month.
--    Paid plans have no mcp_posts_per_month row: publish_post treats "no row" as no cap.
--  * The 7-day free trial lives on the Dodo products (Trial period days + "Start the trial without a card"), not here.
-- To change prices later: POST /admin/billing/plans/:plan/versions (or a new migration like this one), then set the Dodo product refs.

CREATE TEMP TABLE _v2 ON COMMIT DROP AS
  SELECT p.id AS plan_id, p.key, (SELECT max(version) FROM billing_plan_versions WHERE plan_id = p.id) AS old_version
    FROM billing_plans p;

UPDATE billing_plan_versions SET active = false;
INSERT INTO billing_plan_versions (plan_id, version) SELECT plan_id, old_version + 1 FROM _v2;

-- Same limits as the version before, except Free now has MCP.
INSERT INTO billing_entitlements (plan_version_id, feature_key, kind, limit_value)
SELECT nv.id, e.feature_key, e.kind, CASE WHEN x.key = 'free' AND e.feature_key = 'mcp_access' THEN 1 ELSE e.limit_value END
  FROM _v2 x
  JOIN billing_plan_versions ov ON ov.plan_id = x.plan_id AND ov.version = x.old_version
  JOIN billing_plan_versions nv ON nv.plan_id = x.plan_id AND nv.version = x.old_version + 1
  JOIN billing_entitlements e ON e.plan_version_id = ov.id;

INSERT INTO billing_entitlements (plan_version_id, feature_key, kind, limit_value)
SELECT nv.id, 'mcp_posts_per_month', 'metered', 10
  FROM _v2 x JOIN billing_plan_versions nv ON nv.plan_id = x.plan_id AND nv.version = x.old_version + 1 WHERE x.key = 'free';

-- Monthly prices in minor units; yearly is derived (x10).            India (INR)        International (USD)
INSERT INTO billing_prices (plan_version_id, currency, interval, amount_minor)
SELECT nv.id, c.currency, i.interval, c.amount * CASE i.interval WHEN 'year' THEN 10 ELSE 1 END
  FROM _v2 x
  JOIN billing_plan_versions nv ON nv.plan_id = x.plan_id AND nv.version = x.old_version + 1
  JOIN (VALUES ('starter', 'INR', 99900),  ('starter', 'USD', 1500),   -- ₹999   $15
               ('pro',     'INR', 249900), ('pro',     'USD', 3900),   -- ₹2,499 $39
               ('agency',  'INR', 699900), ('agency',  'USD', 9900))   -- ₹6,999 $99
       AS c(plan, currency, amount) ON c.plan = x.key
  CROSS JOIN (VALUES ('month'), ('year')) AS i(interval);
