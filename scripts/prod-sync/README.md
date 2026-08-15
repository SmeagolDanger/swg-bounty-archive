# Prod sync: merge the local archive into production

Recovers early history that only exists in the local database (local
collection started 2026-08-12 01:35 UTC; prod's history starts 04:46 UTC)
by merging the *entire* local archive into prod with logical-identity
dedup — overlap is skipped, so no window filtering is needed and the
whole procedure is idempotent.

## Files

- `01_extract_local.sh` — exports every archive table from the local DB
  (one `REPEATABLE READ` snapshot; safe while the worker runs) into a
  self-contained SQL file that loads a `staging_import` schema. Touches
  nothing outside that schema.
- `02_merge_into_prod.sql` — single-transaction merge from
  `staging_import` into `public`. Dedup keys per table are documented in
  the header. Cross-database UUIDs are remapped by natural key
  (participants, periods, snapshots, sources), and earliest-seen
  timestamps are merged with `LEAST` so recovered early history is
  reflected on rows prod already has. Prints inserted/merged counts.
- `03_verify.sql` — proves nothing was lost (every staged logical row is
  represented in `public`) and nothing was duplicated (unique-key audits).
  All `missing_*` and `dup_*` counts must be 0.

## Procedure (VPS deployment)

Prod PostgreSQL is not port-published; everything runs through
`docker compose exec postgres` on the VPS. This is a *merge*, not the
cutover restore from docs/production-deployment.md — that procedure
replaces the database and would destroy prod's post-cutover history.

```bash
# ── On this machine (dev checkout) ───────────────────────────────────
# 1. Regenerate a fresh extract right before applying, so it carries
#    everything collected up to now (the merge stays idempotent):
scripts/prod-sync/01_extract_local.sh
# → backups/bounty_archive_extract_<timestamp>.sql (~60 MB)

# 2. Copy the extract + merge + verify scripts to the VPS:
scp backups/bounty_archive_extract_<timestamp>.sql \
    scripts/prod-sync/02_merge_into_prod.sql \
    scripts/prod-sync/03_verify.sql \
    USER@VPS:/PATH/swg-bounty-archive/backups/

# ── On the VPS ───────────────────────────────────────────────────────
cd /PATH/swg-bounty-archive
compose="docker compose --env-file .env.production -f docker-compose.prod.yml"

# 3. Safety backup with the built-in tooling (checksummed dump → ./backups):
$compose run --rm db-tools

# 4. Confirm BOTH databases are on the same migration level (0008+ required
#    since payload dedup; the merge assumes identical schemas):
$compose exec -T postgres psql -U swg -d swg_bounty \
  -c "SELECT version FROM schema_versions ORDER BY version"

# 5. Pause the collector for the couple of minutes the merge takes
#    (the site stays up; this just avoids writer interleaving):
$compose stop worker

# 6. Load staging, merge, verify. Each file is one transaction —
#    any error rolls back completely and prod is untouched:
$compose exec -T postgres psql -U swg -d swg_bounty -v ON_ERROR_STOP=1 -f - \
  < backups/bounty_archive_extract_<timestamp>.sql
$compose exec -T postgres psql -U swg -d swg_bounty -v ON_ERROR_STOP=1 -f - \
  < backups/02_merge_into_prod.sql
$compose exec -T postgres psql -U swg -d swg_bounty -v ON_ERROR_STOP=1 -f - \
  < backups/03_verify.sql
# → every missing_* and dup_* count must print 0

# 7. Resume collection and clean up staging:
$compose up -d worker
$compose exec -T postgres psql -U swg -d swg_bounty \
  -c "DROP SCHEMA staging_import CASCADE"

# 8. Confirm from the outside:
curl -s https://jawatracks.com/api/dashboard | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['stats']['history_start'])"
# → 2026-08-12T01:35:08.241Z (was 04:46:07)
```

If `POSTGRES_USER`/`POSTGRES_DB` are overridden in `.env.production`,
substitute those values in the `psql -U ... -d ...` flags.

**Rollback:** the merge is a single transaction, so a failure needs no
rollback — it never applied. If verification surprises you *after*
commit, restore the step-3 dump with the documented
`RESTORE_CONFIRM=YES db-tools npm run restore` procedure.

Expected outcome on prod: `earliest_raw_observation` moves back to
2026-08-12 01:35 UTC and `earliest_encounter` to 2026-08-12 00:01 UTC;
overlapping rows keep prod's UUIDs with `first_seen_at` /
`first_observed_at` corrected to the earlier local observation.

## Dedup guarantees (validated before delivery)

Tested against scratch databases built from the real migrations:

1. **Empty target** — merge inserts the full archive; counts match source.
2. **Idempotency** — immediately re-running extract-load + merge inserts
   **zero** rows in every table.
3. **Cross-UUID overlap** (the prod situation) — a target pre-seeded with
   the same players/periods/encounters under *different* UUIDs ends up
   with exactly one row per logical identity: children are remapped onto
   the target's existing UUIDs (330 entries re-pointed in the test),
   `first_seen_at`/`first_observed_at` are recovered to the earlier local
   values, and all duplicate audits return 0.

## Intentionally not merged

Operational state stays environment-local: `worker_heartbeats`,
`backfill_checkpoints`, `data_quality_events`, `ingestion_errors`.
Raw responses are considered duplicates only when endpoint,
`requested_at`, and `payload_hash` all match — two collectors polling at
different instants are distinct observations and are both preserved, in
keeping with the archive-first design.