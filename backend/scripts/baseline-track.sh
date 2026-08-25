#!/usr/bin/env bash
# =============================================================================
# baseline-track.sh — ArenaX Baseline Performance Tracker
# =============================================================================
# Stores, diffs, and reports baseline performance snapshots.
# Supports three sub-commands:
#
#   save   — Capture a new baseline from the latest load-test JSON
#   diff   — Compare the current run against a stored baseline
#   list   — Show all saved baselines
#   report — Print a full regression summary
#
# Baselines are stored as JSON files in BASELINE_DIR indexed by a TAG.
# Each baseline captures: per-endpoint avg_ms, p95_ms, max_ms, fail_rate, rps.
#
# Usage:
#   ./baseline-track.sh save   [OPTIONS]        # Save current run as baseline
#   ./baseline-track.sh diff   [OPTIONS]        # Diff current run vs baseline
#   ./baseline-track.sh list   [OPTIONS]        # List stored baselines
#   ./baseline-track.sh report [OPTIONS]        # Regression report
#
# Options:
#   -f  FILE            Load test JSON to use as current run
#   -d  RESULTS_DIR     Directory to scan for latest results (default: ./capacity_results)
#   -B  BASELINE_DIR    Where baselines are stored (default: ./capacity_results/baselines)
#   -g  TAG             Baseline tag / label (default: git short SHA or "manual")
#   -r  REGRESSION_PCT  % degradation that triggers a FAIL (default: 20)
#   -o  OUTPUT_DIR      Where to write diff reports (default: ./capacity_results)
#   -h                  Show this help
# =============================================================================
set -euo pipefail

# --------------------------------------------------------------------------- #
# Defaults
# --------------------------------------------------------------------------- #
SUBCOMMAND="${1:-help}"
shift 2>/dev/null || true

CURRENT_FILE=""
RESULTS_DIR="./capacity_results"
BASELINE_DIR="./capacity_results/baselines"
TAG=""
REGRESSION_PCT=20
OUTPUT_DIR="./capacity_results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# --------------------------------------------------------------------------- #
# Argument parsing
# --------------------------------------------------------------------------- #
while getopts "f:d:B:g:r:o:h" opt 2>/dev/null; do
  case $opt in
    f) CURRENT_FILE="$OPTARG" ;;
    d) RESULTS_DIR="$OPTARG" ;;
    B) BASELINE_DIR="$OPTARG" ;;
    g) TAG="$OPTARG" ;;
    r) REGRESSION_PCT="$OPTARG" ;;
    o) OUTPUT_DIR="$OPTARG" ;;
    h) SUBCOMMAND="help" ;;
    *) echo "Unknown option -$OPTARG"; exit 1 ;;
  esac
done

# Default tag: git short sha if available
if [[ -z "$TAG" ]]; then
  TAG=$(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo "manual")
fi

mkdir -p "$BASELINE_DIR" "$OUTPUT_DIR"

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✔${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✖${NC} $*"; }

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
require_jq() {
  command -v jq &>/dev/null || { err "jq is required for baseline-track.sh"; exit 1; }
}

resolve_current_file() {
  if [[ -n "$CURRENT_FILE" && -f "$CURRENT_FILE" ]]; then return; fi
  CURRENT_FILE=$(find "$RESULTS_DIR" -maxdepth 1 -name 'load_test_results_*.json' \
    2>/dev/null | sort | tail -1 || true)
  if [[ -z "$CURRENT_FILE" ]]; then
    err "No load_test_results_*.json found in $RESULTS_DIR. Run load-test.sh first."
    exit 1
  fi
}

baseline_file() {
  echo "$BASELINE_DIR/baseline_${1}.json"
}

list_baselines() {
  local files=("$BASELINE_DIR"/baseline_*.json)
  [[ -e "${files[0]}" ]] || { warn "No baselines stored yet."; return; }
  echo ""
  printf "  %-20s %-20s %-15s %s\n" "TAG" "SAVED_AT" "ENDPOINTS" "SOURCE"
  printf "  %-20s %-20s %-15s %s\n" "--------------------" "--------------------" "---------------" "------"
  for f in "${files[@]}"; do
    local tag saved_at endpoints source
    tag=$(jq -r '.meta.tag // "unknown"' "$f" 2>/dev/null)
    saved_at=$(jq -r '.meta.saved_at // "unknown"' "$f" 2>/dev/null)
    endpoints=$(jq '.endpoints | length' "$f" 2>/dev/null || echo "?")
    source=$(jq -r '.meta.source // "-"' "$f" 2>/dev/null | xargs basename 2>/dev/null || echo "-")
    printf "  %-20s %-20s %-15s %s\n" "$tag" "$saved_at" "$endpoints" "$source"
  done
  echo ""
}

# --------------------------------------------------------------------------- #
# SAVE subcommand
# --------------------------------------------------------------------------- #
cmd_save() {
  require_jq
  resolve_current_file
  local dest; dest=$(baseline_file "$TAG")

  log "Saving baseline from: $CURRENT_FILE"
  log "Tag: $TAG → $dest"

  # Extract a compact summary per endpoint
  jq --arg tag "$TAG" --arg ts "$(date -Iseconds)" --arg src "$CURRENT_FILE" '
    {
      meta: { tag: $tag, saved_at: $ts, source: $src },
      endpoints: [
        .endpoints[] | {
          method:       .method,
          endpoint:     .endpoint,
          description:  .description,
          baseline_ms:  .baseline_ms,
          peak_stage: (
            .stages | max_by(.concurrency) | {
              concurrency: .concurrency,
              avg_ms:      .avg_ms,
              p95_ms:      .p95_ms,
              max_ms:      .max_ms,
              fail_rate:   (if .requests > 0 then ((.fail / .requests) * 100) else 0 end),
              rps:         (.rps // 0)
            }
          ),
          safe_stage: (
            .stages | map(select(.p95_ms <= 500)) | last // .[-1] | {
              concurrency: .concurrency,
              avg_ms:      .avg_ms,
              p95_ms:      .p95_ms,
              rps:         (.rps // 0)
            }
          )
        }
      ]
    }
  ' "$CURRENT_FILE" > "$dest"

  ok "Baseline saved: $dest"
  echo ""
  echo "  Endpoints captured:"
  jq -r '.endpoints[] | "    \(.method) \(.endpoint) — safe p95: \(.safe_stage.p95_ms)ms @ \(.safe_stage.concurrency) VUs"' \
    "$dest"
}

# --------------------------------------------------------------------------- #
# DIFF subcommand
# --------------------------------------------------------------------------- #
cmd_diff() {
  require_jq
  resolve_current_file

  # Find the most recent baseline (latest file by name sort)
  local baseline_files=("$BASELINE_DIR"/baseline_*.json)
  local baseline_path=""
  if [[ -e "${baseline_files[0]}" ]]; then
    baseline_path="${baseline_files[-1]}"   # alphabetically last = most recent tag
  fi

  if [[ -z "$baseline_path" || ! -f "$baseline_path" ]]; then
    warn "No baselines found. Run 'save' first."
    exit 0
  fi

  local baseline_tag; baseline_tag=$(jq -r '.meta.tag' "$baseline_path")
  log "Comparing current run ($CURRENT_FILE) against baseline [$baseline_tag]"

  local diff_report="$OUTPUT_DIR/baseline_diff_${TIMESTAMP}.txt"
  local diff_json="$OUTPUT_DIR/baseline_diff_${TIMESTAMP}.json"
  local regressions=0
  local improvements=0

  {
    echo "======================================================================"
    echo " ArenaX — Baseline Performance Diff"
    echo " Generated   : $(date)"
    echo " Baseline    : $baseline_tag ($baseline_path)"
    echo " Current run : $CURRENT_FILE"
    echo " Regression  : >+${REGRESSION_PCT}% p95 degradation = FAIL"
    echo "======================================================================"
    echo ""
    printf "  %-35s  %-8s  %-8s  %-8s  %-8s  %s\n" \
      "Endpoint" "Base p95" "Curr p95" "Delta%" "Base RPS" "Status"
    printf "  %-35s  %-8s  %-8s  %-8s  %-8s  %s\n" \
      "-----------------------------------" "--------" "--------" "--------" "--------" "------"
  } | tee "$diff_report"

  local results_array="[]"

  while IFS= read -r ep_json; do
    local ep method
    ep=$(echo "$ep_json" | jq -r '.endpoint')
    method=$(echo "$ep_json" | jq -r '.method')

    # Current safe p95 for this endpoint
    local curr_p95 curr_rps
    curr_p95=$(jq --arg ep "$ep" --arg m "$method" '
      .endpoints[] | select(.endpoint == $ep and .method == $m) |
      .stages | map(select(.p95_ms > 0)) | last // .[-1] | .p95_ms
    ' "$CURRENT_FILE" 2>/dev/null || echo "0")
    curr_rps=$(jq --arg ep "$ep" --arg m "$method" '
      .endpoints[] | select(.endpoint == $ep and .method == $m) |
      .stages[-1].rps // 0
    ' "$CURRENT_FILE" 2>/dev/null || echo "0")

    local base_p95 base_rps
    base_p95=$(echo "$ep_json" | jq -r '.safe_stage.p95_ms // 0')
    base_rps=$(echo "$ep_json" | jq -r '.safe_stage.rps // 0')

    # Delta percent
    local delta status
    if (( base_p95 > 0 )); then
      delta=$(echo "scale=1; ($curr_p95 - $base_p95) * 100 / $base_p95" | bc 2>/dev/null || echo "0")
    else
      delta="0"
    fi

    local delta_int; delta_int=$(echo "$delta" | awk '{printf "%.0f", $1}')
    if (( delta_int > REGRESSION_PCT )); then
      status="REGRESS"
      (( regressions++ )) || true
    elif (( delta_int < -5 )); then
      status="IMPROVE"
      (( improvements++ )) || true
    else
      status="OK"
    fi

    printf "  %-35s  %-8s  %-8s  %-8s  %-8s  %s\n" \
      "${method} ${ep:0:28}" \
      "${base_p95}ms" \
      "${curr_p95}ms" \
      "${delta}%" \
      "${base_rps}" \
      "$status" | tee -a "$diff_report"

    results_array=$(echo "$results_array" | jq \
      --arg ep "$ep" --arg m "$method" \
      --argjson bp "$base_p95" --argjson cp "$curr_p95" \
      --argjson br "$base_rps" --argjson cr "$curr_rps" \
      --argjson d "$delta" --arg s "$status" \
      '. + [{endpoint: $ep, method: $m, base_p95_ms: $bp, current_p95_ms: $cp,
              base_rps: $br, current_rps: $cr, delta_pct: $d, status: $s}]')

  done < <(jq -c '.endpoints[]' "$baseline_path")

  {
    echo ""
    echo "======================================================================"
    printf "  SUMMARY:  Regressions: %s  |  Improvements: %s\n" "$regressions" "$improvements"
    if (( regressions > 0 )); then
      echo ""
      echo -e "  ${RED}✖ PERFORMANCE REGRESSION DETECTED${NC}"
      echo "  Investigate the endpoints marked REGRESS before deploying."
    else
      echo ""
      echo -e "  ${GREEN}✔ NO REGRESSION DETECTED — performance is within bounds${NC}"
    fi
    echo "======================================================================"
  } | tee -a "$diff_report"

  # JSON output
  echo "$results_array" | jq \
    --arg ts "$(date -Iseconds)" \
    --arg baseline "$baseline_tag" \
    --argjson regressions "$regressions" \
    --argjson improvements "$improvements" \
    '{
      meta: { generated_at: $ts, baseline_tag: $baseline,
              regressions: $regressions, improvements: $improvements },
      results: .
    }' > "$diff_json"

  echo ""
  ok "Diff reports written:"
  echo "  Text : $diff_report"
  echo "  JSON : $diff_json"

  # Non-zero exit when regressions found (useful in CI)
  (( regressions > 0 )) && exit 1 || exit 0
}

# --------------------------------------------------------------------------- #
# REPORT subcommand — full history
# --------------------------------------------------------------------------- #
cmd_report() {
  require_jq
  local baseline_files=("$BASELINE_DIR"/baseline_*.json)
  [[ -e "${baseline_files[0]}" ]] || { warn "No baselines to report on."; exit 0; }

  local report="$OUTPUT_DIR/baseline_history_report_${TIMESTAMP}.txt"
  {
    echo "======================================================================"
    echo " ArenaX — Baseline Performance History"
    echo " Generated : $(date)"
    echo "======================================================================"
    for f in "${baseline_files[@]}"; do
      local tag saved_at
      tag=$(jq -r '.meta.tag' "$f")
      saved_at=$(jq -r '.meta.saved_at' "$f")
      echo ""
      echo "  ── Baseline: $tag ($saved_at) ──"
      jq -r '.endpoints[] |
        "    \(.method) \(.endpoint)"  ,
        "      baseline_ms : \(.baseline_ms)ms",
        "      safe p95    : \(.safe_stage.p95_ms)ms @ \(.safe_stage.concurrency) VUs",
        "      safe RPS    : \(.safe_stage.rps)",
        ""
      ' "$f"
    done
    echo "======================================================================"
    echo " END OF HISTORY REPORT"
    echo "======================================================================"
  } | tee "$report"
  ok "History report written: $report"
}

# --------------------------------------------------------------------------- #
# Help
# --------------------------------------------------------------------------- #
cmd_help() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
}

# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
echo ""
echo -e "${BOLD}${CYAN}ArenaX Baseline Tracker — ${SUBCOMMAND}${NC}"
echo ""

case "$SUBCOMMAND" in
  save)   cmd_save ;;
  diff)   cmd_diff ;;
  list)   list_baselines ;;
  report) cmd_report ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown sub-command: $SUBCOMMAND"
    echo "Valid: save | diff | list | report"
    exit 1
    ;;
esac
