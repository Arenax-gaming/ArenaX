# Authentication Guide

ArenaX uses **JWT Bearer tokens** with short-lived access tokens and longer-lived refresh tokens.

## Token Lifecycle

```
Register / Login
      │
      ▼
 access_token (15 min)  +  refresh_token (7 days)
      │                          │
      │ expires                  │ still valid
      ▼                          ▼
  Use /auth/refresh  ──────► new token pair
      │
      │ refresh also expired
      ▼
  Re-login required
```

## 1. Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "player_one",
  "email": "player@example.com",
  "phone_number": "+2348012345678",
  "password": "S3cur3P@ss!"
}
```

Response `201`:
```json
{
  "token": "<access_token>",
  "refresh_token": "<refresh_token>",
  "user": { "id": "...", "username": "player_one", ... }
}
```

## 2. Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "player@example.com",
  "password": "S3cur3P@ss!"
}
```

## 3. Authenticated Requests

Include the access token in every protected request:

```http
GET /api/auth/me
Authorization: Bearer <access_token>
```

## 4. Refresh Tokens

When the access token expires (HTTP 401 `Token expired`):

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

Response `200`:
```json
{
  "access_token": "<new_access_token>",
  "refresh_token": "<new_refresh_token>",
  "expires_in": 900,
  "token_type": "Bearer"
}
```

> Both tokens are rotated on refresh. Store the new pair and discard the old ones.

### Suspension status is baked into the token

Access tokens carry a `suspended` boolean claim describing the player's
suspension status **at the moment the token was issued**. Requests presenting a
token with `suspended: true` are rejected before they reach a handler:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "Player is suspended",
  "code": "PLAYER_SUSPENDED",
  "message": "This account is suspended. Suspension status is baked into the token; call POST /api/auth/refresh once the suspension is lifted."
}
```

Because the flag is a claim, suspension is not re-read from the database on
every request. The consequence is that the status is only refreshed when a new
token is issued:

- **Suspended after login** — the player keeps access until their access token
  expires (default 15 minutes), then the refresh below issues a token with
  `suspended: true`.
- **Reinstated** — the player must call `POST /api/auth/refresh`. Refresh tokens
  are exempt from the suspension check precisely so this call still works; the
  new access token carries the current status and access is restored.

Call `POST /api/auth/refresh` after any suspension or reinstatement rather than
waiting for the access token to expire.

## 5. Logout

Blacklists the current access token server-side:

```http
POST /api/auth/logout
Authorization: Bearer <access_token>
```

## 6. Session Management

List all active sessions:
```http
GET /api/auth/sessions
Authorization: Bearer <access_token>
```

Revoke all sessions (e.g. after a security incident):
```http
POST /api/auth/revoke-sessions
Authorization: Bearer <access_token>
```

## JWT Claims

The decoded access token payload:

```json
{
  "sub": "<user_uuid>",
  "exp": 1714000000,
  "iat": 1713999100,
  "jti": "<unique_token_id>",
  "token_type": "access",
  "device_id": null,
  "session_id": "<session_uuid>",
  "roles": ["user"]
}
```

Admin users have `"roles": ["admin", "user"]`.

## Error Responses

| Status | Meaning |
|--------|---------|
| 401 `Missing authorization header` | No `Authorization` header sent |
| 401 `Invalid authorization header format` | Header not in `Bearer <token>` format |
| 401 `Token expired` | Access token TTL elapsed — refresh it |
| 401 `Session expired or invalid` | Session was revoked server-side |
| 403 `Token has been revoked` | Token was explicitly blacklisted |

## Security Best Practices

- Store tokens in memory (not `localStorage`) in browser clients.
- Use `HttpOnly` cookies for refresh tokens in web apps.
- Always use HTTPS — tokens are bearer credentials.
- Rotate refresh tokens on every use (already enforced server-side).
- Call `/auth/revoke-sessions` if you suspect token compromise.
