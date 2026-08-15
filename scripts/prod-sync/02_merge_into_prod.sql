-- Merge staging_import.* (loaded by 01_extract_local.sh output) into public.*
-- without creating duplicates. Safe to re-run: every insert dedupes on the
-- table's logical identity, so a second application inserts zero rows.
--
-- Identity / dedup rules (mirrors the schema's unique constraints):
--   payload_blobs             payload_hash (content-addressed)
--   api_ingestions            id, plus (endpoint, requested_at, payload_hash) semantic guard
--   schema_signatures         (source_id, signature)
--   leaderboards              id (text)
--   leaderboard_periods       (leaderboard_id, starts_at, ends_at)
--   participants              (participant_type, source_participant_id)
--   leaderboard_snapshots     (leaderboard_id, period_id, subject, state_hash)
--   leaderboard_entries       (snapshot_id, source_participant_id)
--   leaderboard_wins          (leaderboard_id, participant_id, wins, rank)
--   bounty_encounters         fingerprint
--   bounty_aggregate_snapshots state_hash
--   data_revisions            full-row (NULL-safe)
--
-- Cross-database UUIDs are remapped: rows that already exist in prod under a
-- different uuid are matched by natural key and children re-pointed at the
-- prod row. Earliest-seen timestamps are merged (LEAST) so the recovered
-- early history is reflected on overlapping rows.
--
-- Prints an inserted/updated count per step. Run 03_verify.sql afterwards;
-- drop the staging schema only after verification:
--   DROP SCHEMA staging_import CASCADE;

\set ON_ERROR_STOP on

BEGIN;

-- ── 0. Preconditions ─────────────────────────────────────────────────

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(s.source_key, ', ') INTO missing
  FROM staging_import.api_sources s
  LEFT JOIN public.api_sources p ON p.source_key = s.source_key
  WHERE p.id IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'prod is missing api_sources rows for: % (run migrations first)', missing;
  END IF;
END $$;

CREATE TEMP TABLE map_sources ON COMMIT DROP AS
SELECT s.id AS old_id, p.id AS new_id
FROM staging_import.api_sources s
JOIN public.api_sources p ON p.source_key = s.source_key;

-- ── 1. Ingestion runs (audit spine; uuid PKs never collide) ──────────

WITH ins AS (
  INSERT INTO public.ingestion_runs (id, run_type, status, started_at, finished_at,
    requests, received, inserted, unchanged, revised, duplicates_prevented, errors, metadata)
  SELECT id, run_type, status, started_at, finished_at,
    requests, received, inserted, unchanged, revised, duplicates_prevented, errors, metadata
  FROM staging_import.ingestion_runs
  ON CONFLICT (id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_ingestion_runs FROM ins;

-- ── 2. Raw archive ───────────────────────────────────────────────────
-- Payload content is content-addressed (migration 0008): blobs first so the
-- api_ingestions FK is satisfied, deduped by hash across environments.

WITH ins AS (
  INSERT INTO public.payload_blobs (payload_hash, payload, first_seen_at)
  SELECT s.payload_hash, s.payload, s.first_seen_at
  FROM staging_import.payload_blobs s
  ON CONFLICT (payload_hash) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_payload_blobs FROM ins;

-- Recover the earlier first_seen_at when both environments hold the blob.
UPDATE public.payload_blobs p
SET first_seen_at = LEAST(p.first_seen_at, s.first_seen_at)
FROM staging_import.payload_blobs s
WHERE s.payload_hash = p.payload_hash AND s.first_seen_at < p.first_seen_at;

-- Keep every distinct observation; skip only true duplicates: same PK
-- (re-run of this script) or the identical response already archived by
-- prod's own collector (same endpoint + requested_at + payload hash).

WITH ins AS (
  INSERT INTO public.api_ingestions (id, run_id, source_id, endpoint, request_parameters,
    requested_at, response_received_at, duration_ms, http_status, response_headers,
    payload_hash, schema_signature, parser_version, processing_status,
    error_information, created_at)
  SELECT s.id, s.run_id, m.new_id, s.endpoint, s.request_parameters,
    s.requested_at, s.response_received_at, s.duration_ms, s.http_status, s.response_headers,
    s.payload_hash, s.schema_signature, s.parser_version, s.processing_status,
    s.error_information, s.created_at
  FROM staging_import.api_ingestions s
  JOIN map_sources m ON m.old_id = s.source_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.api_ingestions p
    WHERE p.endpoint = s.endpoint
      AND p.requested_at = s.requested_at
      AND p.payload_hash IS NOT DISTINCT FROM s.payload_hash
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_api_ingestions FROM ins;

-- ── 3. Schema signatures ─────────────────────────────────────────────

-- Identity is (source_id, scope_key, signature) since migration 0005.
WITH upd AS (
  UPDATE public.schema_signatures p
  SET first_seen_at = LEAST(p.first_seen_at, s.first_seen_at),
      last_seen_at  = GREATEST(p.last_seen_at, s.last_seen_at),
      occurrences   = GREATEST(p.occurrences, s.occurrences)
  FROM staging_import.schema_signatures s
  JOIN map_sources m ON m.old_id = s.source_id
  WHERE p.source_id = m.new_id
    AND p.scope_key = s.scope_key
    AND p.signature = s.signature
    AND (s.first_seen_at < p.first_seen_at
      OR s.last_seen_at > p.last_seen_at
      OR s.occurrences > p.occurrences)
  RETURNING 1
)
SELECT count(*) AS merged_schema_signatures FROM upd;

WITH ins AS (
  INSERT INTO public.schema_signatures (id, source_id, signature, field_paths,
    first_ingestion_id, first_seen_at, last_seen_at, occurrences,
    structure, scope_key, comparable)
  SELECT s.id, m.new_id, s.signature, s.field_paths,
    s.first_ingestion_id, s.first_seen_at, s.last_seen_at, s.occurrences,
    s.structure, s.scope_key, s.comparable
  FROM staging_import.schema_signatures s
  JOIN map_sources m ON m.old_id = s.source_id
  JOIN public.api_ingestions pi ON pi.id = s.first_ingestion_id
  ON CONFLICT (source_id, scope_key, signature) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_schema_signatures FROM ins;

-- ── 4. Leaderboard catalog (text PKs shared across environments) ─────

WITH upd AS (
  UPDATE public.leaderboards p
  SET first_seen_at = LEAST(p.first_seen_at, s.first_seen_at),
      last_seen_at  = GREATEST(p.last_seen_at, s.last_seen_at)
  FROM staging_import.leaderboards s
  WHERE p.id = s.id
    AND (s.first_seen_at < p.first_seen_at OR s.last_seen_at > p.last_seen_at)
  RETURNING 1
)
SELECT count(*) AS merged_leaderboards FROM upd;

WITH ins AS (
  INSERT INTO public.leaderboards (id, tracker_oid, name, category, value_type,
    source_ingestion_id, first_seen_at, last_seen_at, raw)
  SELECT s.id, s.tracker_oid, s.name, s.category, s.value_type,
    s.source_ingestion_id, s.first_seen_at, s.last_seen_at, s.raw
  FROM staging_import.leaderboards s
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_leaderboards FROM ins;

-- ── 5. Periods (natural key; no ingestion FK) ────────────────────────

WITH upd AS (
  UPDATE public.leaderboard_periods p
  SET first_seen_at = LEAST(p.first_seen_at, s.first_seen_at),
      last_seen_at  = GREATEST(p.last_seen_at, s.last_seen_at)
  FROM staging_import.leaderboard_periods s
  WHERE p.leaderboard_id = s.leaderboard_id
    AND p.starts_at = s.starts_at AND p.ends_at = s.ends_at
    AND (s.first_seen_at < p.first_seen_at OR s.last_seen_at > p.last_seen_at)
  RETURNING 1
)
SELECT count(*) AS merged_periods FROM upd;

WITH ins AS (
  INSERT INTO public.leaderboard_periods (id, leaderboard_id, source_period_key,
    starts_at, ends_at, first_seen_at, last_seen_at)
  SELECT s.id, s.leaderboard_id, s.source_period_key,
    s.starts_at, s.ends_at, s.first_seen_at, s.last_seen_at
  FROM staging_import.leaderboard_periods s
  ON CONFLICT (leaderboard_id, starts_at, ends_at) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_periods FROM ins;

CREATE TEMP TABLE map_periods ON COMMIT DROP AS
SELECT s.id AS old_id, p.id AS new_id
FROM staging_import.leaderboard_periods s
JOIN public.leaderboard_periods p
  ON p.leaderboard_id = s.leaderboard_id
 AND p.starts_at = s.starts_at AND p.ends_at = s.ends_at;

-- ── 6. Participants (recover earliest first_seen_at) ─────────────────

WITH upd AS (
  UPDATE public.participants p
  SET first_seen_at = LEAST(p.first_seen_at, s.first_seen_at),
      last_seen_at  = GREATEST(p.last_seen_at, s.last_seen_at)
  FROM staging_import.participants s
  WHERE p.participant_type = s.participant_type
    AND p.source_participant_id = s.source_participant_id
    AND (s.first_seen_at < p.first_seen_at OR s.last_seen_at > p.last_seen_at)
  RETURNING 1
)
SELECT count(*) AS merged_participants FROM upd;

WITH ins AS (
  INSERT INTO public.participants (id, participant_type, source_participant_id,
    current_name, guild_abbreviation, faction, planet, city_name,
    first_seen_at, last_seen_at, source_ingestion_id, raw)
  SELECT s.id, s.participant_type, s.source_participant_id,
    s.current_name, s.guild_abbreviation, s.faction, s.planet, s.city_name,
    s.first_seen_at, s.last_seen_at, s.source_ingestion_id, s.raw
  FROM staging_import.participants s
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (participant_type, source_participant_id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_participants FROM ins;

CREATE TEMP TABLE map_participants ON COMMIT DROP AS
SELECT s.id AS old_id, p.id AS new_id
FROM staging_import.participants s
JOIN public.participants p
  ON p.participant_type = s.participant_type
 AND p.source_participant_id = s.source_participant_id;

-- ── 7. Snapshots (period ids remapped) ───────────────────────────────

WITH ins AS (
  INSERT INTO public.leaderboard_snapshots (id, leaderboard_id, period_id, subject,
    total_score, value_type, state_hash, source_fetched_at, observed_at,
    source_ingestion_id, raw)
  SELECT s.id, s.leaderboard_id, mp.new_id, s.subject,
    s.total_score, s.value_type, s.state_hash, s.source_fetched_at, s.observed_at,
    s.source_ingestion_id, s.raw
  FROM staging_import.leaderboard_snapshots s
  JOIN map_periods mp ON mp.old_id = s.period_id
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (leaderboard_id, period_id, subject, state_hash) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_snapshots FROM ins;

CREATE TEMP TABLE map_snapshots ON COMMIT DROP AS
SELECT s.id AS old_id, p.id AS new_id
FROM staging_import.leaderboard_snapshots s
JOIN map_periods mp ON mp.old_id = s.period_id
JOIN public.leaderboard_snapshots p
  ON p.leaderboard_id = s.leaderboard_id
 AND p.period_id = mp.new_id
 AND p.subject = s.subject
 AND p.state_hash = s.state_hash;

-- ── 8. Entries (snapshot + participant ids remapped) ─────────────────

WITH ins AS (
  INSERT INTO public.leaderboard_entries (id, snapshot_id, participant_id,
    source_participant_id, rank, score, score_raw, source_ingestion_id, raw)
  SELECT s.id, ms.new_id, mpart.new_id,
    s.source_participant_id, s.rank, s.score, s.score_raw, s.source_ingestion_id, s.raw
  FROM staging_import.leaderboard_entries s
  JOIN map_snapshots ms ON ms.old_id = s.snapshot_id
  JOIN map_participants mpart ON mpart.old_id = s.participant_id
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (snapshot_id, source_participant_id) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_entries FROM ins;

-- ── 9. Wins ──────────────────────────────────────────────────────────

WITH ins AS (
  INSERT INTO public.leaderboard_wins (id, leaderboard_id, participant_id, subject,
    wins, rank, state_hash, observed_at, source_ingestion_id, raw)
  SELECT s.id, s.leaderboard_id, mpart.new_id, s.subject,
    s.wins, s.rank, s.state_hash, s.observed_at, s.source_ingestion_id, s.raw
  FROM staging_import.leaderboard_wins s
  JOIN map_participants mpart ON mpart.old_id = s.participant_id
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (leaderboard_id, participant_id, wins, rank) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_wins FROM ins;

-- ── 10. Encounters (immutable log; earliest observation wins) ────────

WITH upd AS (
  UPDATE public.bounty_encounters p
  SET first_observed_at = LEAST(p.first_observed_at, s.first_observed_at)
  FROM staging_import.bounty_encounters s
  WHERE p.fingerprint = s.fingerprint
    AND s.first_observed_at < p.first_observed_at
  RETURNING 1
)
SELECT count(*) AS merged_encounters FROM upd;

WITH ins AS (
  INSERT INTO public.bounty_encounters (id, fingerprint, event_at, outcome,
    hunter_name, target_name, credits, source_ingestion_id, first_observed_at, raw)
  SELECT s.id, s.fingerprint, s.event_at, s.outcome,
    s.hunter_name, s.target_name, s.credits, s.source_ingestion_id, s.first_observed_at, s.raw
  FROM staging_import.bounty_encounters s
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (fingerprint) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_encounters FROM ins;

-- ── 11. Aggregates ───────────────────────────────────────────────────

WITH ins AS (
  INSERT INTO public.bounty_aggregate_snapshots (id, window_days, state_hash,
    source_fetched_at, observed_at, source_ingestion_id, summary, hunters, targets,
    survivors, raw)
  SELECT s.id, s.window_days, s.state_hash,
    s.source_fetched_at, s.observed_at, s.source_ingestion_id, s.summary, s.hunters, s.targets,
    s.survivors, s.raw
  FROM staging_import.bounty_aggregate_snapshots s
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  ON CONFLICT (state_hash) DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_aggregates FROM ins;

-- ── 12. Revisions (NULL-safe full-row dedup) ─────────────────────────

WITH ins AS (
  INSERT INTO public.data_revisions (id, entity_type, entity_key, field,
    old_value, new_value, detected_at, source_ingestion_id)
  SELECT s.id, s.entity_type, s.entity_key, s.field,
    s.old_value, s.new_value, s.detected_at, s.source_ingestion_id
  FROM staging_import.data_revisions s
  JOIN public.api_ingestions pi ON pi.id = s.source_ingestion_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_revisions p
    WHERE p.entity_type = s.entity_type
      AND p.entity_key = s.entity_key
      AND p.field = s.field
      AND p.old_value IS NOT DISTINCT FROM s.old_value
      AND p.new_value IS NOT DISTINCT FROM s.new_value
      AND p.source_ingestion_id = s.source_ingestion_id
  )
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT count(*) AS inserted_revisions FROM ins;

COMMIT;

-- Staging data is kept for 03_verify.sql. After verifying:
--   DROP SCHEMA staging_import CASCADE;