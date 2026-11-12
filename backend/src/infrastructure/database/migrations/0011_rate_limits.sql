-- Fixed-window counters for our own endpoints (key = "<limit name>:<identity>").
CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start bigint NOT NULL,        -- epoch seconds of the window start
  count        integer NOT NULL
);
CREATE INDEX rate_limits_window_idx ON rate_limits(window_start);

-- Better Auth's database-backed rate limiter (per-isolate memory counters are useless on Workers).
CREATE TABLE "rateLimit" (
  "id"          text PRIMARY KEY,
  "key"         text NOT NULL UNIQUE,
  "count"       integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
