# Backups to Cloudflare R2

The `backup` service in `docker-compose.prod.yml` runs `backups/scheduler.sh`
and needs no cron on the host.

Every night at `BACKUP_AT` (UTC, default 03:15):

1. `backups/backup.sh` writes `swg-bounty-<UTC time>.dump` (pg_dump custom
   format) plus a `.sha256` sidecar to the `backups/` directory on the host
   (`BACKUP_PATH`), keeping `BACKUP_LOCAL_RETENTION_DAYS` days locally.
2. `backups/verify.sh` checks the checksum and that the archive lists the
   required tables.
3. `backups/r2.sh` uploads both files with rclone to
   `R2_BACKUP_BUCKET/backups/daily/` and confirms the remote size. On the 1st
   of the month a second copy goes to `backups/monthly/`.
4. Remote daily copies older than `BACKUP_R2_DAILY_RETENTION_DAYS` are
   deleted. The bucket also has lifecycle rules (45 days on `daily/`, 400 on
   `monthly/`) as a backstop.
5. On `BACKUP_RESTORE_DRILL_DAY` (default `Sun`) `backups/restore-drill.sh`
   restores the newest dump into a throwaway database on the same server,
   compares row counts with the live database, and drops it.

## Alerting

- `BACKUP_HEALTHCHECK_URL`: a healthchecks.io (or compatible) ping URL. The
  cycle pings `/start`, then the bare URL on success or `/fail` with the log
  on failure. Set the check's period to 1 day with a few hours' grace and
  point its notification at Discord. This is the alert that fires when a
  backup silently does not happen, which no in-process alert can do.
- `BACKUP_DISCORD_WEBHOOK_URL`: optional; failures of the cycle or the drill
  post a red embed with the last log lines.
- The container writes `backup_complete` and `backup_restore_drill` JSON log
  lines to stdout; `docker compose logs backup` shows history.

## Credentials

Create an R2 API token in the Cloudflare dashboard (R2 → Manage API tokens →
Create, permission **Object Read & Write**, scoped to the
`swg-bounty-backups` bucket). Put its access key id and secret plus the
account id in `.env.production` as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
and `R2_ACCOUNT_ID`, then `docker compose ... up -d backup`.

## Recovering

Download the newest dump from R2 (dashboard, or with the same credentials):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm db-tools \
  bash -c 'source backups/r2.sh && r2_configure && r2_list backups/daily | tail -n 4'
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm db-tools \
  bash -c 'source backups/r2.sh && r2_configure && rclone copy "$BACKUP_DEST/backups/daily/swg-bounty-<time>.dump" /backups/'
```

Then restore as documented in the README (`RESTORE_CONFIRM=YES npm run restore -- /backups/<file>.dump`)
followed by `npm run ingest:validate`. To rebuild on a new machine, restore
before starting the `worker` service, exactly as in
[production-deployment.md](production-deployment.md) section 4.

## Running by hand

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup npm run backup:cycle
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup npm run backup:drill
```

Set `BACKUP_REMOTE=/some/dir` to point a cycle at a local directory
instead of R2, which is how the scripts are tested.
