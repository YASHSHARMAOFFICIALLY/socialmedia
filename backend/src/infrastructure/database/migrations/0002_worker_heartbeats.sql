-- Cloudflare Workers have no long-lived processes; scheduled/queue handlers record liveness here.
CREATE TABLE worker_heartbeats (
  name        text PRIMARY KEY,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  detail      jsonb
);
