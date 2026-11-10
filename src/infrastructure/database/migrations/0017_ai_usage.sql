-- Per-workspace daily counter for AI requests (cost control). AI is optional: nothing else depends on this table.
CREATE TABLE ai_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day          date NOT NULL,
  requests     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, day)
);
