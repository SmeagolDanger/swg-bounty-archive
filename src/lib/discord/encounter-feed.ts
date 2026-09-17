import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { errorLogContext, log } from "../observability/logger";

// Live Discord feed of newly archived bounty encounters. The worker calls
// publishPendingDiscordEncounters after each poll, once ingestion has
// committed. DISCORD_BOUNTY_WEBHOOK_URL may list several webhooks; delivery is
// tracked per encounter per webhook in discord_encounter_posts, and a row is
// written only after that webhook accepted the message. Postgres stays
// authoritative; Discord is a notification output and can never fail or roll
// back ingestion.

export const ENCOUNTER_FEED_COLORS = { KILL: 0x57f287, FAILED: 0xed4245 } as const;
export const ENCOUNTER_FEED_BATCH_SIZE = 25;
export const ENCOUNTER_FEED_SPACING_MS = 500;
export const ENCOUNTER_FEED_TIMEOUT_MS = 10_000;
// Session-level advisory lock: two overlapping publishers (for example the old
// and new worker during a rolling restart) must not announce the same row.
const LOCK_SQL = "hashtext('swg-bounty-archive-discord-encounter-feed')";

export interface PendingEncounter {
  id: string;
  event_at: Date | string;
  outcome: string;            // 'KILL' | 'FAILED' exactly as stored in bounty_encounters
  hunter_name: string;
  target_name: string;
  credits: number | string;   // bigint arrives from pg as a string
}

export interface FeedWebhook {
  key: string;                // short hash of the URL; safe to store and log
  url: string;
}

export interface EncounterFeedPayload {
  allowed_mentions: { parse: never[] };
  embeds: Array<{ color: number; title: string; description: string; timestamp: string }>;
}

export interface EncounterFeedDeps {
  webhooks?: string;          // raw DISCORD_BOUNTY_WEBHOOK_URL value
  db?: Pick<Pool, "connect">;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface EncounterFeedResult {
  posted: number;
  remaining: number;
  reason?: "disabled" | "locked" | "delivery_failed" | "publisher_error";
}

type Queryable = Pick<PoolClient, "query">;

export class DiscordWebhookError extends Error {
  constructor(readonly status: number) {
    super(`Discord webhook returned HTTP ${status}`);
    this.name = "DiscordWebhookError";
  }
}

// ------------------------------------------------------------- configuration

export function webhookKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// Comma, space or newline separated; blanks and repeats are dropped.
export function parseWebhookList(raw: string | undefined): FeedWebhook[] {
  const seen = new Set<string>();
  const webhooks: FeedWebhook[] = [];
  for (const url of (raw ?? "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean)) {
    if (seen.has(url)) continue;
    seen.add(url);
    webhooks.push({ key: webhookKey(url), url });
  }
  return webhooks;
}

// ---------------------------------------------------------------- formatting

export function formatCredits(credits: number | string): string {
  return Number(credits).toLocaleString("en-US");
}

export function formatEncounterPayload(encounter: PendingEncounter): EncounterFeedPayload {
  const collected = encounter.outcome === "KILL";
  const headline = collected
    ? `${encounter.hunter_name} collected on ${encounter.target_name}`
    : `${encounter.hunter_name} failed to collect on ${encounter.target_name}`;
  const payout = collected ? `**${formatCredits(encounter.credits)} cr** payout` : "No payout";
  return {
    // No mention parsing: a player name must never ping the channel.
    allowed_mentions: { parse: [] },
    // Title, one-line body, and the encounter time as the embed timestamp,
    // which Discord renders in the footer in each reader's local time
    // ("Today at 12:47 PM").
    embeds: [{
      color: collected ? ENCOUNTER_FEED_COLORS.KILL : ENCOUNTER_FEED_COLORS.FAILED,
      title: headline,
      description: payout,
      timestamp: new Date(encounter.event_at).toISOString(),
    }],
  };
}

// ------------------------------------------------------------------ database

// First sighting of a webhook: record every encounter that already exists as
// posted for it, so a newly added server never receives the historical archive.
// Returns the number of encounters seeded, or null when the key was already known.
export async function bootstrapWebhook(client: Queryable, key: string): Promise<number | null> {
  await client.query("BEGIN");
  try {
    const seeded = await client.query<{ n: number }>(
      `WITH registered AS (
         INSERT INTO discord_feed_webhooks(webhook_key, bootstrapped_encounters)
         VALUES($1, (SELECT count(*) FROM bounty_encounters))
         ON CONFLICT (webhook_key) DO NOTHING RETURNING webhook_key
       ), seeded AS (
         INSERT INTO discord_encounter_posts(encounter_id, webhook_key)
         SELECT e.id, r.webhook_key FROM bounty_encounters e CROSS JOIN registered r
         ON CONFLICT (encounter_id, webhook_key) DO NOTHING RETURNING encounter_id
       )
       SELECT (SELECT count(*)::int FROM seeded) AS n WHERE EXISTS (SELECT 1 FROM registered)`,
      [key],
    );
    await client.query("COMMIT");
    return seeded.rows[0]?.n ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function findPendingEncounters(client: Queryable, key: string, limit: number): Promise<PendingEncounter[]> {
  const result = await client.query<PendingEncounter>(
    `SELECT e.id, e.event_at, e.outcome, e.hunter_name, e.target_name, e.credits
     FROM bounty_encounters e
     WHERE NOT EXISTS (SELECT 1 FROM discord_encounter_posts p WHERE p.encounter_id = e.id AND p.webhook_key = $1)
     ORDER BY e.event_at ASC, e.id ASC
     LIMIT $2`,
    [key, limit],
  );
  return result.rows;
}

export async function markEncounterPosted(client: Queryable, encounterId: string, key: string): Promise<void> {
  await client.query(
    "INSERT INTO discord_encounter_posts(encounter_id, webhook_key) VALUES($1,$2) ON CONFLICT (encounter_id, webhook_key) DO NOTHING",
    [encounterId, key],
  );
}

// ------------------------------------------------------------------- webhook

export async function sendEncounterWebhook(webhook: string, encounter: PendingEncounter, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formatEncounterPayload(encounter)),
    signal: AbortSignal.timeout(ENCOUNTER_FEED_TIMEOUT_MS),
  });
  if (!response.ok) throw new DiscordWebhookError(response.status);
}

// ----------------------------------------------------------------- publisher

function encounterLogContext(encounter: PendingEncounter, webhook: FeedWebhook): Record<string, unknown> {
  return {
    source: "discord_bounty_feed",
    webhook_key: webhook.key,
    encounter_id: encounter.id,
    outcome: encounter.outcome,
    event_at: new Date(encounter.event_at).toISOString(),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Delivery { posted: number; remaining: number; failed: boolean }

async function deliverToWebhook(client: Queryable, webhook: FeedWebhook, deps: Required<Pick<EncounterFeedDeps, "fetchImpl" | "batchSize" | "sleep">>): Promise<Delivery> {
  const seeded = await bootstrapWebhook(client, webhook.key);
  if (seeded !== null) {
    log.info("discord_bounty_bootstrapped", {
      source: "discord_bounty_feed", status: "success", webhook_key: webhook.key, seeded_encounters: seeded,
    });
  }
  const pending = await findPendingEncounters(client, webhook.key, deps.batchSize);
  let posted = 0;
  for (const encounter of pending) {
    // Space posts out so a backlog stays inside Discord's per-webhook rate limit.
    if (posted > 0) await deps.sleep(ENCOUNTER_FEED_SPACING_MS);
    try {
      await sendEncounterWebhook(webhook.url, encounter, deps.fetchImpl);
    } catch (error) {
      // Stop at the first failure so this webhook's feed stays oldest-first;
      // everything from here on remains pending and is retried on a later cycle.
      log.warn("discord_bounty_failed", {
        ...encounterLogContext(encounter, webhook), status: "failed", reason: "webhook_delivery_failed",
        http_status: error instanceof DiscordWebhookError ? error.status : undefined,
        remaining: pending.length - posted, ...errorLogContext(error),
      });
      return { posted, remaining: pending.length - posted, failed: true };
    }
    await markEncounterPosted(client, encounter.id, webhook.key);
    posted += 1;
    log.info("discord_bounty_posted", { ...encounterLogContext(encounter, webhook), status: "success" });
  }
  return { posted, remaining: 0, failed: false };
}

// Never throws: the worker calls this after ingestion has committed and after
// the heartbeat, and a Discord problem must not surface as an ingestion failure.
export async function publishPendingDiscordEncounters(deps: EncounterFeedDeps = {}): Promise<EncounterFeedResult> {
  const webhooks = parseWebhookList(deps.webhooks ?? process.env.DISCORD_BOUNTY_WEBHOOK_URL);
  if (webhooks.length === 0) return { posted: 0, remaining: 0, reason: "disabled" };
  const delivery = {
    fetchImpl: deps.fetchImpl ?? fetch,
    batchSize: deps.batchSize ?? ENCOUNTER_FEED_BATCH_SIZE,
    sleep: deps.sleep ?? defaultSleep,
  };

  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await (deps.db ?? pool).connect();
    const lock = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { posted: 0, remaining: 0, reason: "locked" };

    const result: EncounterFeedResult = { posted: 0, remaining: 0 };
    for (const webhook of webhooks) {
      // Each webhook has its own cursor, so one server being down never
      // holds up the others.
      const outcome = await deliverToWebhook(client, webhook, delivery);
      result.posted += outcome.posted;
      result.remaining += outcome.remaining;
      if (outcome.failed) result.reason = "delivery_failed";
    }
    return result;
  } catch (error) {
    log.warn("discord_bounty_failed", {
      source: "discord_bounty_feed", status: "failed", reason: "publisher_error", ...errorLogContext(error),
    });
    return { posted: 0, remaining: 0, reason: "publisher_error" };
  } finally {
    if (client) {
      if (locked) await client.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`).catch(() => undefined);
      client.release();
    }
  }
}
