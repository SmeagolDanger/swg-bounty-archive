# Production deployment and lossless data migration

The production stack pulls the published multi-architecture image from GitHub Container Registry. It does not build source code on the VPS. PostgreSQL data lives in a named Docker volume, while portable backups live in a host directory.

## 1. Prepare the VPS

Install Docker Engine with the Docker Compose v2 plugin, then clone the public repository:

```bash
git clone https://github.com/SmeagolDanger/swg-bounty-archive.git
cd swg-bounty-archive
cp .env.production.example .env.production
chmod 600 .env.production
mkdir -p backups
```

Edit `.env.production`. Set a long URL-safe `POSTGRES_PASSWORD`, put the same value in `DATABASE_URL`, and configure the timezone and admin credentials. Generate the bcrypt admin hash with the published image after pulling it:

```bash
docker pull ghcr.io/smeagoldanger/swg-bounty-archive:latest
docker run --rm ghcr.io/smeagoldanger/swg-bounty-archive:latest npm run --silent admin:hash-password -- --env 'your-long-admin-password'
```

Paste the complete printed `ADMIN_PASSWORD_HASH='…'` line into `.env.production`. Keep the single quotes so Docker Compose passes bcrypt's `$` characters literally.

The default bind address is `127.0.0.1:3017`; place Caddy, nginx, or another TLS reverse proxy in front of it. Set `APP_BIND_ADDRESS=0.0.0.0` only when direct network exposure is intentional.

## 2. First start without existing data

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:3017/api/health
```

The one-shot `migrate` service must finish successfully before `web` or `worker` starts. The collector runs on a five-minute start-to-start cadence.

## 3. Preserve and transfer the development archive

For a zero-gap handoff, leave the development database and web container running but stop its collector. Do not restart that collector after taking the final manifest; the production collector becomes the sole writer after restoration.

From the development checkout:

```bash
docker compose stop worker
mkdir -p backups/data
docker compose run -T --rm db-tools ./node_modules/.bin/tsx scripts/migration-manifest.ts > backups/data/dev-manifest.json
docker compose run --rm db-tools
```

Find the newly created dump and verify it before transfer:

```bash
dump_file="$(ls -1t backups/data/swg-bounty-*.dump | head -1)"
docker compose run --rm db-tools npm run backup:verify -- "/backups/$(basename "$dump_file")"
```

Copy the dump, its portable checksum sidecar, and the manifest to the VPS:

```bash
scp "$dump_file" "$dump_file.sha256" backups/data/dev-manifest.json USER@VPS:/PATH/swg-bounty-archive/backups/
```

The custom PostgreSQL archive includes the lossless `api_ingestions` payloads, normalized history, revisions, participants, encounters, migrations, and all identifiers. The manifest adds exact row counts and SHA-256 digests for the critical datasets.

## 4. Restore on production without starting the collector

On the VPS, start PostgreSQL alone. Do not run the full stack yet:

```bash
cd /PATH/swg-bounty-archive
compose="docker compose --env-file .env.production -f docker-compose.prod.yml"
$compose pull
$compose up -d postgres
```

Verify and restore the transferred dump. `restore` refuses to run without the explicit confirmation variable and verifies the checksum and required archive tables before modifying the target database:

```bash
dump_file="$(ls -1t backups/swg-bounty-*.dump | head -1)"
$compose run --rm db-tools npm run backup:verify -- "/backups/$(basename "$dump_file")"
$compose run --rm -e RESTORE_CONFIRM=YES db-tools npm run restore -- "/backups/$(basename "$dump_file")"
$compose run --rm migrate
```

Generate the production manifest before the worker starts and compare it byte-for-byte with development:

```bash
$compose run -T --rm db-tools ./node_modules/.bin/tsx scripts/migration-manifest.ts > backups/prod-manifest.json
diff -u backups/dev-manifest.json backups/prod-manifest.json
```

No `diff` output means the critical row counts and content digests are identical. Also run the integrity validator:

```bash
$compose run --rm db-tools npm run ingest:validate
```

Only after all checks pass, start the application and its new collector:

```bash
$compose up -d web worker
$compose ps
curl -fsS http://127.0.0.1:3017/api/health
```

The development worker should remain stopped. This prevents two independent collectors from writing divergent post-cutover archives.

## 5. Routine production updates

The image workflow publishes `latest` from `main`, immutable `sha-<commit>` tags, and semantic-version tags. To update using the configured tag:

```bash
cd /PATH/swg-bounty-archive
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

For deterministic rollouts, set `APP_IMAGE` to a `sha-<full-commit>` tag or image digest before `pull` and `up`.

## 6. Ongoing backups and recovery rules

Create a production backup at any time:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm db-tools
```

Copy both `.dump` and `.dump.sha256` files to independent storage. Schedule this command daily and periodically restore into a disposable database to prove recovery.

`docker compose down` preserves the named PostgreSQL volume. **Never run `docker compose down -v`** unless permanent deletion of the production database is explicitly intended. Never rely on the named volume as the only backup.
