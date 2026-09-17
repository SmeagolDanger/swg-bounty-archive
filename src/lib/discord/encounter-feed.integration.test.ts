import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db/client";
import { ingestFixture } from "@/lib/ingestion/pipeline";
import { log } from "@/lib/observability/logger";
import { formatEncounterPayload, publishPendingDiscordEncounters } from "./encounter-feed";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;

type Recent = { timestamp: string; outcome: "KILL" | "FAILED"; hunterName: string; targetName: string; credits: number };

function bountyPayload(recent: Recent[], fetchedAt: string) {
  const kills = recent.filter((row) => row.outcome === "KILL").length;
  return {
    windowDays: 14,
    summary: {
      kills, failures: recent.length - kills, encounters: recent.length, successRate: recent.length ? kills / recent.length : 0,
      creditsPaid: recent.reduce((sum, row) => sum + row.credits, 0), averageBounty: 0, distinctHunters: 1, distinctTargets: recent.length,
      largestBounty: null,
    },
    hunters: [], targets: [], survivors: [], recent, fetchedAt,
  };
}

suite("Discord encounter feed against the database", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const hunter = `Feed Hunter ${suffix}`;
  let runId = "";

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!runId) return;
    // discord_encounter_posts cascades from bounty_encounters.
    await pool.query("DELETE FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM schema_signatures WHERE first_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_encounters WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM bounty_aggregate_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
    await pool.query("DELETE FROM api_ingestions WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM ingestion_runs WHERE id=$1", [runId]);
    await pool.end();
  });

  it("bootstraps historical encounters as posted, then posts new ones once, oldest first", async () => {
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('ONCE') RETURNING id");
    runId = run.rows[0].id;

    // 1. An encounter that exists before the migration runs (the historical archive).
    await ingestFixture(runId, "bounty_activity", "bounty", bountyPayload(
      [{ timestamp: "2026-01-05T10:00:00.000Z", outcome: "KILL", hunterName: hunter, targetName: "Historical Target", credits: 4_000 }],
      "2026-01-05T10:05:00.000Z",
    ), { case: `historical-${suffix}` });
    const historical = await pool.query<{ id: string }>(
      "SELECT id FROM bounty_encounters WHERE hunter_name=$1 AND target_name='Historical Target'", [hunter],
    );
    expect(historical.rowCount).toBe(1);

    // 2. Re-apply the migration file: idempotent, and it must mark the historical row.
    const migration = await readFile(path.resolve("migrations/0017_discord_encounter_posts.sql"), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const bootstrapped = await pool.query("SELECT 1 FROM discord_encounter_posts WHERE encounter_id=$1", [historical.rows[0].id]);
    expect(bootstrapped.rowCount).toBe(1);

    // 3. New encounters archived after the migration, stored newest-first on purpose.
    await ingestFixture(runId, "bounty_activity", "bounty", bountyPayload([
      { timestamp: "2026-09-17T12:52:00.000Z", outcome: "FAILED", hunterName: hunter, targetName: "Easton", credits: 0 },
      { timestamp: "2026-09-17T12:47:00.000Z", outcome: "KILL", hunterName: hunter, targetName: "Vulture", credits: 19_154 },
    ], "2026-09-17T12:55:00.000Z"), { case: `live-${suffix}` });

    const calls: { url: string; payload: ReturnType<typeof formatEncounterPayload> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), payload: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const webhook = "https://discord.test/api/webhooks/feed";

    // 4. Publish. Other pending rows in a shared dev database may be included,
    //    so assertions are scoped to this test's hunter.
    const first = await publishPendingDiscordEncounters({ webhook, db: pool, fetchImpl, sleep: async () => undefined, batchSize: 10_000 });
    expect(first.reason).toBeUndefined();
    const mine = calls.filter((call) => call.payload.embeds[0].title.includes(hunter));
    expect(mine.map((call) => [call.payload.embeds[0].title, call.payload.embeds[0].description])).toEqual([
      [`${hunter} collected on Vulture`, "**19,154 cr** payout\n<t:1789649220:f>"],
      [`${hunter} failed to collect on Easton`, "No payout\n<t:1789649520:f>"],
    ]);
    expect(mine.every((call) => call.url === webhook)).toBe(true);
    expect(calls.some((call) => call.payload.embeds[0].title.includes("Historical Target"))).toBe(false);

    const tracked = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM discord_encounter_posts p JOIN bounty_encounters e ON e.id=p.encounter_id WHERE e.hunter_name=$1`, [hunter],
    );
    expect(tracked.rows[0].n).toBe(3);

    // 5. Nothing is posted twice.
    calls.length = 0;
    const second = await publishPendingDiscordEncounters({ webhook, db: pool, fetchImpl, sleep: async () => undefined, batchSize: 10_000 });
    expect(second).toEqual({ posted: 0, remaining: 0 });
    expect(calls).toHaveLength(0);
  });
});
