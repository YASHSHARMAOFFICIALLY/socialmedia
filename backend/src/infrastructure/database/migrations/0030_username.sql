-- Better Auth username plugin: sign in with a username as well as an email.
-- "username" is stored normalized (lowercase) by the plugin; "displayUsername" keeps the casing the user typed.
ALTER TABLE "user" ADD COLUMN "username" text UNIQUE;
ALTER TABLE "user" ADD COLUMN "displayUsername" text;
