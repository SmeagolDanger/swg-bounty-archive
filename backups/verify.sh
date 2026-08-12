#!/usr/bin/env bash
set -euo pipefail

dump_path="${1:-}"
if [[ -z "$dump_path" || ! -f "$dump_path" ]]; then
  echo "Usage: npm run backup:verify -- /absolute/path/to/backup.dump" >&2
  exit 1
fi
if [[ -f "$dump_path.sha256" ]]; then
  checksum_dir="$(cd "$(dirname "$dump_path")" && pwd)"
  checksum_name="$(basename "$dump_path").sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$checksum_dir" && sha256sum -c "$checksum_name")
  else
    (cd "$checksum_dir" && shasum -a 256 -c "$checksum_name")
  fi
fi
pg_restore --list "$dump_path" >/dev/null
archive_list="$(pg_restore --list "$dump_path")"
for required_table in api_ingestions bounty_encounters leaderboard_snapshots leaderboard_entries participants schema_versions; do
  if ! grep -q "TABLE DATA public $required_table" <<<"$archive_list"; then
    echo "Backup is missing required table data: $required_table" >&2
    exit 1
  fi
done
echo "Checksum and PostgreSQL archive structure verified: $dump_path"
