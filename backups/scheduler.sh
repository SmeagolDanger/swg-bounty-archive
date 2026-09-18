#!/usr/bin/env bash
# Long-running backup scheduler for the `backup` compose service. Once a day at
# BACKUP_AT (UTC, HH:MM, default 03:15) it runs backup-cycle.sh; on
# BACKUP_RESTORE_DRILL_DAY (default Sun; "off" disables) it also runs
# restore-drill.sh afterwards. Failures are reported by backup-cycle.sh
# (healthcheck ping + optional Discord webhook) and never stop the loop.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
at="${BACKUP_AT:-03:15}"
drill_day="${BACKUP_RESTORE_DRILL_DAY:-Sun}"
[[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "BACKUP_AT must be HH:MM (UTC)" >&2; exit 1; }
stopping=0
trap 'stopping=1' TERM INT

seconds_until_next() {
  local now target
  now="$(date -u +%s)"
  target="$(date -u -d "$(date -u +%Y-%m-%d) $at:00" +%s)"
  (( target <= now )) && target=$(( target + 86400 ))
  echo $(( target - now ))
}

echo "Backup scheduler started: daily at $at UTC, restore drill on $drill_day"
if [[ "${BACKUP_RUN_ON_START:-false}" == "true" ]]; then
  bash "$here/backup-cycle.sh" || true
fi
while (( ! stopping )); do
  remaining="$(seconds_until_next)"
  while (( remaining > 0 && ! stopping )); do
    date -u +%Y-%m-%dT%H:%M:%SZ > /tmp/backup-scheduler-alive
    sleep $(( remaining > 60 ? 60 : remaining ))
    remaining="$(seconds_until_next)"
    # Crossed the target: seconds_until_next jumps to ~86400.
    (( remaining > 86400 - 120 )) && break
  done
  (( stopping )) && break
  bash "$here/backup-cycle.sh" || true
  if [[ "$drill_day" != "off" && "$(date -u +%a)" == "$drill_day" ]]; then
    if drill_output="$(bash "$here/restore-drill.sh" 2>&1)"; then
      echo "$drill_output"
      printf '{"timestamp":"%s","level":"info","event":"backup_restore_drill","status":"success","service":"outer-rim-ledger"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      echo "$drill_output" >&2
      printf '{"timestamp":"%s","level":"error","event":"backup_restore_drill","status":"failed","service":"outer-rim-ledger"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
      if [[ -n "${BACKUP_DISCORD_WEBHOOK_URL:-}" ]]; then
        tail_text="$(tail -n 8 <<<"$drill_output" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')"
        curl -fsS -m 10 -o /dev/null -H 'Content-Type: application/json' "$BACKUP_DISCORD_WEBHOOK_URL" \
          --data "{\"allowed_mentions\":{\"parse\":[]},\"embeds\":[{\"color\":15548997,\"title\":\"Backup restore drill failed\",\"description\":\"\`\`\`\\n${tail_text}\\n\`\`\`\"}]}" || true
      fi
    fi
  fi
  sleep 120
done
echo "Backup scheduler stopped"
