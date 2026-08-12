import { pool } from "../src/lib/db/client";

try {
  const tables = ["api_ingestions", "ingestion_runs", "participants", "leaderboard_snapshots", "leaderboard_entries", "bounty_encounters", "data_revisions", "data_quality_events"];
  const stats: Record<string, number> = {};
  for (const table of tables) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    stats[table] = result.rows[0].count;
  }
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
} finally {
  await pool.end();
}
