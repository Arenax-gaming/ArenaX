#!/usr/bin/env bash
# =============================================================================
# bottleneck-identify.sh — ArenaX Bottleneck Identification Script
# =============================================================================
# Collects CPU, memory, PostgreSQL slow-query, and Redis latency metrics
# concurrently with a configurable load probe, then correlates them to
# identify the dominant bottleneck tier: CPU | MEMORY | DATABASE | REDIS | NETWORK
#
# Usage:
#   ./bottleneck-identify.sh [OPTIONS]
#
# Options:
#   -u  BASE_URL      API base URL           (default: http://localhost:8080)
#   -d  DURATION      Sampling duration secs (default: 60)
#   -i  INTERVAL      Sample interval secs   (default: 5)
#   -c  CONCURRENCY   Probe concurrency      (default: 20)
#   -t  TOKEN         Bearer JWT token       (default: "")
#   -D  DB_URL        PostgreSQL URL         (default: $DATABASE_URL env var)
#   -R  REDIS_URL     Redis URL              (default: redis://localhost:6379)
#   -o  OUTPUT_DIR    Results directory      (default: ./capacity_results)
#   -h                Show this help
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
BASE_URL="http://localhost:8080"
DURATION=60
INTERVAL=5
CONCURRENCY=20
AUTH_TOKEN=""
DB_URL="${DATABASE_URL:-}"
REDIS_URL="redis://localhost:6379"
RESULTS_DIR="./capacity_results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "u:d:i:c:t:D:R:o:h" opt; do
  case $opt in
    u) BASE_URL="$OPTARG" ;;
    d) DURATION="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    c) CONCURRENCY="$OPTARG" ;;
    t) AUTH_TOKEN="$OPTARG" ;;
    D) DB_URL="$OPTARG" ;;
    R) REDIS_URL="$OPTARG" ;;
    o) RESULTS_DIR="$OPTARG" ;;
    h)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

mkdir -p "$RESULTS_DIR"
REPORT_FILE="$RESULTS_DIR/bottleneck_report_${TIMESTAMP}.txt"
METRICS_JSON="$RESULTS_DIR/bottleneck_metrics_${TIMESTAMP}.json"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✔${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✖${NC} $*"; }

# --------------------------------------------------------------------------- #
# Capability detection
# --------------------------------------------------------------------------- #
HAS_PSQL=false; HAS_REDIS_CLI=false; HAS_JQ=false; HAS_AWK=false
command -v psql      &>/dev/null && HAS_PSQL=true
command -v redis-cli &>/dev/null && HAS_REDIS_CLI=true
command -v jq        &>/dev/null && HAS_JQ=true
command -v awk       &>/dev/null && HAS_AWK=true

log "Tool availability — psql:$HAS_PSQL redis-cli:$HAS_REDIS_CLI jq:$HAS_JQ"

# --------------------------------------------------------------------------- #
# ── CPU / Memory sampler ────────────────────────────────────────────────── #
# --------------------------------------------------------------------------- #
sample_system() {
  local out="$TMP_DIR/system_samples.csv"
  echo "timestamp,cpu_pct,mem_used_mb,mem_total_mb,load_1m" > "$out"
  local end=$(( $(date +%s) + DURATION ))
  while [[ $(date +%s) -lt $end ]]; do
    local ts; ts=$(date +%s)
    local cpu mem_used mem_total load1
    # CPU % (idle subtracted from 100)
    if [[ "$(uname)" == "Darwin" ]]; then
      cpu=$(top -l 1 -s 0 | awk '/CPU usage/{gsub(/%/,""); print 100 - $NF}' 2>/dev/null || echo "0")
      mem_used=$(vm_stat 2>/dev/null | awk '/Pages active/{print $3+0}' | awk '{print int($1*4096/1048576)}' || echo "0")
      mem_total=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo "0")
    else
      cpu=$(grep 'cpu ' /proc/stat | awk '{idle=$5; total=$2+$3+$4+$5+$6+$7+$8; print 100 - int(idle*100/total)}' 2>/dev/null || echo "0")
      mem_used=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{print int((t-a)/1024)}' /proc/meminfo 2>/dev/null || echo "0")
      mem_total=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo "0")
    fi
    load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || uptime | awk -F'load average' '{print $2}' | cut -d',' -f1 | tr -d ' ')
    echo "$ts,$cpu,$mem_used,$mem_total,${load1:-0}" >> "$out"
    sleep "$INTERVAL"
  done
}

# --------------------------------------------------------------------------- #
# ── PostgreSQL slow-query sampler ───────────────────────────────────────── #
# --------------------------------------------------------------------------- #
sample_postgres() {
  local out="$TMP_DIR/pg_samples.csv"
  echo "timestamp,active_queries,max_duration_ms,long_query_count,cache_hit_ratio,dead_tuples" > "$out"

  if [[ "$HAS_PSQL" != "true" || -z "$DB_URL" ]]; then
    warn "PostgreSQL sampling skipped (psql not found or DATABASE_URL not set)"
    return
  fi

  local end=$(( $(date +%s) + DURATION ))
  while [[ $(date +%s) -lt $end ]]; do
    local ts; ts=$(date +%s)
    local result
    result=$(psql "$DB_URL" -t -A -c "
      SELECT
        count(*)                                                   AS active_queries,
        coalesce(max(extract(epoch from now()-query_start)*1000),0) AS max_duration_ms,
        count(*) FILTER (WHERE extract(epoch from now()-query_start) > 1) AS long_query_count
      FROM pg_stat_activity
      WHERE state = 'active' AND query NOT LIKE '%pg_stat%';
    " 2>/dev/null | tr '|' ',')

    local cache_hit
    cache_hit=$(psql "$DB_URL" -t -A -c "
      SELECT round(sum(heap_blks_hit)*100.0 / nullif(sum(heap_blks_hit+heap_blks_read),0), 2)
      FROM pg_statio_user_tables;
    " 2>/dev/null | tr -d ' ' || echo "0")

    local dead_tuples
    dead_tuples=$(psql "$DB_URL" -t -A -c "
      SELECT coalesce(sum(n_dead_tup), 0) FROM pg_stat_user_tables;
    " 2>/dev/null | tr -d ' ' || echo "0")

    echo "${ts},${result:-0,0,0},${cache_hit:-0},${dead_tuples:-0}" >> "$out"
    sleep "$INTERVAL"
  done
}

# --------------------------------------------------------------------------- #
# ── Redis latency sampler ────────────────────────────────────────────────── #
# --------------------------------------------------------------------------- #
sample_redis() {
  local out="$TMP_DIR/redis_samples.csv"
  echo "timestamp,used_memory_mb,connected_clients,ops_per_sec,keyspace_hits,keyspace_misses,latency_us" > "$out"

  if [[ "$HAS_REDIS_CLI" != "true" ]]; then
    warn "Redis sampling skipped (redis-cli not found)"
    return
  fi

  # Parse host/port from REDIS_URL
  local redis_host redis_port
  redis_host=$(echo "$REDIS_URL" | sed -E 's|redis://([^:/]+).*|\1|')
  redis_port=$(echo "$REDIS_URL" | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')
  redis_host="${redis_host:-localhost}"
  redis_port="${redis_port:-6379}"

  local end=$(( $(date +%s) + DURATION ))
  while [[ $(date +%s) -lt $end ]]; do
    local ts; ts=$(date +%s)
    local info
    info=$(redis-cli -h "$redis_host" -p "$redis_port" info all 2>/dev/null || echo "")

    local mem_mb clients ops hits misses
    mem_mb=$(echo "$info" | grep '^used_memory:' | awk -F: '{printf "%.1f", $2/1048576}' || echo "0")
    clients=$(echo "$info" | grep '^connected_clients:' | awk -F: '{print $2}' | tr -d ' \r' || echo "0")
    ops=$(echo "$info" | grep '^instantaneous_ops_per_sec:' | awk -F: '{print $2}' | tr -d ' \r' || echo "0")
    hits=$(echo "$info" | grep '^keyspace_hits:' | awk -F: '{print $2}' | tr -d ' \r' || echo "0")
    misses=$(echo "$info" | grep '^keyspace_misses:' | awk -F: '{print $2}' | tr -d ' \r' || echo "0")

    # Intrinsic latency sample (microseconds) — quick 10ms window
    local lat
    lat=$(redis-cli -h "$redis_host" -p "$redis_port" --latency-history \
      --no-auth-warning -i 0.01 2>/dev/null | head -1 | awk '{print $4}' || echo "0")
    lat="${lat:-0}"

    echo "${ts},${mem_mb:-0},${clients:-0},${ops:-0},${hits:-0},${misses:-0},${lat:-0}" >> "$out"
    sleep "$INTERVAL"
  done
}

# --------------------------------------------------------------------------- #
# ── API response-time sampler ────────────────────────────────────────────── #
# --------------------------------------------------------------------------- #
sample_api() {
  local out="$TMP_DIR/api_samples.csv"
  echo "timestamp,endpoint,http_code,duration_ms" > "$out"
  local hdrs=('-H' 'Content-Type: application/json')
  [[ -n "$AUTH_TOKEN" ]] && hdrs+=('-H' "Authorization: Bearer $AUTH_TOKEN")

  local probes=(
    "GET|/api/health"
    "GET|/api/tournaments"
    "GET|/api/leaderboard?period=weekly"
    "GET|/api/wallet"
    "GET|/api/matchmaking/status"
  )

  local end=$(( $(date +%s) + DURATION ))
  while [[ $(date +%s) -lt $end ]]; do
    for probe in "${probes[@]}"; do
      IFS='|' read -r method path <<< "$probe"
      local result
      result=$(curl -s -o /dev/null --max-time 10 \
        -X "$method" "${hdrs[@]}" \
        -w "%{http_code}|%{time_total}" \
        "${BASE_URL}${path}" 2>/dev/null || echo "000|10")
      local code dur_ms
      code=$(echo "$result" | cut -d'|' -f1)
      dur_ms=$(echo "$result" | cut -d'|' -f2 | awk '{printf "%.0f", $1 * 1000}')
      echo "$(date +%s),$path,$code,$dur_ms" >> "$out"
    done
    sleep "$INTERVAL"
  done
}

# --------------------------------------------------------------------------- #
# ── Concurrent load probe ─────────────────────────────────────────────────── #
# --------------------------------------------------------------------------- #
run_load_probe() {
  local hdrs=('-H' 'Content-Type: application/json')
  [[ -n "$AUTH_TOKEN" ]] && hdrs+=('-H' "Authorization: Bearer $AUTH_TOKEN")
  local end=$(( $(date +%s) + DURATION ))
  while [[ $(date +%s) -lt $end ]]; do
    for (( i=0; i<CONCURRENCY; i++ )); do
      curl -s -o /dev/null --max-time 5 -X GET \
        "${hdrs[@]}" "${BASE_URL}/api/tournaments" &
    done
    wait
    sleep 1
  done
}

# --------------------------------------------------------------------------- #
# ── Aggregate and score bottlenecks ──────────────────────────────────────── #
# --------------------------------------------------------------------------- #
analyse_results() {
  local scores=()
  declare -A score
  score[CPU]=0; score[MEMORY]=0; score[DATABASE]=0; score[REDIS]=0; score[NETWORK]=0

  # ── CPU analysis ──────────────────────────────────────────────────────── #
  if [[ -f "$TMP_DIR/system_samples.csv" ]]; then
    local avg_cpu max_cpu
    avg_cpu=$(awk -F, 'NR>1{sum+=$2; n++} END{if(n>0) printf "%.1f", sum/n; else print 0}' \
      "$TMP_DIR/system_samples.csv")
    max_cpu=$(awk -F, 'NR>1{if($2>max) max=$2} END{print max+0}' \
      "$TMP_DIR/system_samples.csv")
    (( $(echo "$avg_cpu > 80" | bc -l) )) && score[CPU]=$(( score[CPU] + 40 ))
    (( $(echo "$avg_cpu > 60" | bc -l) )) && score[CPU]=$(( score[CPU] + 20 ))
    (( $(echo "$max_cpu > 90" | bc -l) )) && score[CPU]=$(( score[CPU] + 20 ))
    echo "CPU:avg=$avg_cpu%,max=$max_cpu%" >> "$TMP_DIR/score_notes.txt"
  fi

  # ── Memory analysis ───────────────────────────────────────────────────── #
  if [[ -f "$TMP_DIR/system_samples.csv" ]]; then
    local mem_pct
    mem_pct=$(awk -F, 'NR>1 && $4>0{pct=$3/$4*100; sum+=pct; n++} END{if(n>0) printf "%.1f", sum/n; else print 0}' \
      "$TMP_DIR/system_samples.csv")
    (( $(echo "$mem_pct > 85" | bc -l) )) && score[MEMORY]=$(( score[MEMORY] + 40 ))
    (( $(echo "$mem_pct > 70" | bc -l) )) && score[MEMORY]=$(( score[MEMORY] + 20 ))
    echo "MEMORY:avg_pct=$mem_pct%" >> "$TMP_DIR/score_notes.txt"
  fi

  # ── DB analysis ───────────────────────────────────────────────────────── #
  if [[ -f "$TMP_DIR/pg_samples.csv" ]]; then
    local avg_max_dur long_q dead
    avg_max_dur=$(awk -F, 'NR>1{sum+=$3; n++} END{if(n>0) printf "%.0f", sum/n; else print 0}' \
      "$TMP_DIR/pg_samples.csv")
    long_q=$(awk -F, 'NR>1{sum+=$4} END{print sum+0}' "$TMP_DIR/pg_samples.csv")
    dead=$(awk -F, 'NR>1{if($6>max) max=$6} END{print max+0}' "$TMP_DIR/pg_samples.csv")

    (( $(echo "$avg_max_dur > 1000" | bc -l) )) && score[DATABASE]=$(( score[DATABASE] + 40 ))
    (( $(echo "$avg_max_dur > 500"  | bc -l) )) && score[DATABASE]=$(( score[DATABASE] + 20 ))
    (( long_q > 10 ))                            && score[DATABASE]=$(( score[DATABASE] + 20 ))
    (( dead > 100000 ))                          && score[DATABASE]=$(( score[DATABASE] + 10 ))
    echo "DATABASE:avg_max_dur=${avg_max_dur}ms,long_queries=$long_q,dead_tuples=$dead" >> "$TMP_DIR/score_notes.txt"
  fi

  # ── Redis analysis ─────────────────────────────────────────────────────── #
  if [[ -f "$TMP_DIR/redis_samples.csv" ]]; then
    local avg_lat miss_rate avg_ops
    avg_lat=$(awk -F, 'NR>1{sum+=$7; n++} END{if(n>0) printf "%.0f", sum/n; else print 0}' \
      "$TMP_DIR/redis_samples.csv")
    miss_rate=$(awk -F, 'NR>1{h+=$5; m+=$6} END{total=h+m; if(total>0) printf "%.1f", m/total*100; else print 0}' \
      "$TMP_DIR/redis_samples.csv")
    avg_ops=$(awk -F, 'NR>1{sum+=$4; n++} END{if(n>0) printf "%.0f", sum/n; else print 0}' \
      "$TMP_DIR/redis_samples.csv")

    (( $(echo "$avg_lat > 1000" | bc -l) )) && score[REDIS]=$(( score[REDIS] + 40 ))
    (( $(echo "$miss_rate > 20" | bc -l) )) && score[REDIS]=$(( score[REDIS] + 20 ))
    echo "REDIS:avg_latency_us=${avg_lat},miss_rate=${miss_rate}%,avg_ops=$avg_ops" >> "$TMP_DIR/score_notes.txt"
  fi

  # ── Network / API analysis ─────────────────────────────────────────────── #
  if [[ -f "$TMP_DIR/api_samples.csv" ]]; then
    local avg_dur p99_dur err_pct
    avg_dur=$(awk -F, 'NR>1{sum+=$4; n++} END{if(n>0) printf "%.0f", sum/n; else print 0}' \
      "$TMP_DIR/api_samples.csv")
    p99_dur=$(awk -F, 'NR>1{print $4}' "$TMP_DIR/api_samples.csv" | sort -n | \
      awk 'BEGIN{c=0} {a[c++]=$0} END{print a[int(c*0.99)]+0}')
    err_pct=$(awk -F, 'NR>1{t++; if($3>=500 || $3==0) e++} END{if(t>0) printf "%.1f", e/t*100; else print 0}' \
      "$TMP_DIR/api_samples.csv")

    (( $(echo "$avg_dur > 1000" | bc -l) )) && score[NETWORK]=$(( score[NETWORK] + 30 ))
    (( $(echo "$err_pct  > 5"   | bc -l) )) && score[NETWORK]=$(( score[NETWORK] + 40 ))
    echo "NETWORK:avg_dur=${avg_dur}ms,p99=${p99_dur}ms,err_pct=${err_pct}%" >> "$TMP_DIR/score_notes.txt"
  fi

  # ── Find dominant bottleneck ────────────────────────────────────────────── #
  local dominant="NONE" dominant_score=0
  for tier in CPU MEMORY DATABASE REDIS NETWORK; do
    if (( score[$tier] > dominant_score )); then
      dominant_score=${score[$tier]}
      dominant="$tier"
    fi
  done

  # ── Write report ───────────────────────────────────────────────────────── #
  {
    echo "======================================================================"
    echo " ArenaX — Bottleneck Identification Report"
    echo " Generated : $(date)"
    echo " Target    : $BASE_URL"
    echo " Duration  : ${DURATION}s @ ${CONCURRENCY} concurrent probes"
    echo "======================================================================"
    echo ""
    echo "BOTTLENECK SCORES  (0 = healthy, 80+ = severe)"
    echo "----------------------------------------------------------------------"
    for tier in CPU MEMORY DATABASE REDIS NETWORK; do
      local bar=""
      local s=${score[$tier]}
      for (( i=0; i<s/5; i++ )); do bar+="█"; done
      printf "  %-10s %3d  %s\n" "$tier" "$s" "$bar"
    done
    echo ""
    echo "DOMINANT BOTTLENECK: ► $dominant ◄  (score: $dominant_score)"
    echo ""
    echo "METRIC DETAILS"
    echo "----------------------------------------------------------------------"
    [[ -f "$TMP_DIR/score_notes.txt" ]] && \
      sed 's/:/: /; s/,/\n              /g; s/^/  /' "$TMP_DIR/score_notes.txt"
    echo ""
    echo "FINDINGS & RECOMMENDATIONS"
    echo "----------------------------------------------------------------------"
    case "$dominant" in
      CPU)
        echo "  ● High CPU utilisation is the primary bottleneck."
        echo "  ● Add more CPU cores or horizontal replicas."
        echo "  ● Profile Rust hot paths with 'cargo flamegraph'."
        echo "  ● Evaluate async task concurrency — check Tokio thread pool sizing."
        ;;
      MEMORY)
        echo "  ● Memory pressure is the primary bottleneck."
        echo "  ● Inspect heap allocations; consider switching allocator to mimalloc."
        echo "  ● Tune PostgreSQL 'shared_buffers' and 'work_mem'."
        echo "  ● Check Redis 'maxmemory' policy — eviction may be causing churn."
        ;;
      DATABASE)
        echo "  ● PostgreSQL is the primary bottleneck."
        echo "  ● Run EXPLAIN ANALYZE on the slowest queries."
        echo "  ● Add/review indexes on hot tables (tournaments, matches, leaderboard)."
        echo "  ● Tune 'max_connections' and use PgBouncer for connection pooling."
        echo "  ● Run VACUUM ANALYZE to address dead tuple bloat."
        ;;
      REDIS)
        echo "  ● Redis is the primary bottleneck."
        echo "  ● Check keyspace hit ratio — low values indicate cache misses."
        echo "  ● Review TTL strategy for tournament/leaderboard caches."
        echo "  ● Consider Redis Cluster if memory or ops throughput is saturated."
        echo "  ● Ensure pipeline batching is used for bulk operations."
        ;;
      NETWORK)
        echo "  ● Network / API layer is the primary bottleneck."
        echo "  ● Enable HTTP/2 and response compression (gzip/brotli)."
        echo "  ● Verify load balancer health-check and keep-alive settings."
        echo "  ● Check for slow middleware or excessive middleware chain length."
        ;;
      NONE)
        echo "  ● No significant bottleneck detected under the tested load."
        echo "  ● Increase concurrency with -c option to find the real limit."
        ;;
    esac
    echo ""
    echo "SAMPLE FILES"
    echo "----------------------------------------------------------------------"
    [[ -f "$TMP_DIR/system_samples.csv" ]] && echo "  System  : $TMP_DIR/system_samples.csv"
    [[ -f "$TMP_DIR/pg_samples.csv"     ]] && echo "  Postgres: $TMP_DIR/pg_samples.csv"
    [[ -f "$TMP_DIR/redis_samples.csv"  ]] && echo "  Redis   : $TMP_DIR/redis_samples.csv"
    [[ -f "$TMP_DIR/api_samples.csv"    ]] && echo "  API     : $TMP_DIR/api_samples.csv"
    echo ""
    echo "======================================================================"
    echo " END OF BOTTLENECK REPORT"
    echo "======================================================================"
  } | tee "$REPORT_FILE"

  # Write JSON
  if command -v jq &>/dev/null; then
    local notes_json="{}"
    if [[ -f "$TMP_DIR/score_notes.txt" ]]; then
      notes_json=$(awk -F: '{print "\""$1"\": \""$2"\""}' "$TMP_DIR/score_notes.txt" \
        | paste -sd ',' | sed 's/^/{/; s/$/}/')
    fi
    jq -n \
      --arg ts "$(date -Iseconds)" \
      --arg target "$BASE_URL" \
      --arg dominant "$dominant" \
      --argjson dominant_score "$dominant_score" \
      --argjson scores "{\"CPU\":${score[CPU]},\"MEMORY\":${score[MEMORY]},\"DATABASE\":${score[DATABASE]},\"REDIS\":${score[REDIS]},\"NETWORK\":${score[NETWORK]}}" \
      '{
        meta: { generated_at: $ts, target: $target },
        dominant_bottleneck: $dominant,
        dominant_score: $dominant_score,
        scores: $scores
      }' > "$METRICS_JSON"
    ok "JSON written to $METRICS_JSON"
  fi
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
main() {
  echo ""
  echo -e "${BOLD}${CYAN}ArenaX Bottleneck Identification${NC}"
  echo -e "  Target: $BASE_URL | Duration: ${DURATION}s | Concurrency: $CONCURRENCY"
  echo ""

  log "Launching parallel samplers..."

  # Run all samplers in background
  sample_system   &  SYS_PID=$!
  sample_postgres &  PG_PID=$!
  sample_redis    &  RD_PID=$!
  sample_api      &  API_PID=$!
  run_load_probe  &  LOAD_PID=$!

  log "Collecting metrics for ${DURATION}s... (press Ctrl+C to abort)"
  local bar_len=40
  local start; start=$(date +%s)
  while [[ $(( $(date +%s) - start )) -lt $DURATION ]]; do
    local elapsed=$(( $(date +%s) - start ))
    local filled=$(( elapsed * bar_len / DURATION ))
    local empty=$(( bar_len - filled ))
    printf "\r  [%-${bar_len}s] %ds / %ds" \
      "$(printf '#%.0s' $(seq 1 $filled))" "$elapsed" "$DURATION"
    sleep 1
  done
  echo ""

  for pid in $SYS_PID $PG_PID $RD_PID $API_PID $LOAD_PID; do
    wait "$pid" 2>/dev/null || true
  done

  ok "Sampling complete. Analysing results..."
  echo ""
  analyse_results

  echo ""
  ok "Bottleneck analysis complete."
  echo "  Report : $REPORT_FILE"
  [[ -f "$METRICS_JSON" ]] && echo "  JSON   : $METRICS_JSON"
}

main "$@"
