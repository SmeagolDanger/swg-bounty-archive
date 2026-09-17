# Live Discord encounter feed

The worker can announce every newly archived bounty encounter in one or more
Discord channels through plain channel webhooks. There is no gateway bot,
queue, or extra service: PostgreSQL remains the source of truth and Discord is
only a notification output.

## Configuration

Set `DISCORD_BOUNTY_WEBHOOK_URL` in `.env.production` to one or more webhook
URLs separated by commas (Discord channel → **Integrations → Webhooks → New
Webhook**). Each webhook belongs to one channel, so posting to several servers
means one webhook per server:

```
DISCORD_BOUNTY_WEBHOOK_URL=https://discord.com/api/webhooks/…/…,https://discord.com/api/webhooks/…/…
```

`docker-compose.prod.yml` passes it to the `worker` container; it is never
read by browser code. Leaving it blank or unset disables the feed with no
other effect. It is deliberately separate from `DISCORD_REPORT_WEBHOOK_URL`
(weekly report) and `PARSER_REPORT_WEBHOOK_URL` (BattleTrace reports).

## What gets posted

One embed per encounter, built from the archived `bounty_encounters` row and
the canonical `KILL` / `FAILED` outcome values. Names are used exactly as
stored; mention parsing is disabled so a player name can never ping anyone.

| Outcome  | Colour            | Title                               | Body                     |
|----------|-------------------|-------------------------------------|--------------------------|
| `KILL`   | green `0x57F287`  | `Hunter collected on Target`        | `**19,154 cr** payout`   |
| `FAILED` | red `0xED4245`    | `Hunter failed to collect on Target`| `No payout`              |

The encounter's `event_at` is sent as the embed `timestamp`, which Discord
renders in the footer in each reader's own timezone ("Today at 12:47 PM").

## When messages are sent

```
SWG Legends → runIngestion("POLL") → COMMIT → heartbeat → publishPendingDiscordEncounters() → Discord
```

`publishPendingDiscordEncounters` (`src/lib/discord/encounter-feed.ts`) runs
after every worker poll, outside `processBounty()` and outside the ingestion
transaction. For each configured webhook it selects encounters with no row for
that webhook in `discord_encounter_posts`, ordered `event_at ASC, id ASC`,
posts them one at a time (at most 25 per webhook per cycle, spaced 500 ms
apart to respect Discord's per-webhook rate limit), and inserts the tracking
row only after Discord returns a 2xx.

## Delivery tracking

Each webhook is identified by `webhook_key`, the first 16 hex characters of the
SHA-256 of its URL. The key is what gets stored and logged; the URL never is.
Changing a webhook URL therefore counts as adding a new webhook.

- `discord_feed_webhooks` has one row per key the worker has ever seen.
- `discord_encounter_posts` has one row per `(encounter_id, webhook_key)` that
  was delivered (or bootstrapped, see below).

## Retry and duplicate protection

- A failed post (non-2xx, timeout, network error) is logged and the loop for
  that webhook stops for the cycle. The failed encounter and everything newer
  stay pending for that webhook and are retried on the next poll, so ordering
  is preserved and nothing is lost to a transient outage. Other webhooks are
  unaffected and keep receiving posts. There are no retries within a cycle.
- The composite primary key means an encounter can be marked at most once per
  webhook, and a webhook that was down is never re-sent what a healthy one
  already received.
- A session-level advisory lock means overlapping publishers (for example the
  outgoing and incoming worker during a rolling restart) skip the cycle rather
  than double-post.
- Any failure inside the publisher is caught and logged; it never marks the
  ingestion run failed, rolls back archived data, changes the heartbeat, or
  stops the worker.

## Historical encounters

The first time a webhook key is seen, the worker registers it in
`discord_feed_webhooks` and, in the same transaction, records every encounter
already in the archive as posted for that key before sending anything. Only
encounters archived after that point are announced to it. This applies to the
original webhook when upgrading past migration `0018`, and to every webhook
added later, so adding a server never replays the archive into it.

Migration `0017` performed the same seeding for the original single-webhook
table; those rows are retained under the placeholder key `legacy` and are not
consulted.

## Logging

- `discord_bounty_bootstrapped` (info): a webhook key was seen for the first
  time, with `seeded_encounters`.
- `discord_bounty_posted` (info) and `discord_bounty_failed` (warn) carry
  `webhook_key`, `encounter_id`, `outcome`, `event_at`, `http_status` where
  relevant, and `remaining` (pending rows left in that webhook's batch).
