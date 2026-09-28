#!/usr/bin/env bash
#
# Run TLC over every spec in this directory (Issue #879).
#
# Downloads tla2tools.jar on first use rather than vendoring a 10MB binary
# into the repo. Set TLA_TOOLS to point at an existing copy to skip that.
#
# Usage:
#   ./verify.sh              # check every spec
#   ./verify.sh AxToken      # check one
#
# Exit status is non-zero if any spec fails, so this is usable as a CI gate.

set -uo pipefail

SPEC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TLA_TOOLS="${TLA_TOOLS:-$SPEC_DIR/tla2tools.jar}"
TLA_URL="https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar"

if ! command -v java >/dev/null 2>&1; then
    echo "error: java is required to run TLC (install a JRE, or set TLA_TOOLS)" >&2
    exit 2
fi

if [[ ! -f "$TLA_TOOLS" ]]; then
    echo "Fetching tla2tools.jar..."
    if ! curl -fsSL -o "$TLA_TOOLS" "$TLA_URL"; then
        echo "error: could not download tla2tools.jar from $TLA_URL" >&2
        echo "       download it manually and set TLA_TOOLS to its path" >&2
        exit 2
    fi
fi

if [[ $# -gt 0 ]]; then
    specs=("$SPEC_DIR/$1.tla")
else
    specs=("$SPEC_DIR"/*.tla)
fi

failed=0
for spec in "${specs[@]}"; do
    name="$(basename "$spec" .tla)"
    cfg="$SPEC_DIR/$name.cfg"

    if [[ ! -f "$cfg" ]]; then
        echo "skip: $name has no .cfg"
        continue
    fi

    echo "=== Checking $name ==="
    # -deadlock: these are reactive specs with no terminal state, so a state
    # with no successors is a modelling error worth reporting, not a stall.
    if java -XX:+UseParallelGC -cp "$TLA_TOOLS" tlc2.TLC \
            -config "$cfg" -workers auto -deadlock "$spec"; then
        echo "PASS: $name"
    else
        echo "FAIL: $name"
        failed=1
    fi
    echo
done

if [[ $failed -ne 0 ]]; then
    echo "One or more specifications failed verification."
    exit 1
fi

echo "All specifications verified."
