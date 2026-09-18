#!/usr/bin/env bash
# Proves the newest local dump actually restores: loads it into a throwaway
# database on the same server, compares key row counts with the live
# database, then drops it. `npm run backup:drill`. Exit non-zero on any
# problem so the scheduler can report it.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi
archive_dir="${BACKUP_DIR:-./backups/data}"
dump_path="${1:-$(ls -1t "$archive_dir"/swg-bounty-*.dump 2>/dev/null | head -n 1)}"
[[ -f "$dump_path" ]] || { echo "No dump found in $archive_dir" >&2; exit 1; }

drill_db="${BACKUP_DRILL_DATABASE:-swg_bounty_restore_drill}"
base="${DATABASE_URL%%\?*}"
query="${DATABASE_URL#"$base"}"
drill_url="${base%/*}/${drill_db}${query}"

cleanup() { psql -q -X "$DATABASE_URL" -c "DROP DATABASE IF EXISTS \"$drill_db\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

bash "$(dirname "$0")/verify.sh" "$dump_path" >/dev/null
cleanup
psql -q -X "$DATABASE_URL" -c "CREATE DATABASE \"$drill_db\"" >/dev/null
# Extensions (pgcrypto, pg_trgm) are created by the dump itself.
pg_restore --no-owner --no-acl --exit-on-error --dbname="$drill_url" "$dump_path"

status=0
for table in bounty_encounters api_ingestions leaderboard_entries participants schema_versions; do
  live="$(psql -qtAX "$DATABASE_URL" -c "SELECT count(*) FROM $table")"
  restored="$(psql -qtAX "$drill_url" -c "SELECT count(*) FROM $table")"
  if [[ "$restored" -lt 1 && "$live" -gt 0 ]] || [[ "$restored" -gt "$live" ]]; then
    echo "Row count mismatch for $table: live $live, restored $restored" >&2
    status=1
  else
    echo "$table: live $live, restored $restored"
  fi
done
[[ "$status" -eq 0 ]] || exit "$status"
echo "Restore drill passed: $(basename "$dump_path") restores cleanly into $drill_db"
