# Error Handling Guide

## Error Response Format

All errors follow a consistent JSON envelope:

```json
{
  "error": "Human-readable message",
  "code": 400,
  "details": "Additional context (may be null)"
}
```

## HTTP Status Codes

| Code | Type | When it occurs |
|------|------|----------------|
| 400 | Bad Request | Invalid input, missing required fields, validation failure |
| 401 | Unauthorized | Missing/expired/invalid JWT token |
| 403 | Forbidden | Valid token but insufficient permissions (e.g. non-admin hitting admin route) |
| 404 | Not Found | Resource doesn't exist or doesn't belong to the requesting user |
| 409 | Conflict | Duplicate resource, idempotency key conflict, invalid state transition |
| 422 | Unprocessable | Semantic validation failure (e.g. ELO range invalid) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server error, database failure, blockchain error |

## Common Error Scenarios

### Authentication Errors

```json
// Missing header
{ "error": "Missing authorization header", "code": 401 }

// Expired token
{ "error": "Token expired", "code": 401 }

// Revoked token
{ "error": "Token has been revoked", "code": 403 }

// Session gone (e.g. revoke-sessions was called)
{ "error": "Session expired or invalid", "code": 401 }
```

**Fix**: Refresh the access token via `POST /api/auth/refresh`. If the refresh token is also expired, re-authenticate.

---

### Validation Errors

```json
{
  "error": "Bad request: username must be between 3 and 50 characters",
  "code": 400,
  "details": "Bad request: username must be between 3 and 50 characters"
}
```

Stellar address validation (match creation):
```json
{
  "error": "Bad request: player_a must be exactly 56 characters",
  "code": 400
}
```

---

### Idempotency Conflicts (409)

When you replay an `Idempotency-Key` with a **different** request body:

```json
{
  "error": "Conflict: idempotency key already used with different payload",
  "code": 409,
  "details": "PayloadMismatch"
}
```

Conflict types:
- `PayloadMismatch` — same key, different body
- `MethodMismatch` — same key, different HTTP method
- `RouteMismatch` — same key, different endpoint
- `UserMismatch` — same key, different authenticated user

**Fix**: Generate a new idempotency key for a genuinely new request.

---

### Match State Transition Errors

```json
{
  "error": "Conflict: invalid state transition from FINALIZED",
  "code": 409
}
```

Valid transitions:
```
CREATED → STARTED → COMPLETED → DISPUTED → FINALIZED
                              ↘ FINALIZED
```

---

### Rate Limiting (429)

```json
{
  "error": "Too many requests: rate limit exceeded",
  "code": 429
}
```

The response includes a `Retry-After` header (seconds). Back off and retry after that interval.

---

### Blockchain / Stellar Errors (500)

```json
{
  "error": "Blockchain error",
  "code": 500,
  "details": "Transaction submission failed: insufficient fee"
}
```

These are transient. Retry with exponential back-off. If the match is in an inconsistent state, call `POST /api/matches/{id}/reconcile` to sync off-chain state with the blockchain.

---

## Troubleshooting Checklist

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| All requests return 401 | Token expired | Refresh token |
| 401 on fresh token | Clock skew > 5 min | Sync system clock |
| 403 on admin endpoint | Missing `admin` role | Use an admin account |
| 409 on match create | Duplicate idempotency key | Generate a new key |
| 409 on state transition | Wrong current state | Check match state via `GET /api/matches/{id}` |
| 500 on finalize | Stellar network issue | Retry after 30s; call reconcile if needed |
| 429 on matchmaking join | Too many queue attempts | Wait for `Retry-After` seconds |
| WebSocket closes immediately | Invalid/expired token | Refresh token before connecting |
