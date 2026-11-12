-- Found by the automated index audit (test/reliability.test.ts): dashboards filter analytics_targets by workspace/scope/publish date,
-- and deleting snapshots (cascade) must find their metrics without scanning the table.
CREATE INDEX analytics_targets_ws_idx ON analytics_targets(workspace_id, scope, published_at);
CREATE INDEX analytics_metrics_snapshot_idx ON analytics_metrics(snapshot_id);
