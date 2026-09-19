# Cloudflare standby capture

SWG Legends exposes only the 12 most recent bounty encounters, so if the
collector is down for long enough, encounters scroll out of that window and
are lost for good. The standby is a small Cloudflare Worker with a private R2
bucket that captures the feed only while the primary collector is silent, and
a replay command that ingests those captures through the normal pipeline
afterwards. It costs nothing on Cloudflare's free tier and never touches the
source while the primary is healthy, so it does not interfere with the
source's 300-second cache that the primary relies on.

```
normal:  worker poll ──archive──▶ POST /heartbeat ──▶ Worker idles
outage:  heartbeats stop ▶ cron sees stale heartbeat ▶ fetch bounty feed every ~5 min ▶ R2
after:   npm run ingest:replay --since <outage start> ▶ captures → archive (dedup by fingerprint)
```

## Components

- `cloudflare/bounty-capture/`: the Worker. Cron every minute reads the
  heartbeat from R2; if it is older than `STALE_AFTER_SECONDS` (360) and the
  last fetch was at least 290 s ago, it fetches `/api/game/bounty-hunting` and
  stores the payload under `captures/<ISO time>-<sha8>.json` unless the
  payload hash is unchanged. All HTTP routes require
  `Authorization: Bearer <CAPTURE_TOKEN>`:
  `POST /heartbeat`, `POST /capture` (force one now), `GET /status`,
  `GET /captures?since=&until=`, `GET /captures/<key>`.
- `src/lib/capture/heartbeat.ts`: the worker calls this after every poll in
  which the bounty source was archived (`PROCESSED`). Disabled when
  `CAPTURE_STANDBY_URL` or `CAPTURE_STANDBY_TOKEN` is blank; failures are
  logged as `capture_heartbeat_failed` and never affect ingestion.
- `scripts/replay-captures.ts` (`npm run ingest:replay`): lists captures in a
  time range, ingests each one via `ingestCapture` as a `BACKFILL` run with
  the capture time as the observation time, and marks replayed encounters as
  already posted to every Discord feed unless `--announce` is given.

## One-time setup

1. Enable R2 on the Cloudflare account (Dashboard → R2 → Get started; the
   free tier needs a payment method on file but is not charged).
2. From `cloudflare/bounty-capture/`:
   ```bash
   npm install
   npx wrangler r2 bucket create swg-bounty-captures
   npx wrangler r2 bucket lifecycle add swg-bounty-captures expire-captures --prefix captures/ --expire-days 90
   openssl rand -hex 32 | npx wrangler secret put CAPTURE_TOKEN
   npm run deploy
   ```
   Keep the generated token; the VPS needs the same value.
3. In `.env.production` set `CAPTURE_STANDBY_URL` to the Worker URL printed
   by `deploy` (`https://swg-bounty-capture.<subdomain>.workers.dev`) and
   `CAPTURE_STANDBY_TOKEN` to the token, then `docker compose ... up -d worker`.
4. Check it: `curl -H "Authorization: Bearer $CAPTURE_STANDBY_TOKEN" $CAPTURE_STANDBY_URL/status`
   should show a recent `heartbeatAt` and `"standby": {"capture": false, "reason": "primary_healthy"}`.

The GitHub Actions workflow `cloudflare-capture.yml` redeploys the Worker on
pushes that touch `cloudflare/bounty-capture/`. It needs repository secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, Workers R2 Storage:Edit) and
`CLOUDFLARE_ACCOUNT_ID`.

## After an outage

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  npm run ingest:replay -- --since 2026-09-18T20:00:00Z --dry-run   # list what was captured
docker compose --env-file .env.production -f docker-compose.prod.yml exec worker \
  npm run ingest:replay -- --since 2026-09-18T20:00:00Z             # ingest it
```

Replays are idempotent: encounters the primary already archived are
deduplicated by fingerprint, and re-running the same range inserts nothing
new. The run appears in the ingestion console as a `BACKFILL` run whose raw
rows carry `parameters.capture` with the R2 key.

## Alerts

Set the optional `ALERT_WEBHOOK_URL` secret on the Worker
(`npx wrangler secret put ALERT_WEBHOOK_URL` from `cloudflare/bounty-capture/`)
to a Discord webhook and the standby posts:

- a red embed once when it takes over (the primary has been silent for
  `STALE_AFTER_SECONDS`), with the last heartbeat time;
- a green embed once when heartbeats resume, with the number of captures
  stored and the exact `npm run ingest:replay -- --since …` command to run;
- an amber embed at most once an hour while its own captures fail during a
  takeover (for example if the source blocks the request), since that means
  data is being lost.

This is the outside-in alert for the collector: it does not depend on the
VPS, Axiom, or anything else on the primary side. `GET /status` shows
`takeoverAt` and whether alerts are configured.

## Limits and behaviour

- Takeover latency: up to `STALE_AFTER_SECONDS` plus one cron minute after
  the primary's last heartbeat, then captures roughly every five minutes.
  Under a very busy few minutes some encounters could still scroll past, the
  same limitation the primary has.
- Unchanged payloads are not stored, so a quiet night of outage costs a
  handful of objects. Objects expire after 90 days via the lifecycle rule.
- The bucket is private; the only access is the Worker's token-protected
  routes. The token is never logged by either side.
