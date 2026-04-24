# Deployment & Configuration Guide

## Required Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:password@host:5432/arenax

# Redis
REDIS_URL=redis://host:6379

# Object Storage (S3-compatible)
S3_ENDPOINT=https://s3.amazonaws.com
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET=arenax-assets

# Payment Providers
PAYSTACK_SECRET=sk_live_...
FLUTTERWAVE_SECRET=FLWSECK_TEST-...

# JWT
JWT_SECRET=<minimum-32-char-random-string>
JWT_EXPIRES_IN=15m

# Stellar / Soroban
STELLAR_NETWORK_URL=https://horizon.stellar.org
STELLAR_ADMIN_SECRET=S...
SOROBAN_CONTRACT_PRIZE=C...
SOROBAN_CONTRACT_REPUTATION=C...
SOROBAN_CONTRACT_ARENAX_TOKEN=C...

# AI
AI_MODEL_PATH=/models/anti-cheat.onnx

# Server
HOST=0.0.0.0
PORT=8080
RUST_LOG=info

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60
```

## Database Migrations

Run migrations in order before starting the server:

```bash
# Using sqlx-cli
sqlx migrate run --database-url $DATABASE_URL
```

Migration files are in `backend/migrations/`. They are numbered and must be applied sequentially.

## Running the Server

```bash
cd backend
cargo build --release
./target/release/arenax-backend
```

Or with Docker:

```dockerfile
FROM rust:1.77 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/arenax-backend /usr/local/bin/
CMD ["arenax-backend"]
```

## Health Check

```http
GET /api/health
```

Returns `200 OK` when the service is ready. Use this for load balancer and container orchestration health probes.

## Serving the API Documentation

The `docs/api/` directory contains a static Swagger UI. Serve it with any static file server:

```bash
# Python (quick local preview)
python3 -m http.server 3000 --directory docs/api

# nginx
server {
  listen 80;
  root /var/www/arenax-docs;
  location / { try_files $uri $uri/ =404; }
}
```

Then open `http://localhost:3000` to browse the interactive docs.

## Scaling Considerations

- The matchmaker worker and tournament orchestrator run as background tasks within the server process. In a multi-instance deployment, use Redis-based distributed locking to prevent duplicate processing.
- WebSocket sessions are tracked in-memory per instance. Use a Redis-backed session registry for horizontal scaling.
- The idempotency layer uses PostgreSQL — ensure the `idempotency_keys` table is indexed on `(key, expires_at)`.
