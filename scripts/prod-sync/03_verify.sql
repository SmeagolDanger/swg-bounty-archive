-- Post-merge verification: every logical row in staging_import must now be
-- represented in public (pre-existing or inserted). All "missing_*" counts
-- must be 0. Run after 02_merge_into_prod.sql, before dropping staging.

\set ON_ERROR_STOP on

SELECT count(*) AS missing_encounters
FROM staging_import.bounty_encounters s
WHERE NOT EXISTS (SELECT 1 FROM public.bounty_encounters p WHERE p.fingerprint = s.fingerprint);

SELECT count(*) AS missing_participants
FROM staging_import.participants s
WHERE NOT EXISTS (
  SELECT 1 FROM public.participants p
  WHERE p.participant_type = s.participant_type
    AND p.source_participant_id = s.source_participant_id);

SELECT count(*) AS missing_periods
FROM staging_import.leaderboard_periods s
WHERE NOT EXISTS (
  SELECT 1 FROM public.leaderboard_periods p
  WHERE p.leaderboard_id = s.leaderboard_id
    AND p.starts_at = s.starts_at AND p.ends_at = s.ends_at);

SELECT count(*) AS missing_snapshots
FROM staging_import.leaderboard_snapshots s
JOIN staging_import.leaderboard_periods sp ON sp.id = s.period_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leaderboard_snapshots p
  JOIN public.leaderboard_periods pp ON pp.id = p.period_id
  WHERE p.leaderboard_id = s.leaderboard_id
    AND pp.leaderboard_id = sp.leaderboard_id
    AND pp.starts_at = sp.starts_at AND pp.ends_at = sp.ends_at
    AND p.subject = s.subject
    AND p.state_hash = s.state_hash);

SELECT count(*) AS missing_entries
FROM staging_import.leaderboard_entries s
JOIN staging_import.leaderboard_snapshots ss ON ss.id = s.snapshot_id
JOIN staging_import.leaderboard_periods sp ON sp.id = ss.period_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leaderboard_entries p
  JOIN public.leaderboard_snapshots ps ON ps.id = p.snapshot_id
  JOIN public.leaderboard_periods pp ON pp.id = ps.period_id
  WHERE p.source_participant_id = s.source_participant_id
    AND ps.leaderboard_id = ss.leaderboard_id
    AND ps.subject = ss.subject
    AND ps.state_hash = ss.state_hash
    AND pp.starts_at = sp.starts_at AND pp.ends_at = sp.ends_at);

SELECT count(*) AS missing_aggregates
FROM staging_import.bounty_aggregate_snapshots s
WHERE NOT EXISTS (
  SELECT 1 FROM public.bounty_aggregate_snapshots p WHERE p.state_hash = s.state_hash);

SELECT count(*) AS missing_wins
FROM staging_import.leaderboard_wins s
JOIN staging_import.participants spart ON spart.id = s.participant_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leaderboard_wins p
  JOIN public.participants ppart ON ppart.id = p.participant_id
  WHERE p.leaderboard_id = s.leaderboard_id
    AND ppart.participant_type = spart.participant_type
    AND ppart.source_participant_id = spart.source_participant_id
    AND p.wins = s.wins AND p.rank = s.rank);

-- Raw archive: every staged response is present either under its own id or
-- as prod's identical observation (endpoint + requested_at + payload hash).
SELECT count(*) AS missing_ingestions
FROM staging_import.api_ingestions s
WHERE NOT EXISTS (SELECT 1 FROM public.api_ingestions p WHERE p.id = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.api_ingestions p
    WHERE p.endpoint = s.endpoint
      AND p.requested_at = s.requested_at
      AND p.payload_hash IS NOT DISTINCT FROM s.payload_hash);

-- Duplicate audits (all must be 0): logical identities must stay unique.
SELECT count(*) AS dup_encounter_fingerprints FROM (
  SELECT fingerprint FROM public.bounty_encounters GROUP BY fingerprint HAVING count(*) > 1) d;

SELECT count(*) AS dup_participant_keys FROM (
  SELECT participant_type, source_participant_id
  FROM public.participants GROUP BY 1, 2 HAVING count(*) > 1) d;

SELECT count(*) AS dup_period_keys FROM (
  SELECT leaderboard_id, starts_at, ends_at
  FROM public.leaderboard_periods GROUP BY 1, 2, 3 HAVING count(*) > 1) d;

SELECT count(*) AS dup_snapshot_keys FROM (
  SELECT leaderboard_id, period_id, subject, state_hash
  FROM public.leaderboard_snapshots GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d;

SELECT count(*) AS dup_aggregate_hashes FROM (
  SELECT state_hash FROM public.bounty_aggregate_snapshots GROUP BY 1 HAVING count(*) > 1) d;

SELECT count(*) AS dup_raw_responses FROM (
  SELECT endpoint, requested_at, payload_hash
  FROM public.api_ingestions
  WHERE payload_hash IS NOT NULL
  GROUP BY 1, 2, 3 HAVING count(*) > 1) d;

-- Headline: new earliest history now available in prod.
SELECT min(requested_at) AS earliest_raw_observation,
       max(requested_at) AS latest_raw_observation,
       count(*)          AS total_raw_responses
FROM public.api_ingestions;

SELECT min(event_at) AS earliest_encounter,
       count(*)      AS total_encounters
FROM public.bounty_encounters;