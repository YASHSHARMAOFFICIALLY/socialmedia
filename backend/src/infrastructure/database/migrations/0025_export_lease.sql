-- Export jobs: re-claim a stuck 'running' job by when it STARTED running, not when it was created (a long-queued export was being generated twice).
ALTER TABLE export_jobs ADD COLUMN started_at timestamptz;
