#!/usr/bin/env bash
set -euo pipefail

dump_path="${1:-}"
if [[ -z "${DATABASE_URL:-}" || -z "$dump_path" ]]; then
  echo "Usage: DATABASE_URL=... RESTORE_CONFIRM=YES npm run restore -- /absolute/path/to/backup.dump" >&2
  exit 1
fi
if [[ ! -f "$dump_path" ]]; then
  echo "Backup does not exist: $dump_path" >&2
  exit 1
fi
if [[ "${RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "Restore replaces database objects. Set RESTORE_CONFIRM=YES after checking the target URL." >&2
  exit 1
fi

bash "$(dirname "$0")/verify.sh" "$dump_path"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DATABASE_URL" "$dump_path"
echo "Restored $dump_path"
