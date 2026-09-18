#!/usr/bin/env bash
# One complete backup cycle: dump → verify → upload to R2 → prune → report.
# Exit status is non-zero if any step fails. Runs daily from scheduler.sh and
# can be invoked by hand: `npm run backup:cycle`.
#
# Environment (beyond r2.sh and backup.sh):
#   BACKUP_LOCAL_RETENTION_DAYS   local copies to keep (default 7; 0 keeps all)
#   BACKUP_R2_DAILY_RETENTION_DAYS remote daily copies to keep (default 30)
#   BACKUP_HEALTHCHECK_URL        healthchecks.io-style ping URL (optional)
#   BACKUP_DISCORD_WEBHOOK_URL    Discord webhook for failure messages (optional)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backups/r2.sh
source "$here/r2.sh"

archive_dir="${BACKUP_DIR:-./backups/data}"
log_file="$(mktemp)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$log_file"; }
ping_health() {
  [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]] || return 0
  local suffix="${1:-}"
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL%/}${suffix}" --data-binary "@${2:-/dev/null}" || true
}
notify_failure() {
  [[ -n "${BACKUP_DISCORD_WEBHOOK_URL:-}" ]] || return 0
  local tail_text
  tail_text="$(tail -n 12 "$log_file" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')"
  curl -fsS -m 10 -o /dev/null -H 'Content-Type: application/json' "$BACKUP_DISCORD_WEBHOOK_URL" \
    --data "{\"allowed_mentions\":{\"parse\":[]},\"embeds\":[{\"color\":15548997,\"title\":\"Database backup failed\",\"description\":\"Step: $1\\n\`\`\`\\n${tail_text}\\n\`\`\`\"}]}" || true
}
fail() {
  log "FAILED at step: $1"
  tail -n 20 "$log_file" | sed 's/^/  | /'
  ping_health "/fail" "$log_file"
  notify_failure "$1"
  rm -f "$log_file"
  exit 1
}

ping_health "/start"
r2_configured || fail "configuration (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required)"
r2_configure

log "Backup cycle started; destination $BACKUP_DEST"
export BACKUP_RETENTION_DAYS="${BACKUP_LOCAL_RETENTION_DAYS:-7}"
dump_output="$(bash "$here/backup.sh" 2>&1)" || { log "$dump_output"; fail "pg_dump"; }
log "$dump_output"
dump_path="$(sed -nE 's/^Created (.*\.dump)$/\1/p' <<<"$dump_output" | tail -n 1)"
[[ -f "$dump_path" ]] || fail "locating dump"

bash "$here/verify.sh" "$dump_path" >>"$log_file" 2>&1 || fail "verify"
log "Verified $(basename "$dump_path")"

r2_upload "$dump_path" "backups/daily" >>"$log_file" 2>&1 || fail "upload dump"
r2_upload "$dump_path.sha256" "backups/daily" >>"$log_file" 2>&1 || fail "upload checksum"
log "Uploaded to $BACKUP_DEST/backups/daily"

# First of the month: keep a long-lived copy (the bucket lifecycle expires monthly/ after ~400 days).
if [[ "$(date -u +%d)" == "01" ]]; then
  r2_upload "$dump_path" "backups/monthly" >>"$log_file" 2>&1 || fail "upload monthly"
  r2_upload "$dump_path.sha256" "backups/monthly" >>"$log_file" 2>&1 || fail "upload monthly checksum"
  log "Kept monthly copy"
fi

r2_prune "backups/daily" "${BACKUP_R2_DAILY_RETENTION_DAYS:-30}" >>"$log_file" 2>&1 || true

size_bytes="$(wc -c <"$dump_path" | tr -d ' ')"
log "Backup cycle succeeded: $(basename "$dump_path") ($size_bytes bytes)"
printf '{"timestamp":"%s","level":"info","event":"backup_complete","status":"success","started_at":"%s","dump":"%s","bytes":%s,"destination":"%s","service":"outer-rim-ledger"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$started_at" "$(basename "$dump_path")" "$size_bytes" "$BACKUP_DEST"
ping_health "" "$log_file"
rm -f "$log_file"
