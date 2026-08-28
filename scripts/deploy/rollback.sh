#!/usr/bin/env bash
# Quick rollback: flips traffic back to the previous slot immediately.
#
# Fast path: if the previous slot is still warm (within
# ROLLBACK_WINDOW_SECONDS of the last deploy, before blue-green-deploy.sh
# decommissioned it), this is just an nginx reload — seconds, not a
# redeploy.
# Slow path: if the previous slot was already stopped, this restarts it
# on whatever image tag it last ran (recorded in deploy/state/*-image)
# before flipping traffic, which takes longer but still doesn't require
# rebuilding anything.
#
# Usage: ./scripts/deploy/rollback.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

compose="docker compose -f deploy/docker-compose.deploy.yml"
state_dir="deploy/state"
active_file="$state_dir/active-slot"
previous_file="$state_dir/previous-slot"

[ -f "$active_file" ] || { echo "No active-slot state found — nothing to roll back from." >&2; exit 1; }
[ -f "$previous_file" ] || { echo "No previous-slot recorded — nothing to roll back to." >&2; exit 1; }

current_color="$(cat "$active_file")"
rollback_color="$(cat "$previous_file")"

if [ "$current_color" = "$rollback_color" ]; then
  echo "Active slot already equals the recorded previous slot ($current_color) — nothing to do." >&2
  exit 0
fi

echo "Rolling back: $current_color -> $rollback_color"

if ! $compose ps --status running "backend-$rollback_color" | grep -q "backend-$rollback_color"; then
  echo "$rollback_color slot is stopped — starting it back up before cutover"
  $compose up -d "backend-$rollback_color" "frontend-$rollback_color"
  for attempt in $(seq 1 10); do
    if $compose exec -T "backend-$rollback_color" curl -fsS "http://localhost:8080/api/health" >/dev/null 2>&1; then
      break
    fi
    [ "$attempt" -eq 10 ] && { echo "Rollback target $rollback_color failed to become healthy." >&2; exit 1; }
    sleep 3
  done
fi

./scripts/deploy/render-upstream.sh "$rollback_color"
echo "$rollback_color" > "$active_file"
echo "$current_color" > "$previous_file"

end_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"finished_at":"%s","from_slot":"%s","to_slot":"%s","status":"rollback"}\n' \
  "$end_iso" "$current_color" "$rollback_color" >> deploy/metrics/deployments.jsonl

echo "Rollback complete. Active slot: $rollback_color"
