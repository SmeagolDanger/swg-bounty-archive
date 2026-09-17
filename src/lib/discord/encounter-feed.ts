import type { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { errorLogContext, log } from "../observability/logger";

// Live Discord feed of newly archived bounty encounters. The worker calls
// publishPendingDiscordEncounters after each poll, once ingestion has
// committed. Delivery state lives in discord_encounter_posts: an encounter is
// pending until a row exists for it, and the row is written only after Discord
// accepted the message. Postgres stays authoritative; Discord is a notification
// output and can never fail or roll back ingestion.

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

export interface EncounterFeedPayload {
  allowed_mentions: { parse: never[] };
  embeds: Array<{ color: number; title: string; description: string }>;
}

export interface EncounterFeedDeps {
  webhook?: string;
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

// ---------------------------------------------------------------- formatting

export function formatCredits(credits: number | string): string {
  return Number(credits).toLocaleString("en-US");
}

// <t:UNIX:f> lets Discord render the encounter time in each reader's timezone.
export function discordTimestamp(value: Date | string): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>`;
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
    // Title + a two-line body keeps the card compact: Discord adds its own
    // small gap under the title, so no blank lines are needed.
    embeds: [{
      color: collected ? ENCOUNTER_FEED_COLORS.KILL : ENCOUNTER_FEED_COLORS.FAILED,
      title: headline,
      description: `${payout}\n${discordTimestamp(encounter.event_at)}`,
    }],
  };
}

// ------------------------------------------------------------------ database

export async function findPendingEncounters(client: Queryable, limit: number): Promise<PendingEncounter[]> {
  const result = await client.query<PendingEncounter>(
    `SELECT e.id, e.event_at, e.outcome, e.hunter_name, e.target_name, e.credits
     FROM bounty_encounters e
     WHERE NOT EXISTS (SELECT 1 FROM discord_encounter_posts p WHERE p.encounter_id = e.id)
     ORDER BY e.event_at ASC, e.id ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function markEncounterPosted(client: Queryable, encounterId: string): Promise<void> {
  await client.query(
    "INSERT INTO discord_encounter_posts(encounter_id) VALUES($1) ON CONFLICT (encounter_id) DO NOTHING",
    [encounterId],
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

function encounterLogContext(encounter: PendingEncounter): Record<string, unknown> {
  return {
    source: "discord_bounty_feed",
    encounter_id: encounter.id,
    outcome: encounter.outcome,
    event_at: new Date(encounter.event_at).toISOString(),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Never throws: the worker calls this after ingestion has committed and after
// the heartbeat, and a Discord problem must not surface as an ingestion failure.
export async function publishPendingDiscordEncounters(deps: EncounterFeedDeps = {}): Promise<EncounterFeedResult> {
  const webhook = (deps.webhook ?? process.env.DISCORD_BOUNTY_WEBHOOK_URL)?.trim();
  if (!webhook) return { posted: 0, remaining: 0, reason: "disabled" };
  const batchSize = deps.batchSize ?? ENCOUNTER_FEED_BATCH_SIZE;
  const sleep = deps.sleep ?? defaultSleep;
  const fetchImpl = deps.fetchImpl ?? fetch;

  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await (deps.db ?? pool).connect();
    const lock = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { posted: 0, remaining: 0, reason: "locked" };

    const pending = await findPendingEncounters(client, batchSize);
    let posted = 0;
    for (const encounter of pending) {
      // Space posts out so a backlog stays inside Discord's webhook rate limit.
      if (posted > 0) await sleep(ENCOUNTER_FEED_SPACING_MS);
      try {
        await sendEncounterWebhook(webhook, encounter, fetchImpl);
      } catch (error) {
        // Stop at the first failure so the feed stays oldest-first; everything
        // from here on remains pending and is retried on a later cycle.
        log.warn("discord_bounty_failed", {
          ...encounterLogContext(encounter), status: "failed", reason: "webhook_delivery_failed",
          http_status: error instanceof DiscordWebhookError ? error.status : undefined,
          remaining: pending.length - posted, ...errorLogContext(error),
        });
        return { posted, remaining: pending.length - posted, reason: "delivery_failed" };
      }
      await markEncounterPosted(client, encounter.id);
      posted += 1;
      log.info("discord_bounty_posted", { ...encounterLogContext(encounter), status: "success" });
    }
    return { posted, remaining: 0 };
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
