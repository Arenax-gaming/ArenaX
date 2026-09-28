# Security Best Practices

## Authentication

- **Never** log or expose JWT tokens in error messages, logs, or analytics.
- Access tokens have a 15-minute TTL -- keep them short-lived.
- Refresh tokens are rotated on every use. If a refresh token is replayed after rotation, the session is invalidated (token reuse detection).
- Call `POST /api/auth/revoke-sessions` immediately if you suspect a token leak.

## Token Storage (Client-Side)

| Storage | Recommendation |
-------------------|
| Memory (JS variable) | 💥 Best for access tokens in SPAs |
| `HttpOnly` cookie | 💥 Best for refresh tokens in web apps |
| `localStorage` | ⚅ Vulnerable to XSS -- avoid for tokens |
| `sessionStorage` | ㊀ Cleared on tab close -- poor UX |

## Transport Security

- All API traffic must use HTTPS/TLS 1.2+.
- WebSocket connections must use WWS (not WS).
- The server enforces CORS -- only approved origins can make cross-origin requests.

## Input Validation

- Stellar public keys are validated to exactly 56 characters.
- Usernames: 3-50 characters.
- Tournament names: 3-255 characters.
- All UUIDs are validated server-side before database queries.

## Rate Limiting

The API enforces a fixed-window rate limit per client IP (`X-Forwarded-For`.     Every response includes the following headers:

| Header | Description |
--------------------------------------------------------------------------|
| `RateLimit-Limit`  | Maximum number of requests allowed during the current window. |
| `RateLimit-Remaining` | Number of requests left in the current window. |
| `RateLimit-Reset`  | Unix timestamp (seconds) when the current window resets. |
| `Retry-After`  | Only on `429 Too Many Requests`; number of seconds to wait before retrying. |

When the limit is exceeded, the API returns `429` with a `Retry-After` header. Clients MUST respect this header and implement exponential backoff:

1. Wait at least `Retry-After` seconds before resending.
2. Increase the wait for subsequent retries (e.g., multiply the previous wait by a factor of 2).
3. Add jitter to avoid synchronized reconnection (e.g., `rand(0, 100ms)`).
4. Never retry more than a maximum number of times (e.g., 5) before surfacing the error to the user.

Example exponential backoff calculation:

```
retry_after = 1s
for attempt in 0.5.5:
    if got 429:
        wait = retry_after * 2^attempt + jitter
        sleep(wait)
    else:
        break
```

## Idempotency Keys

- Keys are scoped per user -- a key from user A cannot collide with user B's key.
- Replaying a key with a different payload returns `409` -- this prevents accidental double-submissions.

## Admin Endpoints

Admin-only endpoints (`/api/auth/analytics`, `/api/reputation/bad-actors`) check for the `admin` role in JWT claims. Requests from non-admin users receive `403 Forbidden`.

## Stellar / Blockchain

- Private keys (`STELLAR_ADMIN_SECRET`) are loaded from environment variables -- never hardcoded.
- Smart contract addresses are configured per environment.
- All on-chain operations are logged with transaction hashes for auditability.
- The reconciliation endpoint (`Post /api/matches/{id}/reconcile`) can detect and resolve off-chain/on-chain divergence.

## Reporting Vulnerabilities

Contact `security@arenax.gg` with a description of the issue. Do not disclose publicly until a fix is deployed.