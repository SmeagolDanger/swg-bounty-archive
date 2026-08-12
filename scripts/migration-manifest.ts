import { pool } from "../src/lib/db/client";

const result = await pool.query(`SELECT
  (SELECT count(*)::int FROM api_ingestions) AS api_ingestions,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||coalesce(payload_hash,'')||':'||processing_status,'|' ORDER BY id),''),'sha256'),'hex') FROM api_ingestions) AS api_ingestions_digest,
  (SELECT count(*)::int FROM bounty_encounters) AS bounty_encounters,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||fingerprint,'|' ORDER BY id),''),'sha256'),'hex') FROM bounty_encounters) AS bounty_encounters_digest,
  (SELECT count(*)::int FROM bounty_aggregate_snapshots) AS bounty_aggregate_snapshots,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||state_hash,'|' ORDER BY id),''),'sha256'),'hex') FROM bounty_aggregate_snapshots) AS bounty_aggregate_snapshots_digest,
  (SELECT count(*)::int FROM participants) AS participants,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||participant_type||':'||source_participant_id||':'||current_name,'|' ORDER BY id),''),'sha256'),'hex') FROM participants) AS participants_digest,
  (SELECT count(*)::int FROM leaderboard_snapshots) AS leaderboard_snapshots,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||state_hash,'|' ORDER BY id),''),'sha256'),'hex') FROM leaderboard_snapshots) AS leaderboard_snapshots_digest,
  (SELECT count(*)::int FROM leaderboard_entries) AS leaderboard_entries,
  (SELECT encode(digest(coalesce(string_agg(id::text||':'||source_participant_id||':'||rank::text||':'||score_raw,'|' ORDER BY id),''),'sha256'),'hex') FROM leaderboard_entries) AS leaderboard_entries_digest,
  (SELECT count(*)::int FROM data_revisions) AS data_revisions,
  (SELECT min(response_received_at) FROM api_ingestions) AS first_ingestion_at,
  (SELECT max(response_received_at) FROM api_ingestions) AS last_ingestion_at`);

process.stdout.write(`${JSON.stringify(result.rows[0], null, 2)}\n`);
await pool.end();
