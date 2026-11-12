INSERT INTO metric_definitions (key, label, unit, description, comparable, caveat) VALUES
  ('watch_time_seconds', 'Watch time', 'seconds', 'Total time viewers spent watching (YouTube estimatedMinutesWatched x 60)', false, NULL),
  ('avg_view_percentage', 'Average percentage viewed', 'ratio', 'Average share of the video that viewers watched (0-1; YouTube averageViewPercentage / 100)', false, NULL),
  ('subscribers_gained', 'Subscribers gained', 'count', 'Subscribers gained from the video (YouTube subscribersGained)', false, NULL)
ON CONFLICT (key) DO NOTHING;
