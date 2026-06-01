#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/migrations}"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Migration directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

declare -A up_versions=()
declare -A down_versions=()

while IFS= read -r -d '' file; do
  name="$(basename "$file")"

  if [[ ! "$name" =~ ^[0-9]{14}_[a-z0-9_]+\.(up|down)\.sql$ ]]; then
    echo "Invalid migration filename: $name" >&2
    echo "Expected: <14 digit timestamp>_<snake_case_name>.(up|down).sql" >&2
    exit 1
  fi

  version="${name%%_*}"
  direction="${name##*.}"
  direction="${name%.*}"
  direction="${direction##*.}"

  if [ "$direction" = "up" ]; then
    if [ -n "${up_versions[$version]:-}" ]; then
      echo "Duplicate up migration version: $version" >&2
      exit 1
    fi
    up_versions[$version]="$name"
  else
    if [ -n "${down_versions[$version]:-}" ]; then
      echo "Duplicate down migration version: $version" >&2
      exit 1
    fi
    down_versions[$version]="$name"
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -print0)

for version in "${!up_versions[@]}"; do
  if [ -z "${down_versions[$version]:-}" ]; then
    echo "Missing down migration for ${up_versions[$version]}" >&2
    exit 1
  fi
done

for version in "${!down_versions[@]}"; do
  if [ -z "${up_versions[$version]:-}" ]; then
    echo "Missing up migration for ${down_versions[$version]}" >&2
    exit 1
  fi
done

echo "Verified ${#up_versions[@]} backend migration pair(s) in $MIGRATIONS_DIR"
