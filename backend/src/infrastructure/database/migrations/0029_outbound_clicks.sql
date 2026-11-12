INSERT INTO metric_definitions (key, label, unit, description, comparable, caveat) VALUES
  ('outbound_clicks', 'Outbound clicks', 'count', 'Clicks that lead to a destination off the platform (Pinterest OUTBOUND_CLICK)', false, NULL)
ON CONFLICT (key) DO NOTHING;
