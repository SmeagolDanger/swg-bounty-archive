import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/observability/logger";
import {
  ENCOUNTER_FEED_COLORS,
  discordTimestamp,
  formatCredits,
  formatEncounterPayload,
  publishPendingDiscordEncounters,
  type PendingEncounter,
} from "./encounter-feed";

const WEBHOOK = "https://discord.test/api/webhooks/123/secret-token";

const kill: PendingEncounter = {
  id: "00000000-0000-0000-0000-000000000002",
  event_at: new Date("2026-09-17T12:47:00Z"),
  outcome: "KILL",
  hunter_name: "Yesrem",
  target_name: "Vulture",
  credits: "19154", // bigint columns arrive as strings from pg
};

const failed: PendingEncounter = {
  id: "00000000-0000-0000-0000-000000000003",
  event_at: "2026-09-17T12:52:00.000Z",
  outcome: "FAILED",
  hunter_name: "Yesrem",
  target_name: "Easton",
  credits: 0,
};

const older: PendingEncounter = {
  id: "00000000-0000-0000-0000-000000000001",
  event_at: new Date("2026-09-17T11:00:00Z"),
  outcome: "KILL",
  hunter_name: "Boba",
  target_name: "Han",
  credits: 1_250_000,
};

const noSleep = async () => undefined;

// In-memory stand-in for the pool: enough SQL awareness to answer the lock,
// the pending query (oldest first, skipping posted rows) and the mark insert.
function fakeDb(encounters: PendingEncounter[], options: { posted?: string[]; lockHeld?: boolean; failMark?: boolean; failConnect?: boolean } = {}) {
  const posted = new Set(options.posted ?? []);
  const sql: string[] = [];
  const state = { released: 0, unlocked: 0 };
  const client = {
    async query(text: string, values: unknown[] = []) {
      sql.push(text);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: !options.lockHeld }], rowCount: 1 };
      if (text.includes("pg_advisory_unlock")) { state.unlocked += 1; return { rows: [{}], rowCount: 1 }; }
      if (text.includes("FROM bounty_encounters")) {
        const rows = encounters
          .filter((row) => !posted.has(row.id))
          .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime() || a.id.localeCompare(b.id))
          .slice(0, Number(values[0]));
        return { rows, rowCount: rows.length };
      }
      if (text.includes("INSERT INTO discord_encounter_posts")) {
        if (options.failMark) throw new Error("database unavailable");
        const id = String(values[0]);
        const inserted = !posted.has(id);
        posted.add(id);
        return { rows: [], rowCount: inserted ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL in fake pool: ${text}`);
    },
    release() { state.released += 1; },
  };
  const db = {
    async connect() {
      if (options.failConnect) throw new Error("connect refused");
      return client;
    },
  } as unknown as Pick<Pool, "connect">;
  return { db, posted, sql, state };
}

function fakeFetch(statuses: Array<number | Error> = []) {
  const calls: { url: string; init: RequestInit; payload: ReturnType<typeof formatEncounterPayload> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const outcome = statuses[calls.length] ?? 204;
    calls.push({ url: String(url), init: init ?? {}, payload: JSON.parse(String(init?.body)) });
    if (outcome instanceof Error) throw outcome;
    return new Response(null, { status: outcome });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// Keep test output quiet; individual tests re-spy to assert on calls.
beforeEach(() => {
  vi.spyOn(log, "info").mockImplementation(() => undefined);
  vi.spyOn(log, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("formatEncounterPayload", () => {
  it("formats a collected bounty as a green embed with a thousands-separated payout", () => {
    const payload = formatEncounterPayload(kill);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].color).toBe(ENCOUNTER_FEED_COLORS.KILL);
    expect(payload.embeds[0].color).toBe(0x57f287);
    expect(payload.embeds[0].description).toBe(
      "**Yesrem collected on Vulture**\n\n**19,154 cr** payout\n\n<t:1789649220:f>",
    );
  });

  it("formats a failed bounty as a red embed that says No payout", () => {
    const payload = formatEncounterPayload(failed);
    expect(payload.embeds[0].color).toBe(ENCOUNTER_FEED_COLORS.FAILED);
    expect(payload.embeds[0].color).toBe(0xed4245);
    expect(payload.embeds[0].description).toBe(
      "**Yesrem failed to collect on Easton**\n\nNo payout\n\n<t:1789649520:f>",
    );
    expect(payload.embeds[0].description).not.toContain("cr");
  });

  it("applies thousands separators to numeric and string credit values", () => {
    expect(formatCredits("19154")).toBe("19,154");
    expect(formatCredits(1_250_000)).toBe("1,250,000");
    expect(formatCredits(500)).toBe("500");
    expect(formatEncounterPayload(older).embeds[0].description).toContain("**1,250,000 cr** payout");
  });

  it("uses a Discord-native timestamp derived from the encounter's event_at", () => {
    expect(discordTimestamp(new Date("2026-09-17T12:47:00Z"))).toBe("<t:1789649220:f>");
    expect(discordTimestamp("2026-09-17T12:47:00.999Z")).toBe("<t:1789649220:f>");
    const stamp = Math.floor(new Date(kill.event_at).getTime() / 1000);
    expect(formatEncounterPayload(kill).embeds[0].description.endsWith(`<t:${stamp}:f>`)).toBe(true);
  });

  it("disables mention parsing and preserves names exactly as stored", () => {
    const payload = formatEncounterPayload({ ...kill, hunter_name: "Dar'k Hun-ter", target_name: "@everyone" });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].description).toContain("**Dar'k Hun-ter collected on @everyone**");
  });
});

describe("publishPendingDiscordEncounters", () => {
  it("is a clean no-op when the webhook is unset or blank", async () => {
    vi.stubEnv("DISCORD_BOUNTY_WEBHOOK_URL", "");
    const { fetchImpl, calls } = fakeFetch();
    const connect = vi.fn();
    const db = { connect } as unknown as Pick<Pool, "connect">;
    expect(await publishPendingDiscordEncounters({ db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    expect(await publishPendingDiscordEncounters({ webhook: "   ", db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    vi.unstubAllEnvs();
    delete process.env.DISCORD_BOUNTY_WEBHOOK_URL;
    expect(await publishPendingDiscordEncounters({ db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    expect(connect).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("marks an encounter posted only after Discord accepts it and logs without the webhook URL", async () => {
    const { db, posted, state } = fakeDb([kill]);
    const { fetchImpl, calls } = fakeFetch([204]);
    const info = vi.spyOn(log, "info");
    const result = await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 1, remaining: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].payload).toEqual(formatEncounterPayload(kill));
    expect(posted.has(kill.id)).toBe(true);
    expect(info).toHaveBeenCalledWith("discord_bounty_posted", expect.objectContaining({
      encounter_id: kill.id, outcome: "KILL", event_at: "2026-09-17T12:47:00.000Z", status: "success",
    }));
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-token");
    expect(state.unlocked).toBe(1);
    expect(state.released).toBe(1);
  });

  it("leaves an encounter pending when Discord returns a failure", async () => {
    const { db, posted } = fakeDb([kill]);
    const { fetchImpl } = fakeFetch([500]);
    const warn = vi.spyOn(log, "warn");
    const result = await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 0, remaining: 1, reason: "delivery_failed" });
    expect(posted.has(kill.id)).toBe(false);
    expect(warn).toHaveBeenCalledWith("discord_bounty_failed", expect.objectContaining({
      encounter_id: kill.id, outcome: "KILL", http_status: 500, reason: "webhook_delivery_failed",
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
  });

  it("leaves an encounter pending on a transient network error and retries it next cycle", async () => {
    const { db, posted } = fakeDb([kill]);
    const flaky = fakeFetch([new TypeError("fetch failed")]);
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl: flaky.fetchImpl, sleep: noSleep })).toMatchObject({ posted: 0, reason: "delivery_failed" });
    expect(posted.has(kill.id)).toBe(false);

    const healthy = fakeFetch([204]);
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl: healthy.fetchImpl, sleep: noSleep })).toEqual({ posted: 1, remaining: 0 });
    expect(healthy.calls[0].payload).toEqual(formatEncounterPayload(kill));
    expect(posted.has(kill.id)).toBe(true);
  });

  it("skips encounters that are already recorded as posted", async () => {
    const { db, posted } = fakeDb([older, kill, failed], { posted: [older.id, kill.id] });
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 1, remaining: 0 });
    expect(calls.map((call) => call.payload.embeds[0].description)).toEqual([formatEncounterPayload(failed).embeds[0].description]);
    expect(posted.size).toBe(3);

    const again = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl: again.fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0 });
    expect(again.calls).toHaveLength(0);
  });

  it("delivers pending encounters oldest first regardless of storage order", async () => {
    const { db, sql } = fakeDb([failed, kill, older]);
    const { fetchImpl, calls } = fakeFetch();
    await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(calls.map((call) => call.payload.embeds[0].description)).toEqual([
      formatEncounterPayload(older).embeds[0].description,
      formatEncounterPayload(kill).embeds[0].description,
      formatEncounterPayload(failed).embeds[0].description,
    ]);
    const pendingQuery = sql.find((text) => text.includes("FROM bounty_encounters"));
    expect(pendingQuery?.replace(/\s+/g, " ")).toContain("ORDER BY e.event_at ASC, e.id ASC");
  });

  it("stops at the first failure so later encounters wait behind it", async () => {
    const { db, posted } = fakeDb([older, kill, failed]);
    const { fetchImpl, calls } = fakeFetch([204, 429]);
    const result = await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 1, remaining: 2, reason: "delivery_failed" });
    expect(calls).toHaveLength(2);
    expect([...posted]).toEqual([older.id]);
  });

  it("respects the per-cycle batch size", async () => {
    const { db } = fakeDb([older, kill, failed]);
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep, batchSize: 2 })).toEqual({ posted: 2, remaining: 0 });
    expect(calls).toHaveLength(2);
  });

  it("skips the cycle when another publisher holds the advisory lock", async () => {
    const { db, state } = fakeDb([kill], { lockHeld: true });
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "locked" });
    expect(calls).toHaveLength(0);
    expect(state.unlocked).toBe(0);
    expect(state.released).toBe(1);
  });

  it("never throws: database problems are logged and reported as publisher errors", async () => {
    const warn = vi.spyOn(log, "warn");
    const offline = fakeDb([kill], { failConnect: true });
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db: offline.db, fetchImpl: fakeFetch().fetchImpl, sleep: noSleep }))
      .toEqual({ posted: 0, remaining: 0, reason: "publisher_error" });
    const markFails = fakeDb([kill], { failMark: true });
    expect(await publishPendingDiscordEncounters({ webhook: WEBHOOK, db: markFails.db, fetchImpl: fakeFetch().fetchImpl, sleep: noSleep }))
      .toEqual({ posted: 0, remaining: 0, reason: "publisher_error" });
    expect(markFails.state.released).toBe(1);
    expect(markFails.state.unlocked).toBe(1);
    expect(warn).toHaveBeenCalledWith("discord_bounty_failed", expect.objectContaining({ reason: "publisher_error" }));
  });
});
