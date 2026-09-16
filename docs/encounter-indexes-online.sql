-- Run with psql -v ON_ERROR_STOP=1 -f, outside a transaction.
-- Check for INVALID indexes before retrying an interrupted build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bounty_encounters_hunter_time_idx
  ON bounty_encounters (lower(hunter_name), event_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bounty_encounters_target_time_idx
  ON bounty_encounters (lower(target_name), event_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS participants_player_name_latest_idx
  ON participants (lower(current_name), last_seen_at DESC, id)
  WHERE participant_type = 'player';
CREATE INDEX CONCURRENTLY IF NOT EXISTS bounty_encounters_time_id_idx
  ON bounty_encounters (event_at DESC, id DESC);

ANALYZE bounty_encounters;
ANALYZE participants;
