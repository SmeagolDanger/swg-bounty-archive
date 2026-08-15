-- Officers' Salute registry: weekly GCW rank standings per faction from
-- GET /api/game/gcw-officers?faction=IMPERIAL|REBEL. The source publishes up
-- to 250 rows per faction across all ranks (Private through General);
-- commissioned officers are rank_index >= 7 (Lieutenant and above).

CREATE TABLE IF NOT EXISTS gcw_officer_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction text NOT NULL CHECK (faction IN ('IMPERIAL','REBEL')),
  total_results integer NOT NULL CHECK (total_results >= 0),
  state_hash text NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (faction, state_hash)
);
CREATE INDEX IF NOT EXISTS gcw_officer_snapshots_latest_idx
ON gcw_officer_snapshots(faction, observed_at DESC);

CREATE TABLE IF NOT EXISTS gcw_officer_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES gcw_officer_snapshots(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id),
  source_participant_id text NOT NULL,
  name text NOT NULL,
  faction_name text NOT NULL,
  rank_index integer NOT NULL CHECK (rank_index >= 1),
  rank_name text NOT NULL,
  current_gcw_points bigint NOT NULL CHECK (current_gcw_points >= 0),
  current_pvp_kills bigint NOT NULL CHECK (current_pvp_kills >= 0),
  lifetime_gcw_points bigint NOT NULL CHECK (lifetime_gcw_points >= 0),
  lifetime_pvp_kills bigint NOT NULL CHECK (lifetime_pvp_kills >= 0),
  profession text,
  guild_name text,
  guild_abbreviation text,
  resident_planet text,
  resident_city_name text,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (snapshot_id, source_participant_id)
);
CREATE INDEX IF NOT EXISTS gcw_officer_entries_participant_idx
ON gcw_officer_entries(participant_id);
CREATE INDEX IF NOT EXISTS gcw_officer_entries_guild_idx
ON gcw_officer_entries(lower(guild_abbreviation));

INSERT INTO api_sources (source_key, base_url, endpoint, poll_interval_seconds) VALUES
  ('gcw_officers', 'https://swglegends.com', '/api/game/gcw-officers', 3600)
ON CONFLICT (source_key) DO NOTHING;
