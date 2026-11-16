-- Owner Health & Activity dashboard. Both tables are written in batches (at most one statement per isolate every few seconds,
-- after the response) and pruned to 30 days by the hourly housekeeping cron.

-- Request latency histogram, aggregated per minute x route group x status x latency bucket. Percentiles are estimated from the
-- buckets at read time; le_ms is the bucket's upper bound (2147483647 = overflow bucket).
CREATE TABLE request_metrics (
  minute      timestamptz NOT NULL,
  route_group text NOT NULL,
  status      integer NOT NULL,
  le_ms       integer NOT NULL,
  count       integer NOT NULL,
  sum_ms      bigint NOT NULL,
  PRIMARY KEY (minute, route_group, status, le_ms)
);

-- Unhandled server errors (HTTP 500s) and dead-lettered queue messages. Short, redacted messages only: never bodies or headers.
CREATE TABLE server_errors (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('http', 'dlq')),
  route       text NOT NULL,
  method      text,
  request_id  text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_errors_created_idx ON server_errors(created_at);
CREATE INDEX audit_logs_action_idx ON audit_logs(action, id DESC);
