import { pool } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";

try {
  const result = await runIngestion("RECONCILE");
  const runId = result.runId;
  const checks = await pool.query<{
    orphan_entries: string; duplicate_fingerprints: string; invalid_timestamps: string; duplicate_participants: string;
  }>(`SELECT
    (SELECT count(*) FROM leaderboard_entries e LEFT JOIN participants p ON p.id=e.participant_id WHERE p.id IS NULL)::text AS orphan_entries,
    (SELECT count(*) FROM (SELECT fingerprint FROM bounty_encounters GROUP BY fingerprint HAVING count(*)>1) d)::text AS duplicate_fingerprints,
    (SELECT count(*) FROM bounty_encounters WHERE event_at > now() + interval '5 minutes')::text AS invalid_timestamps,
    (SELECT count(*) FROM (SELECT snapshot_id,source_participant_id FROM leaderboard_entries GROUP BY snapshot_id,source_participant_id HAVING count(*)>1) d)::text AS duplicate_participants`);
  const failures = Object.entries(checks.rows[0]).filter(([, value]) => Number(value) > 0);
  if (failures.length) {
    await pool.query(
      `INSERT INTO data_quality_events(severity,event_type,details) VALUES('ERROR','RECONCILIATION_FAILED',$1::jsonb)`,
      [JSON.stringify({ runId, failures })],
    );
    throw new Error(`Reconciliation failed: ${JSON.stringify(failures)}`);
  }
  process.stdout.write(`Reconciliation passed: ${runId}\n`);
} finally {
  await pool.end();
}
