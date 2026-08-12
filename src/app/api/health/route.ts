import { pool } from "@/lib/db/client";

export async function GET() {
  try {
    const result = await pool.query<{ heartbeat_at: Date | null }>("SELECT max(heartbeat_at) AS heartbeat_at FROM worker_heartbeats");
    return Response.json({ status: "ok", database: "connected", workerHeartbeat: result.rows[0].heartbeat_at, timestamp: new Date().toISOString() });
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
