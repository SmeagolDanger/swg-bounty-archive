import { writeFile } from "node:fs/promises";
import { pool } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";

const intervalSeconds = Math.max(60, Number(process.env.INGESTION_INTERVAL_SECONDS ?? 300));
const intervalMs = intervalSeconds * 1_000;
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => { stopping = true; });
}

async function heartbeat(status: string, runId?: string): Promise<void> {
  await pool.query(
    `INSERT INTO worker_heartbeats(worker_key,heartbeat_at,metadata) VALUES('primary',now(),$1::jsonb)
     ON CONFLICT(worker_key) DO UPDATE SET heartbeat_at=now(),metadata=EXCLUDED.metadata`,
    [JSON.stringify({ status, runId: runId ?? null, pid: process.pid })],
  );
  await writeFile("/tmp/worker-healthy", new Date().toISOString(), "utf8");
}

async function wait(ms: number): Promise<void> {
  const step = 1_000;
  for (let elapsed = 0; elapsed < ms && !stopping; elapsed += step) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - elapsed)));
  }
}

try {
  if ((process.env.INGESTION_ENABLED ?? "true") !== "true") {
    await heartbeat("disabled");
    while (!stopping) await wait(30_000);
  } else {
    await pool.query("UPDATE api_sources SET poll_interval_seconds=$1 WHERE enabled=true", [intervalSeconds]);
    while (!stopping) {
      const cycleStartedAt = Date.now();
      try {
        await heartbeat("collecting");
        const runId = await runIngestion("POLL");
        await heartbeat("idle", runId);
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ level: "error", event: "poll_failed", message: error instanceof Error ? error.message : String(error) })}\n`);
        await heartbeat("error");
      }
      await wait(Math.max(0, intervalMs - (Date.now() - cycleStartedAt)));
    }
  }
} finally {
  await heartbeat("stopping").catch(() => undefined);
  await pool.end();
}
