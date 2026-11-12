-- Last time the subscription was reconciled with the provider (webhook or daily safety-net re-sync).
ALTER TABLE billing_subscriptions ADD COLUMN synced_at timestamptz;
