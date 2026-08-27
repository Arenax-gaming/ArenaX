# Multi-stage build for the ArenaX Next.js frontend, used both by local
# docker-compose (bind-mounted for hot reload) and by the zero-downtime
# deployment pipeline (scripts/deploy/blue-green-deploy.sh).
FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin arenax

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js

USER arenax
EXPOSE 3000

# Used both by `docker compose` health-gated startup and by the
# blue-green deploy script's readiness check before cutting traffic over
# to a new slot.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:3000/ || exit 1

CMD ["npm", "run", "start"]
