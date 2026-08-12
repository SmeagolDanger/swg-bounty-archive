# Outer Rim Ledger

Outer Rim Ledger is a production-oriented, independent historical archive and analytics site for the public Bounty Hunter data exposed by the new SWG Legends website. It retains every source response, turns valid data into immutable observations, blocks logical duplicates in PostgreSQL, detects upstream changes, and presents the resulting history in a responsive tactical interface.

Data originates from [SWG Legends](https://swglegends.com/). This project is not affiliated with or operated by SWG Legends.

## What is implemented

- Live API discovery documented in [docs/swg-legends-api.md](docs/swg-legends-api.md), with captured representative fixtures.
- Raw request/response archive with headers, timings, HTTP status, exact JSONB, SHA-256, schema signature, parser version, processing state, and traceable run ID.
- Current plus two publicly exposed prior weeks for all four Bounty Hunter boards and player/guild/city subjects.
- Rolling public bounty aggregate and every recent encounter observed by the collector.
- Immutable changed-state snapshots, stable participant IDs, deterministic encounter fingerprints, database uniqueness constraints, revisions for fixed historical rows, and schema-change alerts.
- Resumable public-history backfill, conservative polling worker, retry/backoff, timeouts, rate-limit handling, graceful shutdown, heartbeat health check, reconciliation, and diagnostics.
- Dashboard, encounter search/filter/pagination, leaderboards, hunter comparison, rivalry intelligence and timelines, guild competition and current-roster analytics, player/guild/city dossiers, charts, global trigram search, public raw-response search, protected ingestion console, and raw payload viewer.
- Unit tests plus a PostgreSQL integration test that imports the same fixture 100 times concurrently.
- Docker Compose, migration runner, backup/restore/verification scripts, and no proprietary service dependency.

## Architecture

```mermaid
flowchart LR
  SWG[Public SWG Legends JSON] -->|conservative GET polling| W[TypeScript worker]
  W -->|archive first| R[(Raw api_ingestions)]
  R --> V[Zod validation + schema signature]
  V --> N[(Immutable normalized history)]
  N --> Q[Next.js application API]
  Q --> UI[Responsive analytics UI]
  N --> REC[Reconciliation + data quality]
  REC --> ADM[Protected operations console]
```

The worker and web process share only PostgreSQL. No Redis is necessary: database uniqueness constraints provide the concurrency boundary, and the archive workload does not need a separate distributed queue. Poll cycles have run IDs and remain safe if multiple workers overlap.

## Accuracy and deduplication

The raw API value is always retained. Credit boards expose heca-credit `score` plus credit-denominated `scoreRaw`; both are stored separately. Encounter credits are already ordinary credits in the public endpoint.

Logical identities are enforced by PostgreSQL:

- participant: `(participant_type, source_participant_id)`;
- leaderboard period: `(leaderboard_id, starts_at, ends_at)`;
- state observation: `(leaderboard_id, period_id, subject, state_hash)`;
- row: `(snapshot_id, source_participant_id)`; ranks may tie when SWG reports equal scores;
- encounter: SHA-256 of source, event timestamp, outcome, exact hunter name, exact target name, and credits;
- aggregate: deterministic content hash excluding collection/fetch time.

Collection time is never part of source identity or substituted for event time. Unknown source fields remain `NULL`; unknown JSON fields remain in the raw payload. Exact unchanged state is not duplicated in normalized tables, while every network response remains auditable.

## Quick start

```bash
cp .env.example .env
# Make POSTGRES_PASSWORD and DATABASE_URL match, then set ADMIN_PASSWORD_HASH.
npm run admin:hash-password -- 'choose-a-long-password'
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3017> (or `APP_PORT`). The independent worker performs an initial collection and then polls at the configured interval. `/admin/ingestion` uses HTTP Basic authentication and returns 503 until both admin environment variables are set.

All public sources are polled on one synchronized five-minute start-to-start cadence by default. The worker mirrors its active cadence into the source schedule records shown by the operations console.

To see logs:

```bash
docker compose logs -f web worker
```

To stop without deleting permanent database storage:

```bash
docker compose down
```

Do not add `-v` unless you intentionally mean to delete the PostgreSQL volume.

## Local development

Run PostgreSQL, apply migrations, then start the app and worker:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://swg:swg@localhost:54329/swg_bounty npm run db:migrate
DATABASE_URL=postgresql://swg:swg@localhost:54329/swg_bounty npm run dev
DATABASE_URL=postgresql://swg:swg@localhost:54329/swg_bounty npm run worker
```

## Commands

```bash
npm run api:inspect          # Read-only live endpoint/schema report
npm run ingest:once          # Full current collection
npm run ingest:backfill      # Resumable CURRENT/PREVIOUS_1/PREVIOUS_2 backfill
npm run ingest:reconcile     # Refetch and run integrity checks
npm run ingest:validate      # Local archive diagnostics
npm run db:migrate           # Checksum-protected SQL migrations
npm run db:stats             # Normalized/raw table counts
npm test                     # Unit suite
RUN_DB_TESTS=1 npm test      # Includes 100-way database idempotency proof
npm run lint
npm run typecheck
npm run build
```

## Environment variables

See [.env.example](.env.example). Important controls:

- `DATABASE_URL`: PostgreSQL connection string; keep it aligned with the `POSTGRES_*` values in Docker.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`: local database bootstrap settings. PostgreSQL binds to loopback only by default.
- `SWG_BASE_URL`: source origin; defaults to the official site.
- `INGESTION_ENABLED`: worker on/off switch.
- `INGESTION_INTERVAL_SECONDS`: full poll interval, minimum 60 seconds.
- `INGESTION_CONCURRENCY`: bounded request concurrency, capped at four.
- `INGESTION_TIMEOUT_MS` / `INGESTION_MAX_RETRIES`: request resilience.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`: protected operations console.
- `PUBLIC_API_RATE_LIMIT_PER_MINUTE`: per-process public API limit.
- `APP_TIMEZONE`: server-rendered display timezone; storage is UTC `timestamptz`.
- `BACKUP_DIR` / `BACKUP_RETENTION_DAYS`: backup path and optional retention. Zero keeps backups forever.

No real credentials belong in source control.

When pasting a bcrypt hash into `.env`, wrap it in single quotes so its `$` characters remain literal, for example `ADMIN_PASSWORD_HASH='$2b$12$…'`.

## Backfill limitations

SWG Legends publicly exposes only `CURRENT`, `PREVIOUS_1`, and `PREVIOUS_2` board periods. The encounter feed exposes a rolling 14-day aggregate but only 12 recent event rows and no pagination. The software backfills everything the public API actually permits and explicitly does not manufacture inaccessible history. Continuous collection grows the permanent event archive from deployment onward.

## Backup and restore

Create a custom-format dump and SHA-256 sidecar:

```bash
DATABASE_URL=... BACKUP_DIR=/srv/swg-backups npm run backup
npm run backup:verify -- /srv/swg-backups/swg-bounty-YYYYMMDDTHHMMSSZ.dump
```

Backups are never deleted by default. Set a positive `BACKUP_RETENTION_DAYS` only when intentional. Restore to a verified target:

```bash
DATABASE_URL=... RESTORE_CONFIRM=YES npm run restore -- /absolute/path/to/backup.dump
npm run ingest:validate
```

Schedule `npm run backup` daily with the host's systemd timer or cron, copy dumps to independent storage, and regularly test restoration into a separate PostgreSQL database.

For the pull-only GHCR production stack and a lossless development-to-VPS transfer procedure, follow [docs/production-deployment.md](docs/production-deployment.md). It includes a pre/post migration manifest whose counts and content digests must match before the production worker starts.

## Upgrade process

1. Take and verify a backup.
2. Pull the new code and review migration SQL/checksums.
3. Run `docker compose build` and `docker compose run --rm migrate`.
4. Run tests and `npm run ingest:validate` against a staging restore.
5. Restart `web` and `worker`; verify `/api/health` and `/admin/ingestion`.

Applied migrations are checksum-protected. Editing an already-applied migration is rejected; add a new ordered SQL file instead.

## Troubleshooting

- Admin returns 503: configure `ADMIN_USERNAME` and a bcrypt `ADMIN_PASSWORD_HASH`.
- Dashboard is empty: inspect worker logs, run `npm run ingest:once`, then check the protected operations console.
- Schema-change warning: compare the linked raw payload with the prior signature and update the Zod parser without deleting raw history.
- Partial run: transient endpoint failures are isolated and retained; the next idempotent cycle retries safely.
- Encounter gaps after downtime: the upstream public response has only 12 recent rows, so older missed events cannot be recovered from the discovered API.
- Migration checksum error: restore the original migration file and express the change as a new migration.

## Security notes

All application queries are parameterized. Public query values are bounded and allow-listed, public JSON APIs are rate-limited, the admin tree is protected before rendering, stack traces are not returned, and secrets come only from environment configuration. The collector uses public GET requests, an identifying user agent, low concurrency, cache-aware intervals, and no authentication bypass.
