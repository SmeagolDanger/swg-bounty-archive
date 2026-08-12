#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

archive_dir="${BACKUP_DIR:-./backups/data}"
mkdir -p "$archive_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$archive_dir/swg-bounty-$timestamp.dump"
pg_dump --format=custom --no-owner --no-acl --file="$target" "$DATABASE_URL"
target_name="$(basename "$target")"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$archive_dir" && sha256sum "$target_name" > "$target_name.sha256")
else
  (cd "$archive_dir" && shasum -a 256 "$target_name" > "$target_name.sha256")
fi
echo "Created $target"

retention_days="${BACKUP_RETENTION_DAYS:-0}"
if [[ "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  find "$archive_dir" -type f \( -name 'swg-bounty-*.dump' -o -name 'swg-bounty-*.dump.sha256' \) -mtime "+$retention_days" -delete
  echo "Applied configured ${retention_days}-day retention"
fi
