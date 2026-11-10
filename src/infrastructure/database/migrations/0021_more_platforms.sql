-- Platforms added after the first four. The inline CHECK created in 0005 has the default name social_accounts_platform_check.
ALTER TABLE social_accounts DROP CONSTRAINT social_accounts_platform_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN ('instagram', 'x', 'linkedin', 'youtube', 'threads', 'facebook', 'pinterest', 'tiktok', 'bluesky', 'mastodon', 'telegram'));
