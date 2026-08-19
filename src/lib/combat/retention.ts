import { pool } from "@/lib/db/client";

// Combat events are kept forever — they are the combat history archive.
// Only unparsed-line diagnostics are purged. Called from the worker loop;
// throttled to every six hours.
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
let lastPurgeAt = 0;

export async function maybePurgeCombatEvents(now = Date.now()): Promise<void> {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  await pool.query("DELETE FROM combat_unparsed WHERE uploaded_at < now() - interval '14 days'");
}
