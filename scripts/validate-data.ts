import { pool } from "../src/lib/db/client";

try {
  const result = await pool.query(`SELECT
    (SELECT count(*) FROM bounty_encounters)::int AS encounters,
    (SELECT count(DISTINCT fingerprint) FROM bounty_encounters)::int AS encounter_fingerprints,
    (SELECT count(*) FROM leaderboard_entries)::int AS entries,
    (SELECT count(*) FROM participants)::int AS participants,
    (SELECT count(*) FROM api_ingestions WHERE processing_status='FAILED')::int AS historical_parser_errors,
    (SELECT count(*) FROM ingestion_errors WHERE resolved_at IS NULL)::int AS open_parser_errors,
    (SELECT count(*) FROM data_quality_events WHERE resolved_at IS NULL)::int AS open_quality_events`);
  const data = result.rows[0];
  if (data.encounters !== data.encounter_fingerprints) throw new Error("Duplicate encounter fingerprints detected");
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
} finally {
  await pool.end();
}
