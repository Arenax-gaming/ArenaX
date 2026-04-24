# Idempotency Guide

ArenaX implements idempotency for all mutating financial and game-state operations to prevent duplicate side effects from retried requests.

## How It Works

1. Client generates a UUID and sends it in the `Idempotency-Key` header.
2. Server hashes the request (method + path + headers + body) and stores it alongside the key.
3. If the same key is replayed within 24 hours with an **identical** request, the cached response is returned immediately — no re-execution.
4. If the same key is replayed with a **different** request, a `409 Conflict` is returned.

## Enabled Routes

| Route | Notes |
|-------|-------|
| `POST /api/payments/create` | Payment initiation |
| `POST /api/payments/refund` | Refund requests |
| `POST /api/wallets/deposit` | Wallet top-up |
| `POST /api/wallets/withdraw` | Withdrawal |
| `POST /api/tournaments/join` | Tournament registration |
| `POST /api/matchmaking/join` | Queue entry |

## Using Idempotency Keys

Always generate a fresh UUID per logical operation:

```http
POST /api/matchmaking/join
Authorization: Bearer <token>
Idempotency-Key: 7f3d9a2b-1c4e-4f8a-9b0d-2e5f6a7c8d9e
Content-Type: application/json

{ "game": "chess", "game_mode": "ranked" }
```

On a cached hit, the response includes:
```
X-Idempotency-Cached: true
```

## Key Lifecycle

- TTL: **24 hours** (configurable)
- Max cached response size: **1 MB**
- Keys are scoped to the authenticated user — the same UUID used by two different users is treated as two separate keys.

## Conflict Types

| Type | Meaning |
|------|---------|
| `PayloadMismatch` | Same key, different request body |
| `MethodMismatch` | Same key, different HTTP method |
| `RouteMismatch` | Same key, different endpoint |
| `UserMismatch` | Same key, different user |

## Managing Keys via API

```http
# Generate a server-side key
POST /api/idempotency/generate-key

# List your active keys
GET /api/idempotency/user-keys

# Invalidate a key early
DELETE /api/idempotency/invalidate/{key}

# Framework info (public)
GET /api/idempotency/info
```

## Best Practices

- Generate a new UUID for each distinct user action — never reuse keys across different operations.
- Store the key alongside the pending operation in your client state so you can replay it on network failure.
- If you receive a `409 PayloadMismatch`, it means you accidentally reused a key — generate a new one.
- Keys are automatically cleaned up after TTL expiry; you don't need to delete them manually.
