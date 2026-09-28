#!/usr/bin/env bash
# Renders deploy/nginx/upstream.conf for a given traffic split and
# reloads nginx (graceful — no dropped connections, no downtime).
#
# Usage:
#   render-upstream.sh <primary_color> [<canary_color> <canary_weight_percent>]
#
# Examples:
#   render-upstream.sh blue                 # 100% blue
#   render-upstream.sh blue green 10        # 90% blue / 10% green canary
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

primary_color="$1"
canary_color="${2:-}"
canary_weight="${3:-0}"

upstream_conf="deploy/nginx/upstream.conf"

if [ -n "$canary_color" ] && [ "$canary_weight" -gt 0 ] && [ "$canary_weight" -lt 100 ]; then
  primary_weight=$((100 - canary_weight))
  cat > "$upstream_conf" <<EOF
# Rendered by render-upstream.sh — canary split: ${primary_weight}% ${primary_color} / ${canary_weight}% ${canary_color}
upstream backend_upstream {
    server backend-${primary_color}:8080 weight=${primary_weight};
    server backend-${canary_color}:8080 weight=${canary_weight};
}

upstream frontend_upstream {
    server frontend-${primary_color}:3000 weight=${primary_weight};
    server frontend-${canary_color}:3000 weight=${canary_weight};
}
EOF
else
  cat > "$upstream_conf" <<EOF
# Rendered by render-upstream.sh — ${primary_color} at 100%
upstream backend_upstream {
    server backend-${primary_color}:8080;
}

upstream frontend_upstream {
    server frontend-${primary_color}:3000;
}
EOF
fi

echo "Wrote $upstream_conf:"
cat "$upstream_conf"

if docker compose -f deploy/docker-compose.deploy.yml exec -T nginx nginx -s reload 2>/dev/null; then
  echo "nginx reloaded"
else
  echo "nginx not running yet (or reload failed) — will pick up config on next start" >&2
fi
