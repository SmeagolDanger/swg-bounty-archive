import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/observability/logger";
import {
  ENCOUNTER_FEED_COLORS,
  formatCredits,
  formatEncounterPayload,
  parseWebhookList,
  publishPendingDiscordEncounters,
  webhookKey,
  type PendingEncounter,
} from "./encounter-feed";

const WEBHOOK = "https://discord.test/api/webhooks/123/secret-token";
const WEBHOOK_B = "https://discord.test/api/webhooks/456/other-secret";
const KEY = webhookKey(WEBHOOK);
const KEY_B = webhookKey(WEBHOOK_B);

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
const mark = (id: string, key: string) => `${id}|${key}`;
type StoredEncounter = PendingEncounter & { first_observed_at?: Date };

// In-memory stand-in for the pool: enough SQL awareness to answer the lock,
// the per-webhook bootstrap, the pending query (oldest first, skipping posted
// rows) and the mark insert.
function fakeDb(
  encounters: StoredEncounter[],
  options: { posted?: string[]; knownWebhooks?: string[]; lockHeld?: boolean; failMark?: boolean; failConnect?: boolean } = {},
) {
  const posted = new Set(options.posted ?? []);
  const known = new Set(options.knownWebhooks ?? []);
  const sql: string[] = [];
  const state = { released: 0, unlocked: 0, bootstraps: 0 };
  const client = {
    async query(text: string, values: unknown[] = []) {
      sql.push(text);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [], rowCount: null };
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: !options.lockHeld }], rowCount: 1 };
      if (text.includes("pg_advisory_unlock")) { state.unlocked += 1; return { rows: [{}], rowCount: 1 }; }
      if (text.includes("INSERT INTO discord_feed_webhooks")) {
        const key = String(values[0]);
        const cutoff = (values[1] as Date).getTime();
        if (known.has(key)) return { rows: [], rowCount: 0 };
        known.add(key);
        state.bootstraps += 1;
        let n = 0;
        for (const row of encounters) {
          if ((row.first_observed_at ?? new Date(0)).getTime() >= cutoff) continue;
          if (!posted.has(mark(row.id, key))) { posted.add(mark(row.id, key)); n += 1; }
        }
        return { rows: [{ n }], rowCount: 1 };
      }
      if (text.includes("AS pending")) {
        const key = String(values[0]);
        const pending = encounters.filter((row) => !posted.has(mark(row.id, key)));
        const oldest = pending.map((row) => row.first_observed_at ?? new Date()).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        return { rows: [{ pending: pending.length, oldest_pending_at: oldest }], rowCount: 1 };
      }
      if (text.includes("FROM bounty_encounters e")) {
        const key = String(values[0]);
        const rows = encounters
          .filter((row) => !posted.has(mark(row.id, key)))
          .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime() || a.id.localeCompare(b.id))
          .slice(0, Number(values[1]));
        return { rows, rowCount: rows.length };
      }
      if (text.includes("INSERT INTO discord_encounter_posts")) {
        if (options.failMark) throw new Error("database unavailable");
        const entry = mark(String(values[0]), String(values[1]));
        const inserted = !posted.has(entry);
        posted.add(entry);
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
  return { db, posted, known, sql, state };
}

function fakeFetch(statuses: Record<string, Array<number | Error>> | Array<number | Error> = []) {
  const calls: { url: string; init: RequestInit; payload: ReturnType<typeof formatEncounterPayload> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const perUrl = calls.filter((call) => call.url === target).length;
    const queue = Array.isArray(statuses) ? statuses : statuses[target] ?? [];
    const outcome = queue[Array.isArray(statuses) ? calls.length : perUrl] ?? 204;
    calls.push({ url: target, init: init ?? {}, payload: JSON.parse(String(init?.body)) });
    if (outcome instanceof Error) throw outcome;
    return new Response(null, { status: outcome });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const titles = (calls: { payload: ReturnType<typeof formatEncounterPayload> }[]) => calls.map((call) => call.payload.embeds[0].title);
// A webhook already bootstrapped, so the fake behaves like a live feed.
const live = { knownWebhooks: [KEY] };

// Keep test output quiet; individual tests re-spy to assert on calls.
beforeEach(() => {
  vi.spyOn(log, "info").mockImplementation(() => undefined);
  vi.spyOn(log, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("parseWebhookList", () => {
  it("splits on commas, whitespace and newlines, trims, dedupes and keeps order", () => {
    const parsed = parseWebhookList(` ${WEBHOOK}, ${WEBHOOK_B}\n${WEBHOOK} ,,  `);
    expect(parsed.map((item) => item.url)).toEqual([WEBHOOK, WEBHOOK_B]);
    expect(parsed.map((item) => item.key)).toEqual([KEY, KEY_B]);
  });

  it("yields nothing for unset or blank values", () => {
    expect(parseWebhookList(undefined)).toEqual([]);
    expect(parseWebhookList("")).toEqual([]);
    expect(parseWebhookList("  , \n ")).toEqual([]);
  });

  it("derives a stable short key that does not reveal the URL", () => {
    expect(webhookKey(WEBHOOK)).toBe(KEY);
    expect(KEY).toMatch(/^[0-9a-f]{16}$/);
    expect(WEBHOOK).not.toContain(KEY);
    expect(KEY).not.toBe(KEY_B);
  });
});

describe("formatEncounterPayload", () => {
  it("formats a collected bounty as a green embed with a thousands-separated payout", () => {
    const payload = formatEncounterPayload(kill);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].color).toBe(ENCOUNTER_FEED_COLORS.KILL);
    expect(payload.embeds[0].color).toBe(0x57f287);
    expect(payload.embeds[0].title).toBe("Yesrem collected on Vulture");
    expect(payload.embeds[0].description).toBe("**19,154 cr** payout");
    expect(payload.embeds[0].timestamp).toBe("2026-09-17T12:47:00.000Z");
  });

  it("formats a failed bounty as a red embed that says No payout", () => {
    const payload = formatEncounterPayload(failed);
    expect(payload.embeds[0].color).toBe(ENCOUNTER_FEED_COLORS.FAILED);
    expect(payload.embeds[0].color).toBe(0xed4245);
    expect(payload.embeds[0].title).toBe("Yesrem failed to collect on Easton");
    expect(payload.embeds[0].description).toBe("No payout");
    expect(payload.embeds[0].timestamp).toBe("2026-09-17T12:52:00.000Z");
    expect(payload.embeds[0].description).not.toContain("cr");
  });

  it("applies thousands separators to numeric and string credit values", () => {
    expect(formatCredits("19154")).toBe("19,154");
    expect(formatCredits(1_250_000)).toBe("1,250,000");
    expect(formatCredits(500)).toBe("500");
    expect(formatEncounterPayload(older).embeds[0].description).toContain("**1,250,000 cr** payout");
  });

  it("uses the encounter's event_at as the embed timestamp, whether a Date or an ISO string", () => {
    expect(formatEncounterPayload(kill).embeds[0].timestamp).toBe(new Date(kill.event_at).toISOString());
    expect(formatEncounterPayload(failed).embeds[0].timestamp).toBe("2026-09-17T12:52:00.000Z");
    expect(formatEncounterPayload({ ...kill, event_at: "2026-09-17T12:47:00.999Z" }).embeds[0].timestamp).toBe("2026-09-17T12:47:00.999Z");
  });

  it("disables mention parsing and preserves names exactly as stored", () => {
    const payload = formatEncounterPayload({ ...kill, hunter_name: "Dar'k Hun-ter", target_name: "@everyone" });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].title).toBe("Dar'k Hun-ter collected on @everyone");
  });
});

describe("publishPendingDiscordEncounters", () => {
  it("is a clean no-op when the webhook list is unset or blank", async () => {
    vi.stubEnv("DISCORD_BOUNTY_WEBHOOK_URL", "");
    const { fetchImpl, calls } = fakeFetch();
    const connect = vi.fn();
    const db = { connect } as unknown as Pick<Pool, "connect">;
    expect(await publishPendingDiscordEncounters({ db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    expect(await publishPendingDiscordEncounters({ webhooks: " , ", db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    vi.unstubAllEnvs();
    delete process.env.DISCORD_BOUNTY_WEBHOOK_URL;
    expect(await publishPendingDiscordEncounters({ db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "disabled" });
    expect(connect).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("bootstraps a webhook seen for the first time without posting the existing archive", async () => {
    const { db, posted, known, state } = fakeDb([older, kill]);
    const { fetchImpl, calls } = fakeFetch();
    const info = vi.spyOn(log, "info");
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0 });
    expect(calls).toHaveLength(0);
    expect(known.has(KEY)).toBe(true);
    expect(posted).toEqual(new Set([mark(older.id, KEY), mark(kill.id, KEY)]));
    expect(info).toHaveBeenCalledWith("discord_bounty_bootstrapped", expect.objectContaining({ webhook_key: KEY, seeded_encounters: 2 }));
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-token");

    // Only encounters archived after the bootstrap are announced.
    const { fetchImpl: laterFetch, calls: laterCalls } = fakeFetch();
    const later = { ...failed };
    const withNew = fakeDb([older, kill, later], { posted: [...posted], knownWebhooks: [...known] });
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db: withNew.db, fetchImpl: laterFetch, sleep: noSleep })).toEqual({ posted: 1, remaining: 0 });
    expect(titles(laterCalls)).toEqual([formatEncounterPayload(later).embeds[0].title]);
    expect(withNew.state.bootstraps).toBe(0);
    expect(state.bootstraps).toBe(1);
  });

  it("marks an encounter posted only after Discord accepts it and logs without the webhook URL", async () => {
    const { db, posted, state } = fakeDb([kill], live);
    const { fetchImpl, calls } = fakeFetch([204]);
    const info = vi.spyOn(log, "info");
    const result = await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 1, remaining: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].payload).toEqual(formatEncounterPayload(kill));
    expect(posted.has(mark(kill.id, KEY))).toBe(true);
    expect(info).toHaveBeenCalledWith("discord_bounty_posted", expect.objectContaining({
      encounter_id: kill.id, outcome: "KILL", event_at: "2026-09-17T12:47:00.000Z", status: "success", webhook_key: KEY,
    }));
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-token");
    expect(state.unlocked).toBe(1);
    expect(state.released).toBe(1);
  });

  it("leaves an encounter pending when Discord returns a failure", async () => {
    const { db, posted } = fakeDb([kill], live);
    const { fetchImpl } = fakeFetch([500]);
    const warn = vi.spyOn(log, "warn");
    const result = await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 0, remaining: 1, reason: "delivery_failed" });
    expect(posted.has(mark(kill.id, KEY))).toBe(false);
    expect(warn).toHaveBeenCalledWith("discord_bounty_failed", expect.objectContaining({
      encounter_id: kill.id, outcome: "KILL", http_status: 500, reason: "webhook_delivery_failed", webhook_key: KEY,
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
  });

  it("leaves an encounter pending on a transient network error and retries it next cycle", async () => {
    const { db, posted } = fakeDb([kill], live);
    const flaky = fakeFetch([new TypeError("fetch failed")]);
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: flaky.fetchImpl, sleep: noSleep })).toMatchObject({ posted: 0, reason: "delivery_failed" });
    expect(posted.has(mark(kill.id, KEY))).toBe(false);

    const healthy = fakeFetch([204]);
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: healthy.fetchImpl, sleep: noSleep })).toEqual({ posted: 1, remaining: 0 });
    expect(healthy.calls[0].payload).toEqual(formatEncounterPayload(kill));
    expect(posted.has(mark(kill.id, KEY))).toBe(true);
  });

  it("skips encounters that are already recorded as posted", async () => {
    const { db, posted } = fakeDb([older, kill, failed], { ...live, posted: [mark(older.id, KEY), mark(kill.id, KEY)] });
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 1, remaining: 0 });
    expect(titles(calls)).toEqual([formatEncounterPayload(failed).embeds[0].title]);
    expect(posted.size).toBe(3);

    const again = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: again.fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0 });
    expect(again.calls).toHaveLength(0);
  });

  it("delivers pending encounters oldest first regardless of storage order", async () => {
    const { db, sql } = fakeDb([failed, kill, older], live);
    const { fetchImpl, calls } = fakeFetch();
    await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(titles(calls)).toEqual([older, kill, failed].map((row) => formatEncounterPayload(row).embeds[0].title));
    const pendingQuery = sql.find((text) => text.includes("SELECT e.id, e.event_at"));
    expect(pendingQuery?.replace(/\s+/g, " ")).toContain("ORDER BY e.event_at ASC, e.id ASC");
  });

  it("stops at the first failure so later encounters wait behind it", async () => {
    const { db, posted } = fakeDb([older, kill, failed], live);
    const { fetchImpl, calls } = fakeFetch([204, 429]);
    const result = await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 1, remaining: 2, reason: "delivery_failed" });
    expect(calls).toHaveLength(2);
    expect([...posted]).toEqual([mark(older.id, KEY)]);
  });

  it("respects the per-webhook batch size", async () => {
    const { db } = fakeDb([older, kill, failed], live);
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep, batchSize: 2 })).toEqual({ posted: 2, remaining: 0 });
    expect(calls).toHaveLength(2);
  });

  it("posts to every configured webhook and tracks each one separately", async () => {
    const { db, posted } = fakeDb([older, kill], { knownWebhooks: [KEY, KEY_B] });
    const { fetchImpl, calls } = fakeFetch();
    const result = await publishPendingDiscordEncounters({ webhooks: `${WEBHOOK},${WEBHOOK_B}`, db, fetchImpl, sleep: noSleep });
    expect(result).toEqual({ posted: 4, remaining: 0 });
    expect(calls.filter((call) => call.url === WEBHOOK).map((call) => call.payload.embeds[0].title)).toEqual([older, kill].map((row) => formatEncounterPayload(row).embeds[0].title));
    expect(calls.filter((call) => call.url === WEBHOOK_B).map((call) => call.payload.embeds[0].title)).toEqual([older, kill].map((row) => formatEncounterPayload(row).embeds[0].title));
    expect(posted).toEqual(new Set([mark(older.id, KEY), mark(kill.id, KEY), mark(older.id, KEY_B), mark(kill.id, KEY_B)]));
  });

  it("keeps delivering to healthy webhooks when one is down, and never re-posts to the healthy one", async () => {
    const { db, posted } = fakeDb([older, kill], { knownWebhooks: [KEY, KEY_B] });
    const down = fakeFetch({ [WEBHOOK]: [502, 502] });
    const first = await publishPendingDiscordEncounters({ webhooks: `${WEBHOOK},${WEBHOOK_B}`, db, fetchImpl: down.fetchImpl, sleep: noSleep });
    expect(first).toEqual({ posted: 2, remaining: 2, reason: "delivery_failed" });
    expect(down.calls.filter((call) => call.url === WEBHOOK)).toHaveLength(1);
    expect(down.calls.filter((call) => call.url === WEBHOOK_B)).toHaveLength(2);
    expect(posted).toEqual(new Set([mark(older.id, KEY_B), mark(kill.id, KEY_B)]));

    const recovered = fakeFetch();
    const second = await publishPendingDiscordEncounters({ webhooks: `${WEBHOOK},${WEBHOOK_B}`, db, fetchImpl: recovered.fetchImpl, sleep: noSleep });
    expect(second).toEqual({ posted: 2, remaining: 0 });
    expect(recovered.calls.every((call) => call.url === WEBHOOK)).toBe(true);
    expect(titles(recovered.calls)).toEqual([older, kill].map((row) => formatEncounterPayload(row).embeds[0].title));
    expect(posted.size).toBe(4);
  });

  it("still announces encounters archived during the poll that first sees a webhook", async () => {
    const cycleStartedAt = new Date("2026-09-17T22:49:42Z");
    const archive: StoredEncounter[] = [
      { ...older, first_observed_at: new Date("2026-09-17T11:05:00Z") },
      { ...kill, first_observed_at: new Date("2026-09-17T22:49:43Z") },   // found by this poll
      { ...failed, first_observed_at: new Date("2026-09-17T22:49:43Z") }, // found by this poll
    ];
    const { db, posted } = fakeDb(archive);
    const { fetchImpl, calls } = fakeFetch();
    const info = vi.spyOn(log, "info");
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, archivedBefore: cycleStartedAt, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 2, remaining: 0 });
    expect(titles(calls)).toEqual([kill, failed].map((row) => formatEncounterPayload(row).embeds[0].title));
    expect(info).toHaveBeenCalledWith("discord_bounty_bootstrapped", expect.objectContaining({ seeded_encounters: 1 }));
    expect(posted).toEqual(new Set([mark(older.id, KEY), mark(kill.id, KEY), mark(failed.id, KEY)]));
  });

  it("bootstraps a webhook added later without replaying the archive to it", async () => {
    const { db, posted } = fakeDb([older, kill], { knownWebhooks: [KEY], posted: [mark(older.id, KEY), mark(kill.id, KEY)] });
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhooks: `${WEBHOOK},${WEBHOOK_B}`, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0 });
    expect(calls).toHaveLength(0);
    expect(posted.has(mark(older.id, KEY_B))).toBe(true);
    expect(posted.has(mark(kill.id, KEY_B))).toBe(true);
  });

  it("raises a backlog alert once per hour when a webhook has been failing for over an hour", async () => {
    const now = new Date("2026-09-19T12:00:00Z");
    const archive: StoredEncounter[] = [{ ...kill, first_observed_at: new Date("2026-09-19T10:30:00Z") }];
    const { db } = fakeDb(archive, live);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const alerts = new Map<string, number>();
    const down = fakeFetch([502]);
    await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: down.fetchImpl, sleep: noSleep, now: () => now, backlogAlerts: alerts });
    expect(warn).toHaveBeenCalledWith("discord_feed_backlog", expect.objectContaining({ webhook_key: KEY, pending: 1, oldest_pending_at: "2026-09-19T10:30:00.000Z" }));
    warn.mockClear();
    await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: fakeFetch([502]).fetchImpl, sleep: noSleep, now: () => new Date(now.getTime() + 5 * 60_000), backlogAlerts: alerts });
    expect(warn.mock.calls.filter(([event]) => event === "discord_feed_backlog")).toHaveLength(0);
    await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: fakeFetch([502]).fetchImpl, sleep: noSleep, now: () => new Date(now.getTime() + 61 * 60_000), backlogAlerts: alerts });
    expect(warn.mock.calls.filter(([event]) => event === "discord_feed_backlog")).toHaveLength(1);
  });

  it("does not raise a backlog alert for fresh pending encounters or transient hiccups", async () => {
    const now = new Date("2026-09-19T12:00:00Z");
    const archive: StoredEncounter[] = [{ ...kill, first_observed_at: new Date("2026-09-19T11:50:00Z") }];
    const { db } = fakeDb(archive, live);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl: fakeFetch([502]).fetchImpl, sleep: noSleep, now: () => now, backlogAlerts: new Map() });
    expect(warn.mock.calls.filter(([event]) => event === "discord_feed_backlog")).toHaveLength(0);
  });

  it("skips the cycle when another publisher holds the advisory lock", async () => {
    const { db, state } = fakeDb([kill], { ...live, lockHeld: true });
    const { fetchImpl, calls } = fakeFetch();
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db, fetchImpl, sleep: noSleep })).toEqual({ posted: 0, remaining: 0, reason: "locked" });
    expect(calls).toHaveLength(0);
    expect(state.unlocked).toBe(0);
    expect(state.released).toBe(1);
  });

  it("never throws: database problems are logged and reported as publisher errors", async () => {
    const warn = vi.spyOn(log, "warn");
    const offline = fakeDb([kill], { ...live, failConnect: true });
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db: offline.db, fetchImpl: fakeFetch().fetchImpl, sleep: noSleep }))
      .toEqual({ posted: 0, remaining: 0, reason: "publisher_error" });
    const markFails = fakeDb([kill], { ...live, failMark: true });
    expect(await publishPendingDiscordEncounters({ webhooks: WEBHOOK, db: markFails.db, fetchImpl: fakeFetch().fetchImpl, sleep: noSleep }))
      .toEqual({ posted: 0, remaining: 0, reason: "publisher_error" });
    expect(markFails.state.released).toBe(1);
    expect(markFails.state.unlocked).toBe(1);
    expect(warn).toHaveBeenCalledWith("discord_bounty_failed", expect.objectContaining({ reason: "publisher_error" }));
  });
});
