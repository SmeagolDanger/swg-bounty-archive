import { pool } from "../src/lib/db/client";
import { PERIODS } from "../src/lib/ingestion/config";
import { runIngestion } from "../src/lib/ingestion/pipeline";

try {
  for (const period of PERIODS) {
    const jobKey = `public-leaderboards:${period}`;
    const checkpoint = await pool.query<{ status: string }>("SELECT status FROM backfill_checkpoints WHERE job_key=$1", [jobKey]);
    if (checkpoint.rows[0]?.status === "SUCCEEDED") {
      process.stdout.write(`Already complete: ${period}\n`);
      continue;
    }
    await pool.query(
      `INSERT INTO backfill_checkpoints(job_key,cursor,status) VALUES($1,$2::jsonb,'RUNNING')
       ON CONFLICT(job_key) DO UPDATE SET status='RUNNING',updated_at=now(),last_error=NULL`,
      [jobKey, JSON.stringify({ period })],
    );
    try {
      const result = await runIngestion("BACKFILL", [period]);
      await pool.query("UPDATE backfill_checkpoints SET status='SUCCEEDED',cursor=$2::jsonb,updated_at=now() WHERE job_key=$1", [jobKey, JSON.stringify({ period, runId: result.runId, complete: true })]);
      process.stdout.write(`Backfilled ${period}: ${result.runId} (${result.status})\n`);
    } catch (error) {
      await pool.query("UPDATE backfill_checkpoints SET status='FAILED',last_error=$2,updated_at=now() WHERE job_key=$1", [jobKey, error instanceof Error ? error.message : String(error)]);
      throw error;
    }
  }
} finally {
  await pool.end();
}
