-- The live encounter feed can fan out to several Discord webhooks
-- (DISCORD_BOUNTY_WEBHOOK_URL is now a comma-separated list), so delivery is
-- tracked per encounter per webhook. webhook_key is a short SHA-256 prefix of
-- the webhook URL; the URL itself is never stored or logged.
ALTER TABLE discord_encounter_posts ADD COLUMN IF NOT EXISTS webhook_key text NOT NULL DEFAULT 'legacy';
ALTER TABLE discord_encounter_posts ALTER COLUMN webhook_key DROP DEFAULT;
ALTER TABLE discord_encounter_posts DROP CONSTRAINT IF EXISTS discord_encounter_posts_pkey;
ALTER TABLE discord_encounter_posts ADD PRIMARY KEY (encounter_id, webhook_key);

-- One row per webhook the worker has ever been configured with. The first
-- time a key appears the worker records every encounter that already exists
-- as posted for that key before sending anything. That is the same "never
-- replay the archive" guarantee 0017 gave the single webhook, but it now
-- applies automatically to the existing webhook after this upgrade and to any
-- webhook added later.
CREATE TABLE IF NOT EXISTS discord_feed_webhooks (
  webhook_key text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  bootstrapped_encounters integer NOT NULL
);

-- Rows written before this migration keep the placeholder key 'legacy'. They
-- are kept for audit, are never consulted by the publisher, and still follow
-- their encounter on delete. Re-running this file is safe.
