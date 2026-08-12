import { pool } from "@/lib/db/client";

export async function GET() {
  try {
    const configuredStaleSeconds = Number(process.env.HEALTH_WORKER_STALE_SECONDS ?? 900);
    const staleSeconds = Number.isFinite(configuredStaleSeconds) ? Math.max(120, configuredStaleSeconds) : 900;
    const result = await pool.query<{
      heartbeat_at: Date | null;
      metadata: Record<string, unknown> | null;
      last_completed_at: Date | null;
      last_run_status: string | null;
    }>(`SELECT
      wh.heartbeat_at,wh.metadata,
      poll.finished_at AS last_completed_at,poll.status AS last_run_status
      FROM (SELECT 1) seed
      LEFT JOIN worker_heartbeats wh ON wh.worker_key='primary'
      LEFT JOIN LATERAL (
        SELECT finished_at,status FROM ingestion_runs
        WHERE run_type='POLL' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1
      ) poll ON true`);
    const row = result.rows[0];
    const reference = row.last_completed_at ?? row.heartbeat_at;
    const stale = !reference || Date.now() - new Date(reference).getTime() > staleSeconds * 1_000;
    const disabled = row.metadata?.status === "disabled";
    const failed = row.last_run_status === "FAILED" || row.metadata?.runStatus === "FAILED";
    const partial = row.last_run_status === "PARTIAL" || row.metadata?.runStatus === "PARTIAL";
    const unhealthy = !disabled && (stale || failed);
    const workerStatus = disabled ? "disabled" : stale ? "stale" : failed ? "failed" : partial ? "degraded" : row.last_completed_at ? "healthy" : "starting";
    return Response.json({
      status: unhealthy || partial ? "degraded" : "ok",
      database: "connected",
      workerHeartbeat: row.heartbeat_at,
      worker: { status: workerStatus, lastHeartbeatAt: row.heartbeat_at, lastCompletedAt: row.last_completed_at, lastRunStatus: row.last_run_status },
      timestamp: new Date().toISOString(),
    }, { status: unhealthy ? 503 : 200 });
  } catch {
    return Response.json({ status: "error", database: "unavailable", worker: { status: "unknown" }, timestamp: new Date().toISOString() }, { status: 503 });
  }
}
