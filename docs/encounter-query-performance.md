# Encounter query performance

Migration `0016_encounter_query_indexes.sql` adds:

- `bounty_encounters_hunter_time_idx`: exact lowercased hunter + date range; also supports hunter-stat aggregation.
- `bounty_encounters_target_time_idx`: lowercased target + date range; supports target-role stats and dossiers.
- `participants_player_name_latest_idx`: indexed player identity lookup, newest observation first.
- `bounty_encounters_time_id_idx`: stable newest-first ordering, including equal timestamps.

Existing trigram indexes remain useful for substring search; they do not replace these B-tree indexes on `lower(...)`. Existing indexes are retained until production plans confirm they can be removed safely.

Feed queries select the requested page before lateral player lookups. `hunter=Name` provides case-insensitive exact hunter matching. `includeStats=false` returns `hunter_stats: null` and skips all-time statistics aggregation; existing callers keep the default enriched response. Credit Watch uses both options while retaining `q` for compatibility with older servers.

## Applying to a live archive

Prebuild with `psql -v ON_ERROR_STOP=1 -f docs/encounter-indexes-online.sql` against the intended database, outside a transaction. This uses `CREATE INDEX CONCURRENTLY` so ingestion can continue. Run the normal migration runner afterward to record the migration. The transactional migration is suitable for fresh databases; its 3-second lock timeout fails promptly if it cannot acquire the necessary lock.

Before retrying an interrupted concurrent build, check for invalid indexes:

```sql
SELECT c.relname, i.indisvalid, i.indisready
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
WHERE c.relname IN ('bounty_encounters_hunter_time_idx',
 'bounty_encounters_target_time_idx', 'participants_player_name_latest_idx',
 'bounty_encounters_time_id_idx');
```

An invalid index with the desired name must be dropped with `DROP INDEX CONCURRENTLY` and rebuilt before the migration runs; `IF NOT EXISTS` alone does not repair it.

## Measuring

On representative data, compare `EXPLAIN (ANALYZE, BUFFERS)` before and after indexing for an active hunter and the unfiltered feed. Replace the example name and dates with real values:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id,event_at,hunter_name,target_name,credits
FROM bounty_encounters
WHERE lower(hunter_name)=lower('ExampleHunter')
  AND event_at >= '2026-08-08T00:00:00Z'
  AND event_at < '2026-09-13T00:00:00Z'
ORDER BY event_at DESC,id DESC LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM participants
WHERE participant_type='player' AND lower(current_name)=lower('ExampleHunter')
ORDER BY last_seen_at DESC LIMIT 1;
```

Check elapsed time, buffer reads, row estimates, and index validity. An index scan is not automatically faster on tiny tables or low-selectivity queries. No production timing improvement has been measured locally: the local PostgreSQL/Docker service was unavailable during implementation.

Exact totals still require counting matching rows; very deep page-number queries still pay OFFSET costs. If those dominate after indexing, add cursor pagination and optional totals, followed by server-side report aggregates. These changes preserve the current pagination contract.
