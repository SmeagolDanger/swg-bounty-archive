#!/usr/bin/env bash
# Extract the local archive into a self-contained SQL file that loads
# everything into a `staging_import` schema on the target database.
# Read-only against the source; taken in one REPEATABLE READ snapshot so a
# concurrently-running collector can't tear the export.
#
# Usage:
#   scripts/prod-sync/01_extract_local.sh [output.sql]
#   SOURCE_DSN=postgresql://... scripts/prod-sync/01_extract_local.sh
#
# Apply on prod afterwards:
#   psql "$PROD_DSN" -v ON_ERROR_STOP=1 -f <output.sql>
#   psql "$PROD_DSN" -v ON_ERROR_STOP=1 -f scripts/prod-sync/02_merge_into_prod.sql

set -euo pipefail

SOURCE_DSN="${SOURCE_DSN:-postgresql://swg:swg@127.0.0.1:54329/swg_bounty}"
OUT="${1:-backups/bounty_archive_extract_$(date -u +%Y%m%dT%H%M%SZ).sql}"

# Host psql if available; otherwise stream through the compose container:
#   PSQL="docker exec -i swg-bounty-archive-postgres-1 psql -U swg -d swg_bounty" \
#     scripts/prod-sync/01_extract_local.sh
if [ -z "${PSQL:-}" ]; then
  if command -v psql >/dev/null 2>&1; then
    PSQL="psql $SOURCE_DSN"
  else
    PSQL="docker exec -i swg-bounty-archive-postgres-1 psql -U swg -d swg_bounty"
  fi
fi

# Dependency order matters only for readability; the merge script controls
# actual insert order. api_sources is exported solely to build the
# source_key -> prod id remap (prod already has its own rows).
TABLES=(
  api_sources
  ingestion_runs
  api_ingestions
  schema_signatures
  leaderboards
  leaderboard_periods
  participants
  leaderboard_snapshots
  leaderboard_entries
  leaderboard_wins
  bounty_encounters
  bounty_aggregate_snapshots
  data_revisions
)

mkdir -p "$(dirname "$OUT")"

# Build one psql script that runs the whole export in a single snapshot.
PSQL_SCRIPT="$(mktemp)"
trap 'rm -f "$PSQL_SCRIPT"' EXIT

{
  echo "\\set QUIET on"
  echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
  for t in "${TABLES[@]}"; do
    echo "\\echo '__TABLE__ ${t}'"
    # Explicit column list captured from the SOURCE, so the file is immune
    # to column-order drift between environments.
    echo "\\echo '__COLUMNS__'"
    echo "SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}';"
    echo "\\echo '__DATA__'"
    echo "\\copy (SELECT * FROM public.${t}) TO STDOUT"
    echo "\\echo '__END__'"
  done
  echo "COMMIT;"
} > "$PSQL_SCRIPT"

RAW="$(mktemp)"
trap 'rm -f "$PSQL_SCRIPT" "$RAW"' EXIT
$PSQL -v ON_ERROR_STOP=1 -tA -f - < "$PSQL_SCRIPT" > "$RAW"

# Assemble the final artifact.
{
  echo "-- Outer Rim Ledger archive extract"
  echo "-- Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) from the local archive database"
  echo "-- Loads a full copy of the local archive into schema staging_import."
  echo "-- Apply 02_merge_into_prod.sql afterwards; nothing here touches public.*"
  echo "\\set ON_ERROR_STOP on"
  echo "BEGIN;"
  echo "DROP SCHEMA IF EXISTS staging_import CASCADE;"
  echo "CREATE SCHEMA staging_import;"

  python3 - "$RAW" <<'PYEOF'
import sys

state = "idle"
table = None
columns = None
with open(sys.argv[1], "r") as f:
    for line in f:
        line = line.rstrip("\n")
        if line.startswith("__TABLE__ "):
            table = line.split(" ", 1)[1]
            state = "table"
        elif line == "__COLUMNS__":
            state = "columns"
        elif line == "__DATA__":
            print(f"CREATE TABLE staging_import.{table} (LIKE public.{table});")
            print(f"COPY staging_import.{table} ({columns}) FROM stdin;")
            state = "data"
        elif line == "__END__" and state == "data":
            print("\\.")
            print()
            state = "idle"
        elif state == "columns" and line.strip():
            columns = line.strip()
        elif state == "data":
            print(line)
PYEOF

  echo "COMMIT;"
  echo "-- Row counts at extract time, for verification:"
  for t in "${TABLES[@]}"; do
    n=$($PSQL -tAc "SELECT count(*) FROM public.${t}")
    echo "-- ${t}: ${n}"
  done
} > "$OUT"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"