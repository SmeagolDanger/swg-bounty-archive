# Live Discord encounter feed

The worker can announce every newly archived bounty encounter in a Discord
channel through a plain channel webhook. There is no gateway bot, queue, or
extra service: PostgreSQL remains the source of truth and Discord is only a
notification output.

## Configuration

Set `DISCORD_BOUNTY_WEBHOOK_URL` in `.env.production` (Discord channel →
**Integrations → Webhooks → New Webhook**). `docker-compose.prod.yml` passes it
to the `worker` container; it is never read by browser code. Leaving it blank
or unset disables the feed with no other effect. It is deliberately separate
from `DISCORD_REPORT_WEBHOOK_URL` (weekly report) and
`PARSER_REPORT_WEBHOOK_URL` (BattleTrace reports).

## What gets posted

One embed per encounter, built from the archived `bounty_encounters` row and
the canonical `KILL` / `FAILED` outcome values. Names are used exactly as
stored; mention parsing is disabled so a player name can never ping anyone.

| Outcome  | Colour            | Description                                                   |
|----------|-------------------|---------------------------------------------------------------|
| `KILL`   | green `0x57F287`  | `**Hunter collected on Target**` / `**19,154 cr** payout`     |
| `FAILED` | red `0xED4245`    | `**Hunter failed to collect on Target**` / `No payout`        |

The last line is a Discord-native `<t:UNIX:f>` timestamp of the encounter's
`event_at`, so every reader sees it in their own timezone.

## When messages are sent

```
SWG Legends → runIngestion("POLL") → COMMIT → heartbeat → publishPendingDiscordEncounters() → Discord
```

`publishPendingDiscordEncounters` (`src/lib/discord/encounter-feed.ts`) runs
after every worker poll, outside `processBounty()` and outside the ingestion
transaction. It selects encounters with no row in `discord_encounter_posts`,
ordered `event_at ASC, id ASC`, posts them one at a time (at most 25 per cycle,
spaced 500 ms apart to respect Discord's webhook rate limit), and inserts the
tracking row only after Discord returns a 2xx.

## Retry and duplicate protection

- A failed post (non-2xx, timeout, network error) is logged and the loop stops
  for that cycle. The failed encounter and everything newer stay pending and
  are retried on the next poll, so ordering is preserved and nothing is lost to
  a transient outage. There are no retries within a cycle.
- `discord_encounter_posts.encounter_id` is the primary key, so an encounter
  can be marked at most once.
- A session-level advisory lock means overlapping publishers (for example the
  outgoing and incoming worker during a rolling restart) skip the cycle rather
  than double-post.
- Any failure inside the publisher is caught and logged; it never marks the
  ingestion run failed, rolls back archived data, changes the heartbeat, or
  stops the worker.

## Historical encounters

Migration `0017_discord_encounter_posts.sql` creates the tracking table and, in
the same transaction, inserts a row for every encounter already in the archive.
Those encounters are therefore treated as already posted and are never sent.
Only encounters archived after the migration ran are announced, so enabling
the feed on an existing deployment does not flood the channel.

## Logging

- `discord_bounty_posted` (info) and `discord_bounty_failed` (warn) carry
  `encounter_id`, `outcome`, `event_at`, `http_status` where relevant, and
  `remaining` (pending rows left in the batch). The webhook URL is never logged.
