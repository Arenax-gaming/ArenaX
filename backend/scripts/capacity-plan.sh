#!/usr/bin/env bash
# =============================================================================
# capacity-plan.sh — ArenaX Master Capacity Planning Orchestrator
# =============================================================================
# Runs the full capacity planning pipeline in order:
#
#   1. load-test.sh            — ramp load across all endpoints
#   2. throughput-report.sh    — identify throughput limits per endpoint
#   3. bottleneck-identify.sh  — correlate system metrics to find bottlenecks
#   4. scaling-recommend.sh    — produce scaling recommendations
#   5. baseline-track.sh save  — persist this run as a new baseline
#   6. baseline-track.sh diff  — diff against previous baseline (if any)
#
# All intermediate and final outputs land in RESULTS_DIR.
# A consolidated HTML-friendly Markdown summary is written at the end.
#
# Usage:
#   ./capacity-plan.sh [OPTIONS]
#
# Options:
#   -u  BASE_URL        API base URL            (default: http://localhost:8080)
#   -d  DURATION        Seconds per load stage  (default: 30)
#   -c  MAX_CONCURR     Peak concurrency        (default: 50)
#   -t  TOKEN           Bearer JWT token        (default: "")
#   -D  DB_URL          PostgreSQL URL          (default: $DATABASE_URL)
#   -R  REDIS_URL       Redis URL               (default: redis://localhost:6379)
#   -T  TARGET_RPS      RPS goal for scaling    (default: 500)
#   -L  TARGET_P95      p95 goal in ms          (default: 300)
#   -r  REPLICAS        Current backend count   (default: 1)
#   -o  RESULTS_DIR     Output directory        (default: ./capacity_results)
#   -s  SKIP            Comma-separated steps to skip (load,throughput,bottleneck,scaling,baseline)
#   -h                  Show this help
#
# Examples:
#   # Full run against local dev server
#   ./capacity-plan.sh -u http://localhost:8080
#
#   # Quick run skipping bottleneck (no DB/Redis access)
#   ./capacity-plan.sh -u http://staging.arenax.io -s bottleneck -t "$JWT"
#
#   # Production capacity plan with goals
#   ./capacity-plan.sh -u https://api.arenax.io -T 2000 -L 200 -r 3 -t "$JWT"
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
BASE_URL="http://localhost:8080"
DURATION=30
MAX_CONCURRENCY=50
AUTH_TOKEN=""
DB_URL="${DATABASE_URL:-}"
REDIS_URL="redis://localhost:6379"
TARGET_RPS=500
TARGET_P95=300
CURRENT_REPLICAS=1
RESULTS_DIR="./capacity_results"
SKIP_STEPS=""
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "u:d:c:t:D:R:T:L:r:o:s:h" opt; do
  case $opt in
    u) BASE_URL="$OPTARG" ;;
    d) DURATION="$OPTARG" ;;
    c) MAX_CONCURRENCY="$OPTARG" ;;
    t) AUTH_TOKEN="$OPTARG" ;;
    D) DB_URL="$OPTARG" ;;
    R) REDIS_URL="$OPTARG" ;;
    T) TARGET_RPS="$OPTARG" ;;
    L) TARGET_P95="$OPTARG" ;;
    r) CURRENT_REPLICAS="$OPTARG" ;;
    o) RESULTS_DIR="$OPTARG" ;;
    s) SKIP_STEPS="$OPTARG" ;;
    h)
      sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

mkdir -p "$RESULTS_DIR"
SUMMARY_MD="$RESULTS_DIR/capacity_plan_${TIMESTAMP}.md"
SUMMARY_JSON="$RESULTS_DIR/capacity_plan_${TIMESTAMP}.json"
LOGFILE="$RESULTS_DIR/capacity_plan_${TIMESTAMP}.log"

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
log()     { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOGFILE"; }
ok()      { echo -e "${GREEN}[$(date +%H:%M:%S)] ✔${NC} $*" | tee -a "$LOGFILE"; }
warn()    { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*" | tee -a "$LOGFILE"; }
err()     { echo -e "${RED}[$(date +%H:%M:%S)] ✖${NC} $*" | tee -a "$LOGFILE"; }
section() {
  echo "" | tee -a "$LOGFILE"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOGFILE"
  echo -e "${BOLD}${CYAN}  STEP $1: $2${NC}" | tee -a "$LOGFILE"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOGFILE"
  echo "" | tee -a "$LOGFILE"
}

should_skip() {
  local step="$1"
  echo "$SKIP_STEPS" | tr ',' '\n' | grep -qx "$step"
}

# --------------------------------------------------------------------------- #
# Step executor — runs a sub-script, captures output, records status
# --------------------------------------------------------------------------- #
declare -A STEP_STATUS
declare -A STEP_OUTPUT

run_step() {
  local step_num="$1" step_name="$2"
  shift 2
  local script="$1"; shift

  if should_skip "$step_name"; then
    warn "Skipping step $step_num ($step_name) — in SKIP list"
    STEP_STATUS[$step_name]="SKIPPED"
    STEP_OUTPUT[$step_name]="(skipped)"
    return 0
  fi

  local step_log="$RESULTS_DIR/step_${step_num}_${step_name}_${TIMESTAMP}.log"

  log "Running: $script $*"
  local start_ts; start_ts=$(date +%s)

  if bash "$script" "$@" 2>&1 | tee -a "$LOGFILE" | tee "$step_log"; then
    local elapsed=$(( $(date +%s) - start_ts ))
    STEP_STATUS[$step_name]="OK"
    STEP_OUTPUT[$step_name]="$step_log"
    ok "Step $step_num ($step_name) completed in ${elapsed}s"
  else
    local exit_code=$?
    STEP_STATUS[$step_name]="FAILED(exit=$exit_code)"
    STEP_OUTPUT[$step_name]="$step_log"
    warn "Step $step_num ($step_name) exited with code $exit_code — continuing..."
  fi
}

# --------------------------------------------------------------------------- #
# Find latest file by pattern in RESULTS_DIR
# --------------------------------------------------------------------------- #
latest_file() {
  find "$RESULTS_DIR" -maxdepth 1 -name "$1" 2>/dev/null | sort | tail -1 || true
}

# --------------------------------------------------------------------------- #
# Generate Markdown summary
# --------------------------------------------------------------------------- #
generate_summary() {
  local load_json throughput_json bottleneck_json scaling_json diff_json
  load_json=$(latest_file "load_test_results_*.json")
  throughput_json=$(latest_file "throughput_report_*.json")
  bottleneck_json=$(latest_file "bottleneck_metrics_*.json")
  scaling_json=$(latest_file "scaling_recommendations_*.json")
  diff_json=$(latest_file "baseline_diff_*.json")

  {
    echo "# ArenaX Capacity Planning Report"
    echo ""
    echo "> Generated: $(date)  "
    echo "> Target: \`$BASE_URL\`  "
    echo "> Peak VUs: $MAX_CONCURRENCY | Stage duration: ${DURATION}s  "
    echo "> RPS goal: $TARGET_RPS req/s | p95 goal: ${TARGET_P95}ms  "
    echo ""

    # ── Pipeline status ──────────────────────────────────────────────────── #
    echo "## Pipeline Status"
    echo ""
    echo "| Step | Status |"
    echo "|------|--------|"
    echo "| 1. Load Test        | ${STEP_STATUS[load]:-N/A}        |"
    echo "| 2. Throughput Report | ${STEP_STATUS[throughput]:-N/A}  |"
    echo "| 3. Bottleneck ID    | ${STEP_STATUS[bottleneck]:-N/A}  |"
    echo "| 4. Scaling Recs     | ${STEP_STATUS[scaling]:-N/A}     |"
    echo "| 5. Baseline Save    | ${STEP_STATUS[baseline_save]:-N/A}|"
    echo "| 6. Baseline Diff    | ${STEP_STATUS[baseline_diff]:-N/A}|"
    echo ""

    # ── Load test summary ─────────────────────────────────────────────────── #
    if [[ -n "$load_json" && -f "$load_json" ]] && command -v jq &>/dev/null; then
      echo "## Endpoint Load Test Results"
      echo ""
      echo "| Endpoint | Method | Baseline ms | Peak VUs p95 ms | Peak Fail |"
      echo "|----------|--------|------------|-----------------|-----------|"
      jq -r '.endpoints[] |
        "| \(.endpoint) | \(.method) | \(.baseline_ms)ms | \(.stages[-1].p95_ms)ms | \(.stages[-1].fail) |"
      ' "$load_json"
      echo ""
    fi

    # ── Throughput limits ─────────────────────────────────────────────────── #
    if [[ -n "$throughput_json" && -f "$throughput_json" ]] && command -v jq &>/dev/null; then
      echo "## Throughput Limits"
      echo ""
      echo "| Endpoint | Safe VUs | Safe p95 | Safe RPS | Breaks At |"
      echo "|----------|----------|----------|----------|-----------|"
      jq -r '.endpoints[] |
        "| \(.endpoint) | \(.safe_concurrency) | \(.safe_p95_ms)ms | \(.safe_rps) | \(.break_concurrency // "never") VUs |"
      ' "$throughput_json"
      echo ""
    fi

    # ── Bottleneck ────────────────────────────────────────────────────────── #
    if [[ -n "$bottleneck_json" && -f "$bottleneck_json" ]] && command -v jq &>/dev/null; then
      local dominant cpu_score mem_score db_score redis_score net_score
      dominant=$(jq -r '.dominant_bottleneck' "$bottleneck_json")
      cpu_score=$(jq '.scores.CPU' "$bottleneck_json")
      mem_score=$(jq '.scores.MEMORY' "$bottleneck_json")
      db_score=$(jq '.scores.DATABASE' "$bottleneck_json")
      redis_score=$(jq '.scores.REDIS' "$bottleneck_json")
      net_score=$(jq '.scores.NETWORK' "$bottleneck_json")
      echo "## Bottleneck Analysis"
      echo ""
      echo "**Dominant bottleneck: \`$dominant\`**"
      echo ""
      echo "| Tier | Score (0–80+) |"
      echo "|------|--------------|"
      echo "| CPU      | $cpu_score |"
      echo "| Memory   | $mem_score |"
      echo "| Database | $db_score  |"
      echo "| Redis    | $redis_score |"
      echo "| Network  | $net_score |"
      echo ""
    fi

    # ── Scaling ───────────────────────────────────────────────────────────── #
    if [[ -n "$scaling_json" && -f "$scaling_json" ]] && command -v jq &>/dev/null; then
      local needed_replicas db_pool redis_pool
      needed_replicas=$(jq '.recommendations.replicas_needed' "$scaling_json")
      db_pool=$(jq '.recommendations.db_pool_size' "$scaling_json")
      redis_pool=$(jq '.recommendations.redis_pool_size' "$scaling_json")
      echo "## Scaling Recommendations (Summary)"
      echo ""
      echo "| Resource | Current | Recommended |"
      echo "|----------|---------|-------------|"
      echo "| Backend replicas | $CURRENT_REPLICAS | $needed_replicas |"
      echo "| DB pool size     | —       | $db_pool        |"
      echo "| Redis pool/node  | —       | $redis_pool     |"
      echo ""
      echo "> See \`scaling_recommendations_${TIMESTAMP}.txt\` for full action plan."
      echo ""
    fi

    # ── Baseline diff ─────────────────────────────────────────────────────── #
    if [[ -n "$diff_json" && -f "$diff_json" ]] && command -v jq &>/dev/null; then
      local regressions improvements
      regressions=$(jq '.meta.regressions' "$diff_json")
      improvements=$(jq '.meta.improvements' "$diff_json")
      echo "## Baseline Diff"
      echo ""
      if (( regressions > 0 )); then
        echo "> ⚠️  **$regressions regression(s) detected vs previous baseline.**"
      else
        echo "> ✅ No regressions detected vs previous baseline."
      fi
      echo "> Improvements: $improvements"
      echo ""
      echo "| Endpoint | Base p95 | Curr p95 | Delta% | Status |"
      echo "|----------|----------|----------|--------|--------|"
      jq -r '.results[] | "| \(.method) \(.endpoint) | \(.base_p95_ms)ms | \(.current_p95_ms)ms | \(.delta_pct)% | \(.status) |"' \
        "$diff_json"
      echo ""
    fi

    # ── File index ───────────────────────────────────────────────────────── #
    echo "## Output Files"
    echo ""
    echo "| File | Description |"
    echo "|------|-------------|"
    echo "| \`load_test_results_${TIMESTAMP}.json\` | Raw load test data |"
    echo "| \`throughput_report_${TIMESTAMP}.json\` | Throughput limits per endpoint |"
    echo "| \`throughput_report_${TIMESTAMP}.txt\`  | Human-readable throughput report |"
    echo "| \`bottleneck_metrics_${TIMESTAMP}.json\` | Bottleneck scores |"
    echo "| \`bottleneck_report_${TIMESTAMP}.txt\`  | Bottleneck narrative |"
    echo "| \`scaling_recommendations_${TIMESTAMP}.json\` | Scaling recs (machine) |"
    echo "| \`scaling_recommendations_${TIMESTAMP}.txt\`  | Scaling recs (human) |"
    echo "| \`baseline_diff_${TIMESTAMP}.json\` | Regression diff vs last baseline |"
    echo "| \`capacity_plan_${TIMESTAMP}.md\`   | This summary |"
    echo ""
    echo "---"
    echo "*ArenaX capacity-plan.sh — $(date -Iseconds)*"

  } > "$SUMMARY_MD"

  ok "Markdown summary: $SUMMARY_MD"
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
main() {
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║  ArenaX Capacity Planning — Full Pipeline            ║${NC}"
  echo -e "${BOLD}${GREEN}║  $(date +%Y-%m-%d\ %H:%M:%S)                                    ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Base URL    : $BASE_URL"
  echo "  Peak VUs    : $MAX_CONCURRENCY"
  echo "  Stage secs  : $DURATION"
  echo "  RPS target  : $TARGET_RPS"
  echo "  p95 target  : ${TARGET_P95}ms"
  echo "  Replicas    : $CURRENT_REPLICAS"
  echo "  Results dir : $RESULTS_DIR"
  [[ -n "$SKIP_STEPS" ]] && echo "  Skipping    : $SKIP_STEPS"
  echo "" | tee -a "$LOGFILE"

  local auth_args=()
  [[ -n "$AUTH_TOKEN" ]] && auth_args+=("-t" "$AUTH_TOKEN")
  local db_args=()
  [[ -n "$DB_URL" ]] && db_args+=("-D" "$DB_URL")

  # ── Step 1: Load test ─────────────────────────────────────────────────── #
  section "1" "Load Test"
  run_step 1 "load" \
    "$SCRIPT_DIR/load-test.sh" \
    -u "$BASE_URL" \
    -d "$DURATION" \
    -c "$MAX_CONCURRENCY" \
    -o "$RESULTS_DIR" \
    "${auth_args[@]}"

  # ── Step 2: Throughput report ─────────────────────────────────────────── #
  section "2" "Throughput Report"
  local load_json; load_json=$(latest_file "load_test_results_*.json")
  local throughput_args=("-d" "$RESULTS_DIR" "-o" "$RESULTS_DIR")
  [[ -n "$load_json" ]] && throughput_args=("-f" "$load_json" "-o" "$RESULTS_DIR")

  run_step 2 "throughput" \
    "$SCRIPT_DIR/throughput-report.sh" \
    "${throughput_args[@]}"

  # ── Step 3: Bottleneck identification ─────────────────────────────────── #
  section "3" "Bottleneck Identification"
  run_step 3 "bottleneck" \
    "$SCRIPT_DIR/bottleneck-identify.sh" \
    -u "$BASE_URL" \
    -d "$DURATION" \
    -c "$MAX_CONCURRENCY" \
    -R "$REDIS_URL" \
    -o "$RESULTS_DIR" \
    "${auth_args[@]}" \
    "${db_args[@]}"

  # ── Step 4: Scaling recommendations ──────────────────────────────────── #
  section "4" "Scaling Recommendations"
  local latest_load latest_bn
  latest_load=$(latest_file "load_test_results_*.json")
  latest_bn=$(latest_file "bottleneck_metrics_*.json")

  local scaling_args=("-d" "$RESULTS_DIR" "-o" "$RESULTS_DIR" "-T" "$TARGET_RPS" "-L" "$TARGET_P95" "-U" "$CURRENT_REPLICAS")
  [[ -n "$latest_load" ]] && scaling_args+=("-l" "$latest_load")
  [[ -n "$latest_bn"   ]] && scaling_args+=("-b" "$latest_bn")

  run_step 4 "scaling" \
    "$SCRIPT_DIR/scaling-recommend.sh" \
    "${scaling_args[@]}"

  # ── Step 5: Save baseline ─────────────────────────────────────────────── #
  section "5" "Save Baseline"
  local git_tag
  git_tag=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo "manual")

  run_step 5 "baseline_save" \
    "$SCRIPT_DIR/baseline-track.sh" \
    "save" \
    -d "$RESULTS_DIR" \
    -B "$RESULTS_DIR/baselines" \
    -g "$git_tag" \
    -o "$RESULTS_DIR"

  # ── Step 6: Diff baseline ─────────────────────────────────────────────── #
  section "6" "Baseline Diff"
  local current_load; current_load=$(latest_file "load_test_results_*.json")

  run_step 6 "baseline_diff" \
    "$SCRIPT_DIR/baseline-track.sh" \
    "diff" \
    -f "${current_load:-}" \
    -d "$RESULTS_DIR" \
    -B "$RESULTS_DIR/baselines" \
    -r "$((REGRESSION_PCT=${REGRESSION_PCT:-20}))" \
    -o "$RESULTS_DIR" || true  # diff exits 1 on regressions — don't abort pipeline

  # ── Final summary ─────────────────────────────────────────────────────── #
  section "7" "Summary"
  generate_summary

  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║  Capacity Planning Complete                          ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Pipeline results:"
  for step in load throughput bottleneck scaling baseline_save baseline_diff; do
    local status="${STEP_STATUS[$step]:-N/A}"
    local icon="✔"
    [[ "$status" == *FAILED* ]] && icon="✖"
    [[ "$status" == "SKIPPED" ]] && icon="⏭"
    printf "    %-15s  %s  %s\n" "$step" "$icon" "$status"
  done
  echo ""
  echo "  Full report : $SUMMARY_MD"
  echo "  All outputs : $RESULTS_DIR/"
  echo "  Log         : $LOGFILE"
  echo ""
}

main "$@"
