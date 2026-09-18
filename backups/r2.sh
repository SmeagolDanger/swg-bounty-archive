#!/usr/bin/env bash
# Shared helpers for shipping backups to Cloudflare R2 with rclone.
# Sourced by backup-cycle.sh; not meant to be run directly.
#
# Configuration (all via environment):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  R2 S3 API credentials
#   R2_BACKUP_BUCKET        bucket name (default swg-bounty-backups)
#   BACKUP_REMOTE           override the rclone destination with a plain directory, e.g. /tmp/r2 (tests)

r2_configured() {
  [[ -n "${BACKUP_REMOTE:-}" ]] && return 0
  [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" ]]
}

# rclone reads a remote called "r2" from these variables; no config file needed.
r2_configure() {
  if [[ -n "${BACKUP_REMOTE:-}" ]]; then
    BACKUP_DEST="${BACKUP_REMOTE%/}"
    return 0
  fi
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_ACL=private
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  BACKUP_DEST="r2:${R2_BACKUP_BUCKET:-swg-bounty-backups}"
}

# r2_upload <local file> <remote prefix>  — copies and confirms size on the remote.
r2_upload() {
  local file="$1" prefix="$2" name
  name="$(basename "$file")"
  rclone copyto --s3-no-check-bucket --retries 5 --low-level-retries 10 --stats-one-line -q "$file" "$BACKUP_DEST/$prefix/$name"
  local remote_size local_size
  remote_size="$(rclone size --json "$BACKUP_DEST/$prefix/$name" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
  local_size="$(wc -c <"$file" | tr -d ' ')"
  if [[ "$remote_size" != "$local_size" ]]; then
    echo "Upload size mismatch for $name: local $local_size, remote $remote_size" >&2
    return 1
  fi
  echo "Uploaded $prefix/$name ($local_size bytes)"
}

# r2_prune <remote prefix> <days> — removes objects older than <days> under the prefix.
r2_prune() {
  local prefix="$1" days="$2"
  [[ "$days" =~ ^[1-9][0-9]*$ ]] || return 0
  rclone delete --min-age "${days}d" -q "$BACKUP_DEST/$prefix" 2>/dev/null || true
  echo "Pruned $prefix objects older than ${days} days"
}

r2_list() {
  rclone lsl "$BACKUP_DEST/${1:-}"
}
