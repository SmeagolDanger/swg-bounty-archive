import { pool } from "../src/lib/db/client";
import { standbyEndpoint } from "../src/lib/capture/heartbeat";
import { ingestCapture } from "../src/lib/ingestion/pipeline";
import { flushAxiom } from "../src/lib/observability/axiom";
import { errorLogContext, log } from "../src/lib/observability/logger";

// Replays bounty payloads the Cloudflare standby captured while the primary
// collector was down.
//
//   CAPTURE_STANDBY_URL=... CAPTURE_STANDBY_TOKEN=... \
//   npm run ingest:replay -- --since 2026-09-18T20:00:00Z [--until ISO] [--announce] [--dry-run]
//
// Each capture goes through the normal archive pipeline (raw ingestion row,
// fingerprint dedup, aggregate snapshot), observed at its capture time.
// Replayed encounters are marked as already posted to every Discord feed so a
// long outage does not flood the channels; pass --announce to post them.

interface CaptureListing { key: string; capturedAt: string; size: number }

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const base = process.env.CAPTURE_STANDBY_URL?.trim();
const token = process.env.CAPTURE_STANDBY_TOKEN?.trim();
const since = argValue("--since");
const until = argValue("--until");
const announce = process.argv.includes("--announce");
const dryRun = process.argv.includes("--dry-run");

if (!base || !token) throw new Error("CAPTURE_STANDBY_URL and CAPTURE_STANDBY_TOKEN are required");
if (!since || Number.isNaN(new Date(since).getTime())) throw new Error("--since <ISO timestamp> is required");
if (until && Number.isNaN(new Date(until).getTime())) throw new Error("--until must be an ISO timestamp");

const headers = { Authorization: `Bearer ${token}` };

async function standbyJson<T>(path: string): Promise<T> {
  const response = await fetch(standbyEndpoint(base!, path), { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Capture standby returned HTTP ${response.status} for ${path}`);
  return response.json() as Promise<T>;
}

try {
  const query = new URLSearchParams({ since: new Date(since).toISOString(), ...(until ? { until: new Date(until).toISOString() } : {}) });
  const { captures } = await standbyJson<{ captures: CaptureListing[] }>(`/captures?${query}`);
  process.stdout.write(`${captures.length} capture(s) between ${since} and ${until ?? "now"}\n`);
  if (dryRun || captures.length === 0) {
    for (const capture of captures) process.stdout.write(`  ${capture.capturedAt}  ${capture.key}  ${capture.size} bytes\n`);
  } else {
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('BACKFILL') RETURNING id");
    const runId = run.rows[0].id;
    const totals = { requests: 0, received: 0, inserted: 0, unchanged: 0, revised: 0, duplicates: 0, errors: 0 };
    for (const capture of captures) {
      totals.requests += 1;
      try {
        const payload = await standbyJson<unknown>(`/${capture.key}`);
        const counters = await ingestCapture(runId, payload, new Date(capture.capturedAt), capture.key);
        totals.received += counters.received; totals.inserted += counters.inserted; totals.unchanged += counters.unchanged;
        totals.revised += counters.revised; totals.duplicates += counters.duplicates;
        process.stdout.write(`  ${capture.capturedAt}  inserted ${counters.inserted}  duplicates ${counters.duplicates}\n`);
      } catch (error) {
        totals.errors += 1;
        process.stdout.write(`  ${capture.capturedAt}  FAILED ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    const status = totals.errors === 0 ? "SUCCEEDED" : totals.errors === totals.requests ? "FAILED" : "PARTIAL";
    await pool.query(
      `UPDATE ingestion_runs SET status=$2,finished_at=now(),requests=$3,received=$4,inserted=$5,unchanged=$6,revised=$7,duplicates_prevented=$8,errors=$9 WHERE id=$1`,
      [runId, status, totals.requests, totals.received, totals.inserted, totals.unchanged, totals.revised, totals.duplicates, totals.errors],
    );
    let muted = 0;
    if (!announce) {
      const result = await pool.query(
        `INSERT INTO discord_encounter_posts(encounter_id, webhook_key)
         SELECT e.id, w.webhook_key FROM bounty_encounters e CROSS JOIN discord_feed_webhooks w
         WHERE e.source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)
         ON CONFLICT (encounter_id, webhook_key) DO NOTHING`,
        [runId],
      );
      muted = result.rowCount ?? 0;
    }
    log.info("capture_replay_complete", {
      source: "capture_standby", status: status.toLowerCase(), run_id: runId, captures: captures.length,
      inserted_records: totals.inserted, duplicate_records: totals.duplicates, failed_captures: totals.errors, discord_muted_rows: muted, announce,
    });
    process.stdout.write(`Run ${runId}: ${status}; ${totals.inserted} new rows, ${totals.duplicates} duplicates, ${totals.errors} failed capture(s)${announce ? "" : `; ${muted} Discord feed rows muted`}\n`);
  }
} catch (error) {
  log.error("capture_replay_complete", { source: "capture_standby", status: "failed", ...errorLogContext(error) });
  process.exitCode = 1;
} finally {
  await flushAxiom();
  await pool.end();
}
