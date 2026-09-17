-- One row per bounty encounter that has been announced on the live Discord
-- encounter feed (DISCORD_BOUNTY_WEBHOOK_URL). The worker treats an encounter
-- as pending until a row exists here and inserts the row only after Discord
-- accepted the message, so a failed delivery is retried on a later cycle and
-- a delivered encounter is never announced twice. Delivery rows are derived
-- data and follow their encounter if it is ever removed.
CREATE TABLE IF NOT EXISTS discord_encounter_posts (
  encounter_id uuid PRIMARY KEY REFERENCES bounty_encounters(id) ON DELETE CASCADE,
  posted_at timestamptz NOT NULL DEFAULT now()
);

-- Bootstrap: every encounter already in the archive when this migration runs
-- is recorded as posted without ever being sent, so enabling the feed does not
-- replay historical encounters into Discord. Only encounters archived after
-- this point are announced. The statement is idempotent, so re-running the
-- file is safe.
INSERT INTO discord_encounter_posts(encounter_id)
SELECT id FROM bounty_encounters
ON CONFLICT (encounter_id) DO NOTHING;
