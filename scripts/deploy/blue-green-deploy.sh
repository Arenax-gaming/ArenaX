#!/usr/bin/env bash
# Zero-downtime blue/green deploy with an optional canary phase, for #972.
#
# 1. Determine the idle slot (the color NOT currently receiving traffic,
#    tracked in deploy/state/active-slot).
# 2. Start the idle slot on the new image tag.
# 3. Health-check the idle slot before it receives any real traffic.
# 4. Canary: shift CANARY_WEIGHT% of traffic to it for CANARY_BAKE_SECONDS,
#    re-checking health throughout. Abort (and never touch the active
#    slot) if a health check fails during the bake.
# 5. Full cutover: reload nginx to send 100% of traffic to the new slot.
#    A graceful `nginx -s reload` finishes in-flight requests on the old
#    upstream and routes new ones to the new upstream — no dropped
#    requests, no maintenance window.
# 6. Keep the old slot running (warm) for ROLLBACK_WINDOW_SECONDS so
#    rollback.sh can flip back instantly, then stop it.
# 7. Record deployment metrics (start/end time, duration, outcome, slot
#    transition) to deploy/metrics/deployments.jsonl.
#
# Usage:
#   IMAGE_TAG=<git-sha> ./scripts/deploy/blue-green-deploy.sh
#
# Env:
#   IMAGE_TAG               (required) image tag to deploy, built by CI
#   BACKEND_IMAGE, FRONTEND_IMAGE  image repos (defaults: arenax-backend / arenax-frontend)
#   CANARY_WEIGHT            (default 10) percent of traffic sent to the canary phase
#   CANARY_BAKE_SECONDS       (default 60) how long to hold the canary split
#   ROLLBACK_WINDOW_SECONDS    (default 120) how long the old slot stays warm post-cutover
#   HEALTH_CHECK_RETRIES        (default 10) readiness probe attempts
#   HEALTH_CHECK_INTERVAL_SECONDS (default 3)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

: "${IMAGE_TAG:?IMAGE_TAG must be set to the image tag to deploy}"
canary_weight="${CANARY_WEIGHT:-10}"
canary_bake_seconds="${CANARY_BAKE_SECONDS:-60}"
rollback_window_seconds="${ROLLBACK_WINDOW_SECONDS:-120}"
health_retries="${HEALTH_CHECK_RETRIES:-10}"
health_interval="${HEALTH_CHECK_INTERVAL_SECONDS:-3}"

compose="docker compose -f deploy/docker-compose.deploy.yml"
state_dir="deploy/state"
active_file="$state_dir/active-slot"
mkdir -p "$state_dir" deploy/metrics

active_color="blue"
[ -f "$active_file" ] && active_color="$(cat "$active_file")"
idle_color="green"
[ "$active_color" = "green" ] && idle_color="blue"

start_ts=$(date -u +%s)
start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "== Deploying $IMAGE_TAG =="
echo "Active slot: $active_color | Deploying to idle slot: $idle_color"

record_metric() {
  local status="$1"
  local end_ts end_iso duration
  end_ts=$(date -u +%s)
  end_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  duration=$((end_ts - start_ts))
  printf '{"started_at":"%s","finished_at":"%s","duration_seconds":%d,"image_tag":"%s","from_slot":"%s","to_slot":"%s","status":"%s"}\n' \
    "$start_iso" "$end_iso" "$duration" "$IMAGE_TAG" "$active_color" "$idle_color" "$status" \
    >> deploy/metrics/deployments.jsonl
  echo "Deployment metrics recorded: status=$status duration=${duration}s"
}

health_check() {
  local color="$1"
  local attempt=1
  while [ "$attempt" -le "$health_retries" ]; do
    if $compose exec -T "backend-$color" curl -fsS "http://localhost:8080/api/health" >/dev/null 2>&1; then
      echo "backend-$color healthy (attempt $attempt/$health_retries)"
      return 0
    fi
    echo "backend-$color not ready yet (attempt $attempt/$health_retries)"
    sleep "$health_interval"
    attempt=$((attempt + 1))
  done
  return 1
}

abort() {
  echo "DEPLOY FAILED: $1" >&2
  $compose stop "backend-$idle_color" "frontend-$idle_color" >/dev/null 2>&1 || true
  record_metric "failed"
  exit 1
}

BACKEND_IMAGE="${BACKEND_IMAGE:-arenax-backend}" \
FRONTEND_IMAGE="${FRONTEND_IMAGE:-arenax-frontend}" \
IMAGE_TAG="$IMAGE_TAG" \
  $compose up -d "backend-$idle_color" "frontend-$idle_color"

echo "-- Health-checking idle slot ($idle_color) before it takes any traffic --"
health_check "$idle_color" || abort "idle slot $idle_color failed readiness checks"

echo "-- Canary: routing ${canary_weight}% of traffic to $idle_color for ${canary_bake_seconds}s --"
./scripts/deploy/render-upstream.sh "$active_color" "$idle_color" "$canary_weight"

bake_elapsed=0
while [ "$bake_elapsed" -lt "$canary_bake_seconds" ]; do
  sleep "$health_interval"
  bake_elapsed=$((bake_elapsed + health_interval))
  if ! $compose exec -T "backend-$idle_color" curl -fsS "http://localhost:8080/api/health" >/dev/null 2>&1; then
    ./scripts/deploy/render-upstream.sh "$active_color"
    abort "$idle_color failed a health check during the canary bake — reverted to 100% $active_color"
  fi
done

echo "-- Canary bake passed. Cutting over to 100% $idle_color --"
./scripts/deploy/render-upstream.sh "$idle_color"
echo "$idle_color" > "$active_file"
echo "$active_color" > "$state_dir/previous-slot"

echo "-- Keeping $active_color warm for ${rollback_window_seconds}s in case a fast rollback is needed --"
sleep "$rollback_window_seconds"

echo "-- Decommissioning old slot ($active_color) --"
$compose stop "backend-$active_color" "frontend-$active_color"

record_metric "success"
echo "== Deploy of $IMAGE_TAG complete. Active slot: $idle_color =="
