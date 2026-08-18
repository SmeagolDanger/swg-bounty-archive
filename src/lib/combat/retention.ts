import { pool } from "@/lib/db/client";

// Combat rows are working data for the live meter, not an archive: purge
// anything older than 14 days so grinding sessions can't grow the database
// unbounded. Called from the worker loop; throttled to every six hours.
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
let lastPurgeAt = 0;

export async function maybePurgeCombatEvents(now = Date.now()): Promise<void> {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  await pool.query("DELETE FROM combat_events WHERE occurred_at < now() - interval '14 days'");
  await pool.query("DELETE FROM combat_unparsed WHERE uploaded_at < now() - interval '14 days'");
}
