INSERT INTO metric_definitions (key, label, unit, description, comparable, caveat) VALUES
  ('clicks', 'Link clicks', 'count', 'Clicks on links in the content (X non_public_metrics.url_link_clicks)', false, NULL)
ON CONFLICT (key) DO NOTHING;
