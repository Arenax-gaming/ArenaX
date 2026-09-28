#!/usr/bin/env bash
# =============================================================================
# scaling-recommend.sh — ArenaX Scaling Recommendations Generator
# =============================================================================
# Reads load-test and bottleneck JSON outputs, combines them with live
# resource metrics, and produces concrete horizontal + vertical scaling
# recommendations tailored to ArenaX's tech stack (Rust/Axum, PostgreSQL,
# Redis, Stellar).
#
# Usage:
#   ./scaling-recommend.sh [OPTIONS]
#
# Options:
#   -l  LOAD_JSON         Load test results JSON
#   -b  BOTTLENECK_JSON   Bottleneck metrics JSON
#   -d  RESULTS_DIR       Directory to scan for latest JSONs (default: ./capacity_results)
#   -o  OUTPUT_DIR        Where to write recommendations (default: ./capacity_results)
#   -T  TARGET_RPS        Target req/sec to plan for (default: 500)
#   -L  TARGET_P95_MS     Target p95 latency in ms  (default: 300)
#   -U  CURRENT_REPLICAS  Current backend replica count (default: 1)
#   -h                    Show this help
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
LOAD_JSON=""
BOTTLENECK_JSON=""
RESULTS_DIR="./capacity_results"
OUTPUT_DIR="./capacity_results"
TARGET_RPS=500
TARGET_P95_MS=300
CURRENT_REPLICAS=1
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "l:b:d:o:T:L:U:h" opt; do
  case $opt in
    l) LOAD_JSON="$OPTARG" ;;
    b) BOTTLENECK_JSON="$OPTARG" ;;
    d) RESULTS_DIR="$OPTARG" ;;
    o) OUTPUT_DIR="$OPTARG" ;;
    T) TARGET_RPS="$OPTARG" ;;
    L) TARGET_P95_MS="$OPTARG" ;;
    U) CURRENT_REPLICAS="$OPTARG" ;;
    h)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"
REPORT_TXT="$OUTPUT_DIR/scaling_recommendations_${TIMESTAMP}.txt"
REPORT_JSON="$OUTPUT_DIR/scaling_recommendations_${TIMESTAMP}.json"

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✔${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }

# --------------------------------------------------------------------------- #
# Resolve latest JSON files if not provided
# --------------------------------------------------------------------------- #
resolve_files() {
  if [[ -z "$LOAD_JSON" ]]; then
    LOAD_JSON=$(find "$RESULTS_DIR" -maxdepth 1 -name 'load_test_results_*.json' \
      2>/dev/null | sort | tail -1 || true)
    [[ -z "$LOAD_JSON" ]] && warn "No load test JSON found — will use defaults"
  fi
  if [[ -z "$BOTTLENECK_JSON" ]]; then
    BOTTLENECK_JSON=$(find "$RESULTS_DIR" -maxdepth 1 -name 'bottleneck_metrics_*.json' \
      2>/dev/null | sort | tail -1 || true)
    [[ -z "$BOTTLENECK_JSON" ]] && warn "No bottleneck metrics JSON found — will use defaults"
  fi
}

# --------------------------------------------------------------------------- #
# Extract key metrics from JSON files
# --------------------------------------------------------------------------- #
CURRENT_SAFE_RPS=0
CURRENT_SAFE_VUS=0
CURRENT_P95_MS=0
DOMINANT_BOTTLENECK="NONE"
CPU_SCORE=0; MEM_SCORE=0; DB_SCORE=0; REDIS_SCORE=0; NET_SCORE=0

extract_metrics() {
  if command -v jq &>/dev/null; then
    if [[ -n "$LOAD_JSON" && -f "$LOAD_JSON" ]]; then
      CURRENT_SAFE_RPS=$(jq '[.endpoints[].stages[-1].rps | tonumber] | add / length | ceil' \
        "$LOAD_JSON" 2>/dev/null || echo "0")
      CURRENT_SAFE_VUS=$(jq '[.endpoints[].stages | map(select(.p95_ms <= '"$TARGET_P95_MS"')) | last // .[-1] | .concurrency] | min' \
        "$LOAD_JSON" 2>/dev/null || echo "0")
      CURRENT_P95_MS=$(jq '[.endpoints[].stages[-1].p95_ms] | add / length | ceil' \
        "$LOAD_JSON" 2>/dev/null || echo "0")
    fi
    if [[ -n "$BOTTLENECK_JSON" && -f "$BOTTLENECK_JSON" ]]; then
      DOMINANT_BOTTLENECK=$(jq -r '.dominant_bottleneck // "NONE"' "$BOTTLENECK_JSON" 2>/dev/null || echo "NONE")
      CPU_SCORE=$(jq '.scores.CPU // 0' "$BOTTLENECK_JSON" 2>/dev/null || echo "0")
      MEM_SCORE=$(jq '.scores.MEMORY // 0' "$BOTTLENECK_JSON" 2>/dev/null || echo "0")
      DB_SCORE=$(jq '.scores.DATABASE // 0' "$BOTTLENECK_JSON" 2>/dev/null || echo "0")
      REDIS_SCORE=$(jq '.scores.REDIS // 0' "$BOTTLENECK_JSON" 2>/dev/null || echo "0")
      NET_SCORE=$(jq '.scores.NETWORK // 0' "$BOTTLENECK_JSON" 2>/dev/null || echo "0")
    fi
  fi
  log "Extracted: safe_rps=$CURRENT_SAFE_RPS, safe_vus=$CURRENT_SAFE_VUS, p95=${CURRENT_P95_MS}ms, bottleneck=$DOMINANT_BOTTLENECK"
}

# --------------------------------------------------------------------------- #
# Scaling math helpers
# --------------------------------------------------------------------------- #
calc_replicas() {
  # Ceiling division: how many replicas to hit target RPS
  local current_rps=$1 target=$2
  [[ $current_rps -le 0 ]] && current_rps=50  # fallback assumption
  echo $(( (target + current_rps - 1) / current_rps ))
}

scale_factor() {
  local current=$1 target=$2
  [[ $current -le 0 ]] && { echo "2.0"; return; }
  echo "scale=1; $target / $current" | bc 2>/dev/null || echo "2.0"
}

# --------------------------------------------------------------------------- #
# Generate recommendations
# --------------------------------------------------------------------------- #
generate_recommendations() {
  local needed_replicas
  needed_replicas=$(calc_replicas "$CURRENT_SAFE_RPS" "$TARGET_RPS")
  [[ $needed_replicas -lt $CURRENT_REPLICAS ]] && needed_replicas=$CURRENT_REPLICAS

  local add_replicas=$(( needed_replicas - CURRENT_REPLICAS ))
  local sf
  sf=$(scale_factor "$CURRENT_SAFE_RPS" "$TARGET_RPS")

  # DB connection pool size: replicas × 10 (common rule of thumb)
  local db_pool=$(( needed_replicas * 10 ))
  # Redis pool
  local redis_pool=$(( needed_replicas * 5 ))

  # Priority ratings based on bottleneck scores
  local backend_priority="MEDIUM"
  local db_priority="LOW"
  local redis_priority="LOW"
  local infra_priority="LOW"

  (( CPU_SCORE >= 40 || NET_SCORE >= 40 )) && backend_priority="HIGH"
  (( DB_SCORE >= 40  ))                    && db_priority="HIGH"
  (( DB_SCORE >= 20  ))                    && db_priority="MEDIUM"
  (( REDIS_SCORE >= 40 ))                  && redis_priority="HIGH"
  (( REDIS_SCORE >= 20 ))                  && redis_priority="MEDIUM"
  (( MEM_SCORE >= 40 ))                    && infra_priority="HIGH"

  {
    echo "======================================================================"
    echo " ArenaX — Scaling Recommendations"
    echo " Generated    : $(date)"
    echo " Target RPS   : $TARGET_RPS req/s"
    echo " Target p95   : ${TARGET_P95_MS}ms"
    echo " Current load : ~${CURRENT_SAFE_RPS} RPS (safe), ~${CURRENT_P95_MS}ms p95"
    echo " Dominant BN  : $DOMINANT_BOTTLENECK"
    echo "======================================================================"
    echo ""

    # ── 1. Backend / API Tier ─────────────────────────────────────────────── #
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│  1. BACKEND / API TIER                       [${backend_priority}]          │"
    echo "├─────────────────────────────────────────────────────────────────┤"
    printf "│  Current replicas : %-3s                                        │\n" "$CURRENT_REPLICAS"
    printf "│  Recommended      : %-3s (scale factor %-4s × current RPS)      │\n" "$needed_replicas" "$sf"
    printf "│  Add replicas     : +%-3s                                       │\n" "$add_replicas"
    echo "├─────────────────────────────────────────────────────────────────┤"
    echo "│  Specific actions:                                              │"
    if (( add_replicas > 0 )); then
      echo "│   • Horizontal: add $add_replicas replica(s) behind load balancer"
      echo "│   • Use rolling deployments (zero-downtime) for updates"
      echo "│   • Configure health-check: GET /api/health with 3s timeout"
    fi
    if (( CPU_SCORE >= 40 )); then
      echo "│   • URGENT: CPU saturated — scale out before optimising"
      echo "│   • Profile with 'cargo flamegraph' to find hot paths"
      echo "│   • Tune Tokio worker threads: TOKIO_WORKER_THREADS=$(nproc 2>/dev/null || echo 4)"
    fi
    if (( NET_SCORE >= 20 )); then
      echo "│   • Enable HTTP/2 in Axum (use rustls TLS)"
      echo "│   • Compress responses with tower-http CompressionLayer"
    fi
    echo "│   • Use 'mimalloc' allocator for ~15% memory savings"
    echo "│   • Set RUST_LOG=warn in production (not debug)"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 2. PostgreSQL ─────────────────────────────────────────────────────── #
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│  2. POSTGRESQL DATABASE                      [${db_priority}]             │"
    echo "├─────────────────────────────────────────────────────────────────┤"
    printf "│  Recommended connection pool  : %-5s connections               │\n" "$db_pool"
    echo "├─────────────────────────────────────────────────────────────────┤"
    echo "│  Specific actions:                                              │"
    if (( DB_SCORE >= 40 )); then
      echo "│   • URGENT: DB is the primary bottleneck"
      echo "│   • Deploy PgBouncer in transaction mode (pgbouncer.ini exists)"
      echo "│   • Set max_connections = $db_pool in postgresql.conf"
      echo "│   • Run: EXPLAIN ANALYZE <slowest query> — target < 100ms"
      echo "│   • Create index: tournaments(status, start_time)"
      echo "│   • Create index: matches(tournament_id, status, created_at)"
      echo "│   • Create index: leaderboard(period, score DESC)"
    elif (( DB_SCORE >= 20 )); then
      echo "│   • DB approaching capacity — add read replica for SELECT-heavy routes"
      echo "│   • Tune SQLx pool: min=5 max=$db_pool idle_timeout=600s"
    else
      echo "│   • DB healthy — review indexes quarterly as data grows"
    fi
    echo "│   • Shard by tournament_id for tournaments > 10k rows"
    echo "│   • Run VACUUM ANALYZE nightly via cron"
    echo "│   • Enable pg_stat_statements for query visibility"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 3. Redis ──────────────────────────────────────────────────────────── #
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│  3. REDIS CACHE / PUB-SUB                    [${redis_priority}]          │"
    echo "├─────────────────────────────────────────────────────────────────┤"
    printf "│  Recommended connection pool  : %-5s per replica               │\n" "$redis_pool"
    echo "├─────────────────────────────────────────────────────────────────┤"
    echo "│  Specific actions:                                              │"
    if (( REDIS_SCORE >= 40 )); then
      echo "│   • URGENT: Redis latency high — check maxmemory eviction policy"
      echo "│   • Deploy Redis Cluster (3 primaries, 3 replicas)"
      echo "│   • Separate keyspaces: leaderboard vs OTP vs session vs pubsub"
      echo "│   • Use RESP3 pipeline for bulk leaderboard updates"
    elif (( REDIS_SCORE >= 20 )); then
      echo "│   • Cache miss rate elevated — review TTL values:"
      echo "│       tournaments: 60s  | leaderboard: 30s | user_profile: 300s"
    else
      echo "│   • Redis healthy — maintain current TTL strategy"
    fi
    echo "│   • Use Redis Sentinel for HA if not using Cluster"
    echo "│   • Set maxmemory-policy = allkeys-lru"
    echo "│   • Monitor with redis-cli --latency-history"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 4. Infrastructure / Cloud ─────────────────────────────────────────── #
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│  4. INFRASTRUCTURE                           [${infra_priority}]            │"
    echo "├─────────────────────────────────────────────────────────────────┤"
    echo "│  Specific actions:                                              │"
    if (( MEM_SCORE >= 40 )); then
      echo "│   • URGENT: Memory pressure — upgrade instance type immediately"
      echo "│   • Minimum recommended: 4 vCPU / 8 GB RAM per backend replica"
    fi
    echo "│   • Load balancer: use least-connections algorithm"
    echo "│   • Enable auto-scaling: scale-out at 70% CPU, scale-in at 30%"
    printf "│   • CDN: cache static assets (S3/MinIO) + cache GET /api/tournaments\n"
    echo "│   • Activate Prometheus alerts (backend/infra/monitoring/)"
    echo "│   • Grafana dashboard: track RPS, p95, DB pool utilisation"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 5. Stellar / Blockchain ───────────────────────────────────────────── #
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│  5. STELLAR BLOCKCHAIN LAYER                 [LOW]              │"
    echo "├─────────────────────────────────────────────────────────────────┤"
    echo "│  Specific actions:                                              │"
    echo "│   • Batch payout submissions: group ≤ 100 ops per Stellar tx"
    echo "│   • Queue payouts via Redis Streams — never block HTTP handlers"
    echo "│   • Cache Stellar account balances (TTL 30s) to reduce Horizon calls"
    echo "│   • Monitor Horizon API rate limits (100 req/s on testnet)"
    echo "│   • Use fee-bump transactions during network congestion"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 6. Priority Action Plan ───────────────────────────────────────────── #
    echo "======================================================================"
    echo " PRIORITY ACTION PLAN"
    echo "======================================================================"
    local p=1
    [[ "$backend_priority" == "HIGH" ]] && { echo "  $p. [IMMEDIATE] Scale backend to $needed_replicas replicas"; (( p++ )) || true; }
    [[ "$db_priority"      == "HIGH" ]] && { echo "  $p. [IMMEDIATE] Resolve DB bottleneck — deploy PgBouncer + add indexes"; (( p++ )) || true; }
    [[ "$redis_priority"   == "HIGH" ]] && { echo "  $p. [IMMEDIATE] Resolve Redis bottleneck — upgrade or deploy Cluster"; (( p++ )) || true; }
    [[ "$infra_priority"   == "HIGH" ]] && { echo "  $p. [IMMEDIATE] Upgrade server memory"; (( p++ )) || true; }
    echo "  $p. [SHORT-TERM] Configure auto-scaling policies"
    (( p++ )) || true
    echo "  $p. [SHORT-TERM] Add Prometheus alerting on p95 > ${TARGET_P95_MS}ms"
    (( p++ )) || true
    echo "  $p. [MEDIUM-TERM] PostgreSQL read replica for GET-heavy endpoints"
    (( p++ )) || true
    echo "  $p. [MEDIUM-TERM] Redis Cluster for high-availability + throughput"
    (( p++ )) || true
    echo "  $p. [LONG-TERM] Evaluate database sharding by tournament_id"
    (( p++ )) || true
    echo "  $p. [LONG-TERM] Stellar payout queue with fan-out worker pool"
    echo ""
    echo "======================================================================"
    echo " END OF SCALING RECOMMENDATIONS"
    echo "======================================================================"
  } | tee "$REPORT_TXT"

  # ── JSON output ───────────────────────────────────────────────────────── #
  if command -v jq &>/dev/null; then
    jq -n \
      --arg ts "$(date -Iseconds)" \
      --argjson target_rps "$TARGET_RPS" \
      --argjson target_p95 "$TARGET_P95_MS" \
      --argjson current_rps "$CURRENT_SAFE_RPS" \
      --argjson current_p95 "$CURRENT_P95_MS" \
      --arg dominant "$DOMINANT_BOTTLENECK" \
      --argjson current_replicas "$CURRENT_REPLICAS" \
      --argjson needed_replicas "$needed_replicas" \
      --argjson db_pool "$db_pool" \
      --argjson redis_pool "$redis_pool" \
      '{
        meta: { generated_at: $ts },
        targets: { rps: $target_rps, p95_ms: $target_p95 },
        current: { rps: $current_rps, p95_ms: $current_p95, replicas: $current_replicas },
        recommendations: {
          replicas_needed: $needed_replicas,
          db_pool_size: $db_pool,
          redis_pool_size: $redis_pool,
          dominant_bottleneck: $dominant
        }
      }' > "$REPORT_JSON"
    ok "JSON written to $REPORT_JSON"
  fi
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
main() {
  echo ""
  echo -e "${BOLD}${CYAN}ArenaX Scaling Recommendations${NC}"
  echo ""
  resolve_files
  extract_metrics
  echo ""
  generate_recommendations
  echo ""
  ok "Scaling recommendations complete."
  echo "  Report : $REPORT_TXT"
  [[ -f "$REPORT_JSON" ]] && echo "  JSON   : $REPORT_JSON"
}

main "$@"
