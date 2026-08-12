CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_versions (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  base_url text NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET')),
  enabled boolean NOT NULL DEFAULT true,
  poll_interval_seconds integer NOT NULL DEFAULT 300 CHECK (poll_interval_seconds >= 60),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_url, endpoint, method)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('ONCE','POLL','BACKFILL','RECONCILE','INSPECT')),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  requests integer NOT NULL DEFAULT 0,
  received integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  revised integer NOT NULL DEFAULT 0,
  duplicates_prevented integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS api_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ingestion_runs(id),
  source_id uuid NOT NULL REFERENCES api_sources(id),
  endpoint text NOT NULL,
  request_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL,
  response_received_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  http_status integer NOT NULL,
  response_headers jsonb NOT NULL,
  payload jsonb,
  payload_hash text,
  schema_signature text,
  parser_version text NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('RECEIVED','PROCESSED','FAILED','HTTP_ERROR')),
  error_information jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payload IS NULL) = (payload_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS api_ingestions_source_received_idx ON api_ingestions(source_id, response_received_at DESC);
CREATE INDEX IF NOT EXISTS api_ingestions_payload_hash_idx ON api_ingestions(payload_hash);

CREATE TABLE IF NOT EXISTS schema_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES api_sources(id),
  signature text NOT NULL,
  field_paths jsonb NOT NULL,
  first_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences bigint NOT NULL DEFAULT 1,
  UNIQUE (source_id, signature)
);

CREATE TABLE IF NOT EXISTS leaderboards (
  id text PRIMARY KEY,
  tracker_oid text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('RAW','CREDITS','PERCENT','METERS')),
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leaderboard_id text NOT NULL REFERENCES leaderboards(id),
  source_period_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leaderboard_id, starts_at, ends_at),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_type text NOT NULL CHECK (participant_type IN ('player','guild','city')),
  source_participant_id text NOT NULL,
  current_name text NOT NULL,
  guild_abbreviation text,
  faction text,
  planet text,
  city_name text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (participant_type, source_participant_id)
);
CREATE INDEX IF NOT EXISTS participants_name_trgm_idx ON participants USING gin (current_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS participants_guild_trgm_idx ON participants USING gin (guild_abbreviation gin_trgm_ops);
CREATE INDEX IF NOT EXISTS participants_city_trgm_idx ON participants USING gin (city_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leaderboard_id text NOT NULL REFERENCES leaderboards(id),
  period_id uuid NOT NULL REFERENCES leaderboard_periods(id),
  subject text NOT NULL CHECK (subject IN ('player','guild','city')),
  total_score numeric(30,6) NOT NULL,
  value_type text NOT NULL,
  state_hash text NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (leaderboard_id, period_id, subject, state_hash)
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_latest_idx ON leaderboard_snapshots(leaderboard_id, period_id, subject, observed_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES leaderboard_snapshots(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id),
  source_participant_id text NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  score numeric(30,6) NOT NULL,
  score_raw text NOT NULL,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (snapshot_id, source_participant_id),
  UNIQUE (snapshot_id, rank)
);
CREATE INDEX IF NOT EXISTS leaderboard_entries_participant_idx ON leaderboard_entries(participant_id);

CREATE TABLE IF NOT EXISTS leaderboard_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leaderboard_id text NOT NULL REFERENCES leaderboards(id),
  participant_id uuid NOT NULL REFERENCES participants(id),
  subject text NOT NULL CHECK (subject IN ('guild','city')),
  wins integer NOT NULL CHECK (wins >= 0),
  rank integer NOT NULL CHECK (rank > 0),
  state_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  raw jsonb NOT NULL,
  UNIQUE (leaderboard_id, participant_id, wins, rank)
);

CREATE TABLE IF NOT EXISTS bounty_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  event_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('KILL','FAILED')),
  hunter_name text NOT NULL,
  target_name text NOT NULL,
  credits bigint NOT NULL CHECK (credits >= 0),
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  first_observed_at timestamptz NOT NULL,
  raw jsonb NOT NULL,
  CHECK ((outcome = 'FAILED' AND credits = 0) OR outcome = 'KILL')
);
CREATE INDEX IF NOT EXISTS bounty_encounters_event_idx ON bounty_encounters(event_at DESC);
CREATE INDEX IF NOT EXISTS bounty_encounters_hunter_trgm_idx ON bounty_encounters USING gin (hunter_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bounty_encounters_target_trgm_idx ON bounty_encounters USING gin (target_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS bounty_aggregate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_days integer NOT NULL CHECK (window_days > 0),
  state_hash text NOT NULL UNIQUE,
  source_fetched_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  summary jsonb NOT NULL,
  hunters jsonb NOT NULL,
  targets jsonb NOT NULL,
  survivors jsonb NOT NULL,
  raw jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS data_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_key text NOT NULL,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  source_ingestion_id uuid NOT NULL REFERENCES api_ingestions(id),
  UNIQUE (entity_type, entity_key, field, old_value, new_value, source_ingestion_id)
);

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES ingestion_runs(id),
  source_id uuid REFERENCES api_sources(id),
  ingestion_id uuid REFERENCES api_ingestions(id),
  error_code text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR')),
  event_type text NOT NULL,
  entity_type text,
  entity_key text,
  details jsonb NOT NULL,
  source_ingestion_id uuid REFERENCES api_ingestions(id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_quality_open_idx ON data_quality_events(resolved_at, detected_at DESC);

CREATE TABLE IF NOT EXISTS backfill_checkpoints (
  job_key text PRIMARY KEY,
  cursor jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_key text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE VIEW current_leaderboard_snapshots AS
SELECT DISTINCT ON (leaderboard_id, period_id, subject) *
FROM leaderboard_snapshots
ORDER BY leaderboard_id, period_id, subject, observed_at DESC;

INSERT INTO api_sources (source_key, base_url, endpoint, poll_interval_seconds) VALUES
  ('board_catalog', 'https://swglegends.com', '/api/game/leaderboards', 900),
  ('bounty_activity', 'https://swglegends.com', '/api/game/bounty-hunting', 300),
  ('leaderboard', 'https://swglegends.com', '/api/game/leaderboard', 300),
  ('leaderboard_wins', 'https://swglegends.com', '/api/game/leaderboard-wins', 1800)
ON CONFLICT (source_key) DO NOTHING;
