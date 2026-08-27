# Multi-stage build for the ArenaX Rust backend, used both by local
# docker-compose (bind-mounted for hot reload) and by the zero-downtime
# deployment pipeline (scripts/deploy/blue-green-deploy.sh), which builds
# this image tagged with the release SHA for each blue/green slot.
FROM rust:1.82-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin arenax

WORKDIR /app
COPY --from=builder /app/target/release/arenax-backend /usr/local/bin/arenax-backend
COPY --from=builder /app/migrations ./migrations

USER arenax
EXPOSE 8080

# Used both by `docker compose` health-gated startup and by the
# blue-green deploy script's readiness check before cutting traffic over
# to a new slot.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8080/api/health || exit 1

CMD ["arenax-backend"]
