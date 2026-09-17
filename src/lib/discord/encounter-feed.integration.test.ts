import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db/client";
import { ingestFixture } from "@/lib/ingestion/pipeline";
import { log } from "@/lib/observability/logger";
import { formatEncounterPayload, publishPendingDiscordEncounters, webhookKey } from "./encounter-feed";

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

function capture() {
  const calls: { url: string; payload: ReturnType<typeof formatEncounterPayload> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), payload: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

suite("Discord encounter feed against the database", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const hunter = `Feed Hunter ${suffix}`;
  // Unique per run so the bootstrap path is exercised against the shared dev database.
  const webhookA = `https://discord.test/api/webhooks/${suffix}/a`;
  const webhookB = `https://discord.test/api/webhooks/${suffix}/b`;
  const keys = [webhookKey(webhookA), webhookKey(webhookB)];
  const opts = { db: pool, sleep: async () => undefined, batchSize: 10_000 };
  let runId = "";

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query("DELETE FROM discord_encounter_posts WHERE webhook_key = ANY($1::text[])", [keys]);
    await pool.query("DELETE FROM discord_feed_webhooks WHERE webhook_key = ANY($1::text[])", [keys]);
    if (runId) {
      await pool.query("DELETE FROM data_quality_events WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM schema_signatures WHERE first_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM bounty_encounters WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM bounty_aggregate_snapshots WHERE source_ingestion_id IN (SELECT id FROM api_ingestions WHERE run_id=$1)", [runId]);
      await pool.query("DELETE FROM api_ingestions WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM ingestion_runs WHERE id=$1", [runId]);
    }
    await pool.end();
  });

  it("applies the per-webhook migration idempotently", async () => {
    const migration = await readFile(path.resolve("migrations/0018_discord_feed_webhooks.sql"), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    const pk = await pool.query<{ columns: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.conrelid = 'discord_encounter_posts'::regclass AND c.contype = 'p'`,
    );
    expect(pk.rows[0].columns).toEqual(["encounter_id", "webhook_key"]);
  });

  it("bootstraps each webhook once, then posts new encounters to every webhook oldest first", async () => {
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const run = await pool.query<{ id: string }>("INSERT INTO ingestion_runs(run_type) VALUES('ONCE') RETURNING id");
    runId = run.rows[0].id;

    // 1. An encounter that exists before webhook A is ever configured.
    await ingestFixture(runId, "bounty_activity", "bounty", bountyPayload(
      [{ timestamp: "2026-01-05T10:00:00.000Z", outcome: "KILL", hunterName: hunter, targetName: "Historical Target", credits: 4_000 }],
      "2026-01-05T10:05:00.000Z",
    ), { case: `historical-${suffix}` });

    // 2. First cycle with webhook A: bootstrap only, nothing sent.
    const bootstrap = capture();
    expect(await publishPendingDiscordEncounters({ ...opts, webhooks: webhookA, fetchImpl: bootstrap.fetchImpl })).toEqual({ posted: 0, remaining: 0 });
    expect(bootstrap.calls).toHaveLength(0);
    const registered = await pool.query<{ bootstrapped_encounters: number }>("SELECT bootstrapped_encounters FROM discord_feed_webhooks WHERE webhook_key=$1", [keys[0]]);
    expect(registered.rows[0].bootstrapped_encounters).toBeGreaterThanOrEqual(1);

    // 3. New encounters archived afterwards, stored newest-first on purpose.
    await ingestFixture(runId, "bounty_activity", "bounty", bountyPayload([
      { timestamp: "2026-09-17T12:52:00.000Z", outcome: "FAILED", hunterName: hunter, targetName: "Easton", credits: 0 },
      { timestamp: "2026-09-17T12:47:00.000Z", outcome: "KILL", hunterName: hunter, targetName: "Vulture", credits: 19_154 },
    ], "2026-09-17T12:55:00.000Z"), { case: `live-${suffix}` });

    // 4. Webhook A receives the two new ones in event order; webhook B, seen for
    //    the first time in this cycle, is bootstrapped and receives nothing.
    const first = capture();
    const result = await publishPendingDiscordEncounters({ ...opts, webhooks: `${webhookA},${webhookB}`, fetchImpl: first.fetchImpl });
    expect(result.reason).toBeUndefined();
    const toA = first.calls.filter((call) => call.url === webhookA && call.payload.embeds[0].title.includes(hunter));
    expect(toA.map((call) => [call.payload.embeds[0].title, call.payload.embeds[0].description])).toEqual([
      [`${hunter} collected on Vulture`, "**19,154 cr** payout\n<t:1789649220:f>"],
      [`${hunter} failed to collect on Easton`, "No payout\n<t:1789649520:f>"],
    ]);
    expect(first.calls.some((call) => call.payload.embeds[0].title.includes("Historical Target"))).toBe(false);
    expect(first.calls.filter((call) => call.url === webhookB)).toHaveLength(0);

    // 5. A later encounter reaches both webhooks; nothing is ever posted twice.
    await ingestFixture(runId, "bounty_activity", "bounty", bountyPayload(
      [{ timestamp: "2026-09-17T13:10:00.000Z", outcome: "KILL", hunterName: hunter, targetName: "Both Servers", credits: 1_000 }],
      "2026-09-17T13:12:00.000Z",
    ), { case: `later-${suffix}` });
    const second = capture();
    expect(await publishPendingDiscordEncounters({ ...opts, webhooks: `${webhookA},${webhookB}`, fetchImpl: second.fetchImpl })).toEqual({ posted: 2, remaining: 0 });
    expect(second.calls.map((call) => [call.url, call.payload.embeds[0].title])).toEqual([
      [webhookA, `${hunter} collected on Both Servers`],
      [webhookB, `${hunter} collected on Both Servers`],
    ]);
    const third = capture();
    expect(await publishPendingDiscordEncounters({ ...opts, webhooks: `${webhookA},${webhookB}`, fetchImpl: third.fetchImpl })).toEqual({ posted: 0, remaining: 0 });
    expect(third.calls).toHaveLength(0);

    const tracked = await pool.query<{ webhook_key: string; n: number }>(
      `SELECT p.webhook_key, count(*)::int AS n FROM discord_encounter_posts p JOIN bounty_encounters e ON e.id=p.encounter_id
       WHERE e.hunter_name=$1 AND p.webhook_key = ANY($2::text[]) GROUP BY p.webhook_key ORDER BY p.webhook_key`, [hunter, keys],
    );
    expect(tracked.rows.map((row) => row.n)).toEqual([4, 4]);
  });
});
