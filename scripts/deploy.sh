#!/usr/bin/env bash
# Deploy the latest published image with a quiet-window guard: pull first,
# then wait for any in-flight collection cycle to finish before recreating
# containers, so a run is never cut off mid-flight.
#
# Usage (on the prod host, from the repo root):
#   scripts/deploy.sh
#
# Environment overrides:
#   COMPOSE_FILE=docker-compose.prod.yml  ENV_FILE=.env.production
#   WAIT_TIMEOUT_S=180   max seconds to wait for an active cycle
#   STALE_RUN_MIN=10     RUNNING rows older than this are crash leftovers,
#                        not live cycles, and are not waited on

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
WAIT_TIMEOUT_S="${WAIT_TIMEOUT_S:-180}"
STALE_RUN_MIN="${STALE_RUN_MIN:-10}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file="$ENV_FILE" "$@"; }

pg_user="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- || true)"
pg_db="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- || true)"
pg_user="${pg_user:-swg}"
pg_db="${pg_db:-swg_bounty}"

active_runs() {
  compose exec -T postgres psql -U "$pg_user" -d "$pg_db" -tA -c \
    "SELECT count(*) FROM ingestion_runs
     WHERE status='RUNNING' AND started_at > now() - interval '${STALE_RUN_MIN} minutes'" \
    | tr -d '[:space:]'
}

echo "==> Pulling latest images (containers keep running)"
compose pull

echo "==> Waiting for the collector to be between cycles"
deadline=$((SECONDS + WAIT_TIMEOUT_S))
while true; do
  count="$(active_runs)"
  if [ "$count" = "0" ]; then
    echo "    no cycle in progress"
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "    still RUNNING after ${WAIT_TIMEOUT_S}s — likely a stale row or a stuck run." >&2
    echo "    Inspect: compose exec postgres psql -c \"SELECT id,run_type,started_at FROM ingestion_runs WHERE status='RUNNING'\"" >&2
    exit 1
  fi
  echo "    cycle in progress (${count} active), rechecking in 3s"
  sleep 3
done

echo "==> Recreating containers"
compose up -d

echo "==> Health"
sleep 3
compose ps
curl -fsS http://127.0.0.1:3017/api/health || echo "(health endpoint not reachable yet — recheck in a few seconds)"
echo
echo "Done."
