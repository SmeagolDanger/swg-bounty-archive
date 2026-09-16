-- On a live archive, prebuild these with docs/encounter-indexes-online.sql
-- before running the transactional migration runner.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5min';

CREATE INDEX IF NOT EXISTS bounty_encounters_hunter_time_idx
  ON bounty_encounters (lower(hunter_name), event_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bounty_encounters_target_time_idx
  ON bounty_encounters (lower(target_name), event_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS participants_player_name_latest_idx
  ON participants (lower(current_name), last_seen_at DESC, id)
  WHERE participant_type = 'player';
CREATE INDEX IF NOT EXISTS bounty_encounters_time_id_idx
  ON bounty_encounters (event_at DESC, id DESC);
