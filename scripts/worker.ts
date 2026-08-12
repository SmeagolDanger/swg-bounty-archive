import { writeFile } from "node:fs/promises";
import { pool } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { sendCollectorHeartbeat } from "../src/lib/observability/heartbeat";
import { log } from "../src/lib/observability/logger";

const configuredInterval = Number(process.env.INGESTION_INTERVAL_SECONDS ?? 300);
const intervalSeconds = Number.isFinite(configuredInterval) ? Math.max(60, configuredInterval) : 300;
const intervalMs = intervalSeconds * 1_000;
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => { stopping = true; });
}

async function heartbeat(status: string, runId?: string, runStatus?: string): Promise<void> {
  const metadata = {
    status,
    runId: runId ?? null,
    runStatus: runStatus ?? null,
    pid: process.pid,
    ...(runStatus ? { lastCompletedAt: new Date().toISOString() } : {}),
  };
  await pool.query(
    `INSERT INTO worker_heartbeats(worker_key,heartbeat_at,metadata) VALUES('primary',now(),$1::jsonb)
     ON CONFLICT(worker_key) DO UPDATE SET heartbeat_at=now(),metadata=worker_heartbeats.metadata || EXCLUDED.metadata`,
    [JSON.stringify(metadata)],
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
  log.info("worker_started", { intervalSeconds, heartbeatConfigured: Boolean(process.env.BETTERSTACK_HEARTBEAT_URL) });
  if ((process.env.INGESTION_ENABLED ?? "true") !== "true") {
    await heartbeat("disabled");
    while (!stopping) await wait(30_000);
  } else {
    await pool.query("UPDATE api_sources SET poll_interval_seconds=$1 WHERE enabled=true", [intervalSeconds]);
    while (!stopping) {
      const cycleStartedAt = Date.now();
      try {
        await heartbeat("collecting");
        const result = await runIngestion("POLL");
        await heartbeat("idle", result.runId, result.status);
        await sendCollectorHeartbeat(result.status);
      } catch {
        await heartbeat("error", undefined, "FAILED").catch(() => undefined);
        await sendCollectorHeartbeat("FAILED");
      }
      await wait(Math.max(0, intervalMs - (Date.now() - cycleStartedAt)));
    }
  }
} finally {
  log.info("worker_stopped", { reason: stopping ? "signal" : "worker_exit" });
  await heartbeat("stopping").catch(() => undefined);
  await pool.end();
}
