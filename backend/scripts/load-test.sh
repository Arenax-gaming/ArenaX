#!/usr/bin/env bash
# =============================================================================
# load-test.sh — ArenaX Automated Load Testing Script
# =============================================================================
# Performs ramping virtual-user load tests against all critical ArenaX endpoints
# using curl (always available) and wrk/wrk2 when installed.
#
# Output files (written to RESULTS_DIR):
#   load_test_results_<timestamp>.json  — raw per-endpoint metrics (JSON)
#   load_test_summary_<timestamp>.txt   — human-readable summary
#
# Usage:
#   ./load-test.sh [OPTIONS]
#
# Options:
#   -u  BASE_URL      API base URL        (default: http://localhost:8080)
#   -d  DURATION      Seconds per stage   (default: 30)
#   -c  MAX_CONCURR   Peak concurrency    (default: 50)
#   -t  TOKEN         Bearer JWT token    (default: "")
#   -o  OUTPUT_DIR    Results directory   (default: ./capacity_results)
#   -h                Show this help
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
BASE_URL="http://localhost:8080"
STAGE_DURATION=30
MAX_CONCURRENCY=50
AUTH_TOKEN=""
RESULTS_DIR="./capacity_results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# --------------------------------------------------------------------------- #
# Colours
# --------------------------------------------------------------------------- #
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "u:d:c:t:o:h" opt; do
  case $opt in
    u) BASE_URL="$OPTARG" ;;
    d) STAGE_DURATION="$OPTARG" ;;
    c) MAX_CONCURRENCY="$OPTARG" ;;
    t) AUTH_TOKEN="$OPTARG" ;;
    o) RESULTS_DIR="$OPTARG" ;;
    h)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

# --------------------------------------------------------------------------- #
# Setup
# --------------------------------------------------------------------------- #
mkdir -p "$RESULTS_DIR"
RESULTS_JSON="$RESULTS_DIR/load_test_results_${TIMESTAMP}.json"
RESULTS_TXT="$RESULTS_DIR/load_test_summary_${TIMESTAMP}.txt"

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✔${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✖${NC} $*"; }

# --------------------------------------------------------------------------- #
# Endpoint registry — all critical ArenaX endpoints
# --------------------------------------------------------------------------- #
# Format: "METHOD|PATH|DESCRIPTION|EXPECTED_STATUS"
ENDPOINTS=(
  "GET|/api/health|Health check|200"
  "GET|/api/auth/me|Auth profile|200,401"
  "GET|/api/tournaments|List tournaments|200"
  "GET|/api/matches|List matches|200"
  "GET|/api/leaderboard?period=weekly|Weekly leaderboard|200"
  "GET|/api/wallet|Wallet balance|200,401"
  "GET|/api/matchmaking/status|Matchmaking status|200,401"
  "POST|/api/matchmaking/join|Join matchmaking queue|200,400,401"
  "GET|/api/wallet/payout/status/test-tx|Stellar tx status|200,404,401"
)

# --------------------------------------------------------------------------- #
# Utilities
# --------------------------------------------------------------------------- #
check_prerequisites() {
  log "Checking prerequisites..."
  local missing=()
  command -v curl &>/dev/null || missing+=("curl")
  command -v bc   &>/dev/null || missing+=("bc")
  command -v jq   &>/dev/null || warn "jq not found — JSON output will be basic"

  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required tools: ${missing[*]}"
    exit 1
  fi

  if command -v wrk &>/dev/null; then
    WRK_AVAILABLE=true
    ok "wrk found — will use for throughput benchmarks"
  else
    WRK_AVAILABLE=false
    warn "wrk not found — using curl-based concurrency simulation"
  fi
  ok "Prerequisites satisfied"
}

wait_for_api() {
  log "Waiting for API at $BASE_URL ..."
  local attempts=0 max=20
  until curl -sf --max-time 5 "$BASE_URL/api/health" &>/dev/null; do
    ((attempts++))
    [[ $attempts -ge $max ]] && { err "API unreachable after $max attempts"; exit 1; }
    warn "  attempt $attempts/$max — retrying in 3s..."
    sleep 3
  done
  ok "API is reachable"
}

build_curl_headers() {
  local hdrs=('-H' 'Content-Type: application/json' '-H' 'Accept: application/json')
  [[ -n "$AUTH_TOKEN" ]] && hdrs+=('-H' "Authorization: Bearer $AUTH_TOKEN")
  echo "${hdrs[@]}"
}

# --------------------------------------------------------------------------- #
# Single-request timing probe
# probe_endpoint METHOD URL
# Returns: "http_code|total_ms|dns_ms|connect_ms|ttfb_ms|transfer_ms"
# --------------------------------------------------------------------------- #
probe_endpoint() {
  local method="$1" url="$2"
  local body=""
  [[ "$method" == "POST" ]] && body='{"game":"load-test","game_mode":"ranked"}'

  local fmt='%{http_code}|%{time_total}|%{time_namelookup}|%{time_connect}|%{time_starttransfer}|%{time_pretransfer}'
  local extra_args=()
  [[ "$method" == "POST" ]] && extra_args=('-d' "$body")

  # shellcheck disable=SC2046
  curl -s -o /dev/null --max-time 15 \
    -X "$method" \
    $(build_curl_headers) \
    -w "$fmt" \
    "${extra_args[@]}" \
    "$url" 2>/dev/null || echo "000|15|0|0|15|0"
}

# --------------------------------------------------------------------------- #
# Concurrent curl burst
# burst_test METHOD URL CONCURRENCY REQUESTS
# Returns: success_count fail_count avg_ms p95_ms max_ms
# --------------------------------------------------------------------------- #
burst_test() {
  local method="$1" url="$2" concurrency="$3" total_reqs="$4"
  local tmpdir
  tmpdir=$(mktemp -d)

  local pids=() req_per_proc=$(( (total_reqs + concurrency - 1) / concurrency ))

  for (( w=0; w<concurrency; w++ )); do
    (
      local timings=()
      for (( r=0; r<req_per_proc; r++ )); do
        local result
        result=$(probe_endpoint "$method" "$url")
        local ms total
        total=$(echo "$result" | cut -d'|' -f2)
        ms=$(echo "scale=0; $total * 1000 / 1" | bc 2>/dev/null || echo "0")
        timings+=("$ms")
      done
      printf '%s\n' "${timings[@]}" > "$tmpdir/worker_${w}.txt"
    ) &
    pids+=($!)
  done

  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

  # Aggregate results
  local all_times=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && all_times+=("$line")
  done < <(cat "$tmpdir"/worker_*.txt 2>/dev/null || true)
  rm -rf "$tmpdir"

  local count=${#all_times[@]}
  [[ $count -eq 0 ]] && { echo "0 $total_reqs 0 0 0"; return; }

  # Sort for percentiles
  IFS=$'\n' sorted=($(sort -n <<<"${all_times[*]}")); unset IFS
  local sum=0
  for t in "${sorted[@]}"; do (( sum += t )) || true; done
  local avg=$(( sum / count ))
  local p95_idx=$(( count * 95 / 100 ))
  local p95=${sorted[$p95_idx]:-0}
  local max=${sorted[-1]:-0}
  local success=$count
  local fail=$(( total_reqs - count ))

  echo "$success $fail $avg $p95 $max"
}

# --------------------------------------------------------------------------- #
# wrk-based throughput test (if available)
# wrk_test METHOD URL CONCURRENCY DURATION_SECS
# Returns: requests_per_sec avg_latency_ms
# --------------------------------------------------------------------------- #
wrk_test() {
  local method="$1" url="$2" concurrency="$3" duration="$4"
  [[ "$WRK_AVAILABLE" != "true" ]] && { echo "0 0"; return; }

  local lua_script
  lua_script=$(mktemp /tmp/wrk_XXXXXX.lua)
  cat > "$lua_script" <<LUA
wrk.method = "$method"
wrk.headers["Content-Type"] = "application/json"
wrk.headers["Accept"] = "application/json"
$([ -n "$AUTH_TOKEN" ] && echo "wrk.headers[\"Authorization\"] = \"Bearer $AUTH_TOKEN\"")
$([ "$method" = "POST" ] && echo 'wrk.body = "{\"game\":\"load-test\",\"game_mode\":\"ranked\"}"')
LUA

  local output
  output=$(wrk -t"$concurrency" -c"$concurrency" -d"${duration}s" \
    --script="$lua_script" "$url" 2>&1 || true)
  rm -f "$lua_script"

  local rps avg_lat
  rps=$(echo "$output" | grep -oP 'Requests/sec:\s+\K[\d.]+' | head -1 || echo "0")
  avg_lat=$(echo "$output" | grep -oP 'Latency\s+\K[\d.]+(?=ms)' | head -1 || echo "0")

  echo "${rps:-0} ${avg_lat:-0}"
}

# --------------------------------------------------------------------------- #
# Test a single endpoint at multiple concurrency stages
# --------------------------------------------------------------------------- #
test_endpoint() {
  local method="$1" path="$2" description="$3"
  local url="${BASE_URL}${path}"

  log "  Testing: $description ($method $path)"

  local stages=(1 5 10 25 $MAX_CONCURRENCY)
  local endpoint_results=()

  for concurrency in "${stages[@]}"; do
    local reqs=$(( concurrency * 5 ))   # 5 requests per virtual user per stage
    local burst
    burst=$(burst_test "$method" "$url" "$concurrency" "$reqs")
    read -r success fail avg p95 max <<< "$burst"

    local rps wrk_avg
    if [[ $STAGE_DURATION -ge 5 ]]; then
      read -r rps wrk_avg <<< "$(wrk_test "$method" "$url" "$concurrency" "$STAGE_DURATION")"
    else
      rps=0; wrk_avg=0
    fi

    endpoint_results+=("{\"concurrency\":$concurrency,\"requests\":$reqs,\"success\":$success,\"fail\":$fail,\"avg_ms\":$avg,\"p95_ms\":$p95,\"max_ms\":$max,\"rps\":$rps}")
    printf "    %-4s VUs | avg: %4sms | p95: %4sms | max: %4sms | ✔ %s ✖ %s\n" \
      "$concurrency" "$avg" "$p95" "$max" "$success" "$fail"
  done

  # Return JSON array string
  local joined
  joined=$(printf '%s,' "${endpoint_results[@]}")
  echo "[${joined%,}]"
}

# --------------------------------------------------------------------------- #
# Main ramp test — progressively increases load across all endpoints
# --------------------------------------------------------------------------- #
run_ramp_test() {
  log "Starting ramped load test across all ArenaX endpoints..."
  echo ""

  local all_endpoint_json=""
  local sep=""

  for entry in "${ENDPOINTS[@]}"; do
    IFS='|' read -r method path description expected_status <<< "$entry"
    local url="${BASE_URL}${path}"

    echo -e "${CYAN}┌─ Endpoint: $description${NC}"

    # Quick baseline probe
    local baseline
    baseline=$(probe_endpoint "$method" "$url")
    local http_code
    http_code=$(echo "$baseline" | cut -d'|' -f1)
    local baseline_ms
    baseline_ms=$(echo "$baseline" | cut -d'|' -f2 | awk '{printf "%.0f", $1 * 1000}')

    echo -e "   Baseline: HTTP $http_code | ${baseline_ms}ms"

    local stage_results
    stage_results=$(test_endpoint "$method" "$path" "$description")

    all_endpoint_json+="${sep}{\"endpoint\":\"$path\",\"method\":\"$method\",\"description\":\"$description\",\"expected_status\":\"$expected_status\",\"baseline_http_code\":$http_code,\"baseline_ms\":$baseline_ms,\"stages\":$stage_results}"
    sep=","
    echo -e "${CYAN}└──────────────────────────────${NC}"
    echo ""
    sleep 1   # Brief pause between endpoints
  done

  # Write JSON results
  cat > "$RESULTS_JSON" <<JSON
{
  "meta": {
    "tool": "ArenaX load-test.sh",
    "timestamp": "$(date -Iseconds)",
    "base_url": "$BASE_URL",
    "max_concurrency": $MAX_CONCURRENCY,
    "stage_duration_secs": $STAGE_DURATION
  },
  "endpoints": [$all_endpoint_json]
}
JSON
  ok "JSON results written to $RESULTS_JSON"
}

# --------------------------------------------------------------------------- #
# Generate text summary
# --------------------------------------------------------------------------- #
generate_summary() {
  {
    echo "================================================================"
    echo " ArenaX Load Test Summary"
    echo " Generated: $(date)"
    echo " Target:    $BASE_URL"
    echo " Peak VUs:  $MAX_CONCURRENCY"
    echo "================================================================"
    echo ""
    echo "ENDPOINT RESULTS"
    echo "----------------"
    if command -v jq &>/dev/null && [[ -f "$RESULTS_JSON" ]]; then
      jq -r '.endpoints[] |
        "Endpoint : \(.method) \(.endpoint)",
        "Baseline : \(.baseline_http_code) — \(.baseline_ms)ms",
        "Peak VUs : \(.stages[-1].concurrency) | avg \(.stages[-1].avg_ms)ms | p95 \(.stages[-1].p95_ms)ms | max \(.stages[-1].max_ms)ms",
        "Success  : \(.stages[-1].success) / \(.stages[-1].requests) requests",
        ""
      ' "$RESULTS_JSON"
    else
      echo "(Install jq for a richer summary — raw data in $RESULTS_JSON)"
    fi
    echo "================================================================"
    echo " Results: $RESULTS_JSON"
    echo "================================================================"
  } | tee "$RESULTS_TXT"
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
main() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   ArenaX Load Test — $(date +%Y-%m-%d\ %H:%M:%S)      ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Base URL    : $BASE_URL"
  echo "  Max VUs     : $MAX_CONCURRENCY"
  echo "  Stage time  : ${STAGE_DURATION}s"
  echo "  Results dir : $RESULTS_DIR"
  echo ""

  check_prerequisites
  wait_for_api
  echo ""
  run_ramp_test
  echo ""
  generate_summary

  echo ""
  ok "Load test complete."
  echo "  JSON : $RESULTS_JSON"
  echo "  Text : $RESULTS_TXT"
}

main "$@"
