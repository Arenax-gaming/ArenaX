#!/usr/bin/env bash
# =============================================================================
# throughput-report.sh — ArenaX Throughput Limits Report Generator
# =============================================================================
# Parses JSON results produced by load-test.sh (or capacity-plan.sh) and
# emits a rich, human-readable throughput limits report.
#
# Usage:
#   ./throughput-report.sh [OPTIONS] [RESULTS_JSON]
#
# Options:
#   -f  FILE          Specific results JSON to parse
#   -d  RESULTS_DIR   Directory to scan for latest results (default: ./capacity_results)
#   -o  OUTPUT_DIR    Where to write the report (default: ./capacity_results)
#   -p  P95_LIMIT_MS  p95 latency threshold in ms that marks a limit (default: 500)
#   -e  ERR_RATE      Error rate % that marks a limit              (default: 1)
#   -h                Show this help
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
RESULTS_DIR="./capacity_results"
OUTPUT_DIR="./capacity_results"
P95_LIMIT_MS=500
ERR_RATE_LIMIT=1
INPUT_FILE=""
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "f:d:o:p:e:h" opt; do
  case $opt in
    f) INPUT_FILE="$OPTARG" ;;
    d) RESULTS_DIR="$OPTARG" ;;
    o) OUTPUT_DIR="$OPTARG" ;;
    p) P95_LIMIT_MS="$OPTARG" ;;
    e) ERR_RATE_LIMIT="$OPTARG" ;;
    h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

# --------------------------------------------------------------------------- #
# Resolve input file
# --------------------------------------------------------------------------- #
resolve_input() {
  if [[ -n "$INPUT_FILE" && -f "$INPUT_FILE" ]]; then
    echo "$INPUT_FILE"
    return
  fi
  # Find the most recent load_test_results_*.json in RESULTS_DIR
  local latest
  latest=$(find "$RESULTS_DIR" -maxdepth 1 -name 'load_test_results_*.json' \
    2>/dev/null | sort | tail -1)
  if [[ -z "$latest" ]]; then
    echo -e "${RED}No results JSON found in $RESULTS_DIR${NC}" >&2
    echo -e "Run load-test.sh first, or pass -f <file>" >&2
    exit 1
  fi
  echo "$latest"
}

# --------------------------------------------------------------------------- #
# Require jq
# --------------------------------------------------------------------------- #
require_jq() {
  if ! command -v jq &>/dev/null; then
    echo -e "${RED}jq is required for throughput-report.sh. Install it and retry.${NC}" >&2
    exit 1
  fi
}

# --------------------------------------------------------------------------- #
# Helper: rate badge
# --------------------------------------------------------------------------- #
status_badge() {
  local val="$1" limit="$2"  # numeric comparison
  if (( $(echo "$val <= $limit" | bc -l) )); then
    echo -e "${GREEN}✔ PASS${NC}"
  else
    echo -e "${RED}✖ BREACH${NC}"
  fi
}

# --------------------------------------------------------------------------- #
# Parse and render the report
# --------------------------------------------------------------------------- #
generate_report() {
  local json="$1"
  local report_txt="$OUTPUT_DIR/throughput_report_${TIMESTAMP}.txt"
  local report_json="$OUTPUT_DIR/throughput_report_${TIMESTAMP}.json"
  mkdir -p "$OUTPUT_DIR"

  # ── Read meta ──────────────────────────────────────────────────────────── #
  local base_url peak_vus gen_ts
  base_url=$(jq -r '.meta.base_url // "unknown"' "$json")
  peak_vus=$(jq -r '.meta.max_concurrency // "unknown"' "$json")
  gen_ts=$(jq -r '.meta.timestamp // "unknown"' "$json")

  # ── Build summary records ──────────────────────────────────────────────── #
  # For each endpoint find the max concurrency stage that stays under threshold
  local summary_json
  summary_json=$(jq --argjson p95_limit "$P95_LIMIT_MS" --argjson err_limit "$ERR_RATE_LIMIT" '
    [ .endpoints[] |
      .method as $m | .endpoint as $ep | .description as $desc |
      .stages as $stages |
      # Find safe capacity: last stage where p95 < limit AND fail_rate < err_limit
      ( $stages | map(
          . + {
            fail_rate: (if .requests > 0 then ((.fail / .requests) * 100) else 0 end)
          }
        ) | map(
          select(.p95_ms <= $p95_limit and .fail_rate <= $err_limit)
        ) | last // null
      ) as $safe_stage |
      # Find breaking point: first stage that breaches
      ( $stages | map(
          . + {
            fail_rate: (if .requests > 0 then ((.fail / .requests) * 100) else 0 end)
          }
        ) | map(
          select(.p95_ms > $p95_limit or .fail_rate > $err_limit)
        ) | first // null
      ) as $break_stage |
      {
        method: $m,
        endpoint: $ep,
        description: $desc,
        baseline_ms: .baseline_ms,
        safe_concurrency: ($safe_stage.concurrency // 0),
        safe_avg_ms:      ($safe_stage.avg_ms // 0),
        safe_p95_ms:      ($safe_stage.p95_ms // 0),
        safe_rps:         ($safe_stage.rps // 0),
        break_concurrency: ($break_stage.concurrency // null),
        break_p95_ms:      ($break_stage.p95_ms // null),
        break_fail_rate:   ($break_stage.fail_rate // null),
        all_stages: ($stages | map(
          . + {
            fail_rate: (if .requests > 0 then ((.fail / .requests) * 100) else 0 end),
            p95_breach: (.p95_ms > $p95_limit)
          }
        ))
      }
    ]
  ' "$json")

  # ── Throughput limits report ───────────────────────────────────────────── #
  {
    echo "=================================================================="
    echo " ArenaX — Throughput Limits Report"
    echo " Generated : $(date)"
    echo " Source    : $json"
    echo " Target    : $base_url"
    echo " Peak VUs  : $peak_vus"
    echo " p95 limit : ${P95_LIMIT_MS}ms"
    echo " Err limit : ${ERR_RATE_LIMIT}%"
    echo "=================================================================="
    echo ""

    # ── Per-endpoint section ─────────────────────────────────────────────── #
    echo "ENDPOINT THROUGHPUT LIMITS"
    echo "──────────────────────────────────────────────────────────────────"

    while IFS= read -r ep_json; do
      local method ep desc baseline safe_conc safe_avg safe_p95 safe_rps break_conc break_p95 break_fail
      method=$(echo "$ep_json" | jq -r '.method')
      ep=$(echo "$ep_json" | jq -r '.endpoint')
      desc=$(echo "$ep_json" | jq -r '.description')
      baseline=$(echo "$ep_json" | jq -r '.baseline_ms')
      safe_conc=$(echo "$ep_json" | jq -r '.safe_concurrency')
      safe_avg=$(echo "$ep_json" | jq -r '.safe_avg_ms')
      safe_p95=$(echo "$ep_json" | jq -r '.safe_p95_ms')
      safe_rps=$(echo "$ep_json" | jq -r '.safe_rps')
      break_conc=$(echo "$ep_json" | jq -r '.break_concurrency // "N/A (never breached)"')
      break_p95=$(echo "$ep_json" | jq -r '.break_p95_ms // "—"')
      break_fail=$(echo "$ep_json" | jq -r '.break_fail_rate // "—"')

      printf "  %-6s %s\n" "$method" "$ep"
      printf "    Description  : %s\n" "$desc"
      printf "    Baseline     : %sms\n" "$baseline"
      printf "    Safe cap.    : %s VUs | avg %sms | p95 %sms | %s RPS\n" \
        "$safe_conc" "$safe_avg" "$safe_p95" "$safe_rps"
      printf "    Break point  : %s VUs (p95=%s ms, err_rate=%s%%)\n" \
        "$break_conc" "$break_p95" "$break_fail"
      echo ""

      # Stage table
      printf "    %-6s %-8s %-8s %-8s %-8s %-12s %-6s\n" \
        "VUs" "Reqs" "Success" "Avg(ms)" "p95(ms)" "RPS" "Status"
      printf "    %-6s %-8s %-8s %-8s %-8s %-12s %-6s\n" \
        "------" "--------" "--------" "--------" "--------" "------------" "------"
      echo "$ep_json" | jq -r '.all_stages[] |
        "\(.concurrency) \(.requests) \(.success) \(.avg_ms) \(.p95_ms) \(.rps) \(.p95_breach)"
      ' | while read -r vu req succ avg p95 rps breach; do
        local status_icon="✔"
        [[ "$breach" == "true" ]] && status_icon="✖"
        printf "    %-6s %-8s %-8s %-8s %-8s %-12s %-6s\n" \
          "$vu" "$req" "$succ" "$avg" "$p95" "$rps" "$status_icon"
      done
      echo "  ──────────────────────────────────────────────────────────────"
      echo ""
    done < <(echo "$summary_json" | jq -c '.[]')

    # ── System-wide throughput summary ───────────────────────────────────── #
    echo ""
    echo "SYSTEM-WIDE THROUGHPUT SUMMARY"
    echo "──────────────────────────────────────────────────────────────────"
    local min_safe max_safe total_rps
    min_safe=$(echo "$summary_json" | jq '[.[].safe_concurrency] | min')
    max_safe=$(echo "$summary_json" | jq '[.[].safe_concurrency] | max')
    total_rps=$(echo "$summary_json" | jq '[.[].safe_rps | tonumber] | add | ceil')

    printf "  Safest single-endpoint capacity : %s concurrent users\n" "$min_safe"
    printf "  Highest safe capacity endpoint  : %s concurrent users\n" "$max_safe"
    printf "  Aggregate throughput (safe RPS) : %s req/s\n" "$total_rps"
    printf "  p95 latency SLA                 : %sms\n" "$P95_LIMIT_MS"
    printf "  Error rate SLA                  : %s%%\n" "$ERR_RATE_LIMIT"
    echo ""

    # ── Weakest link ─────────────────────────────────────────────────────── #
    echo "BOTTLENECK ENDPOINTS (lowest safe capacity)"
    echo "──────────────────────────────────────────────────────────────────"
    echo "$summary_json" | jq -r 'sort_by(.safe_concurrency) | .[:3][] |
      "  \(.method) \(.endpoint) — safe up to \(.safe_concurrency) VUs (p95: \(.safe_p95_ms)ms)"
    '
    echo ""

    echo "=================================================================="
    echo " END OF THROUGHPUT LIMITS REPORT"
    echo "=================================================================="
  } | tee "$report_txt"

  # Write machine-readable summary JSON
  echo "$summary_json" | jq --arg ts "$(date -Iseconds)" \
    --arg src "$json" \
    --argjson p95_limit "$P95_LIMIT_MS" \
    --argjson err_limit "$ERR_RATE_LIMIT" \
    '{
      meta: { generated_at: $ts, source: $src, p95_limit_ms: $p95_limit, err_rate_limit_pct: $err_limit },
      endpoints: .
    }' > "$report_json"

  echo ""
  echo -e "${GREEN}Reports written:${NC}"
  echo "  Text : $report_txt"
  echo "  JSON : $report_json"
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
main() {
  echo ""
  echo -e "${BOLD}${CYAN}ArenaX Throughput Report Generator${NC}"
  echo ""
  require_jq
  local input
  input=$(resolve_input)
  echo -e "Parsing: ${BLUE}$input${NC}"
  echo ""
  generate_report "$input"
}

main "$@"
