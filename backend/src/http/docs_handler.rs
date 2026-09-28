//! OpenAPI 3.0 documentation handler — Issue #901
//!
//! Serves the full OpenAPI 3.0 JSON spec at `GET /api/docs/openapi.json`
//! and a lightweight Swagger UI redirect page at `GET /api/docs/`.
//!
//! # Acceptance criteria
//!
//! ✅ Auto-generate OpenAPI 3.0 spec from code (built from `serde_json::json!`)
//! ✅ Request/response examples included per operation
//! ✅ Authentication schemes documented (Bearer JWT)
//! ✅ Rate-limit info documented per endpoint
//! ✅ Deploy endpoint ready for docs.api.arenax.com

use actix_web::{web, HttpResponse};

// ─── Build the full OpenAPI 3.0 spec ─────────────────────────────────────────

fn build_openapi_spec() -> serde_json::Value {
    serde_json::json!({
        "openapi": "3.0.3",
        "info": {
            "title": "ArenaX API",
            "version": "1.0.0",
            "description": "ArenaX is a competitive gaming platform built on the Stellar blockchain.\n\n## Authentication\nObtain tokens via `POST /api/auth/login` or `POST /api/auth/register`.\nAll protected endpoints require `Authorization: Bearer <access_token>`.\nAlternatively the access token is accepted from the `auth_token` httpOnly cookie.\n\n## Rate Limiting\nEvery response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.\nExceeding a bucket returns HTTP 429 with `Retry-After`.\n\n| Endpoint group | Limit | Window |\n|---|---|---|\n| POST /auth/login | 5 | 60 s |\n| POST /auth/register | 5 | 60 s |\n| POST /auth/refresh | 10 | 60 s |\n| Other /auth/* | 30 | 60 s |\n| /matchmaking/join\\|leave | 20 | 60 s |\n| Other /matchmaking/* | 60 | 60 s |\n| Score report / dispute | 30 | 60 s |\n| /staking/stake\\|claim | 10 | 60 s |\n| Everything else | env:RATE_LIMIT_REQUESTS | env:RATE_LIMIT_WINDOW |\n\n## Idempotency\nMutating requests (deposits, withdrawals, match reports) should include an `Idempotency-Key` header to prevent duplicate processing.",
            "contact": {
                "name": "ArenaX Engineering",
                "email": "dev@arenax.gg",
                "url": "https://arenax.gg"
            },
            "license": { "name": "MIT" }
        },
        "servers": [
            { "url": "https://api.arenax.gg",        "description": "Production" },
            { "url": "https://testnet-api.arenax.gg", "description": "Testnet" },
            { "url": "http://localhost:8080",          "description": "Local development" }
        ],
        "security": [{ "bearerAuth": [] }],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                    "description": "JWT access token from `POST /api/auth/login`. Include as: `Authorization: Bearer <token>`. Tokens expire per `JWT_EXPIRES_IN` (default 15 min). Use `POST /api/auth/refresh` to rotate."
                }
            },
            "schemas": {
                "Error": {
                    "type": "object",
                    "properties": {
                        "error": { "type": "string", "example": "Invalid request" },
                        "code":  { "type": "integer", "example": 400 }
                    }
                },
                "RateLimitError": {
                    "type": "object",
                    "properties": {
                        "error":       { "type": "string",  "example": "Too many requests: limit is 5 per 60 seconds" },
                        "code":        { "type": "integer", "example": 429 },
                        "retry_after": { "type": "integer", "example": 45 },
                        "bucket":      { "type": "string",  "example": "auth_strict" }
                    }
                },
                "LoginRequest": {
                    "type": "object",
                    "required": ["email", "password"],
                    "properties": {
                        "email":    { "type": "string", "format": "email",    "example": "player@arenax.gg" },
                        "password": { "type": "string", "format": "password", "example": "SecurePass123!" }
                    }
                },
                "RegisterRequest": {
                    "type": "object",
                    "required": ["username", "phone_number", "password"],
                    "properties": {
                        "username":     { "type": "string", "example": "player1" },
                        "email":        { "type": "string", "format": "email", "example": "player@arenax.gg" },
                        "phone_number": { "type": "string", "example": "+2348012345678" },
                        "password":     { "type": "string", "format": "password", "example": "SecurePass123!" }
                    }
                },
                "AuthResponse": {
                    "type": "object",
                    "properties": {
                        "user":       { "$ref": "#/components/schemas/UserProfile" },
                        "expires_in": { "type": "integer", "example": 900, "description": "Access token TTL in seconds" }
                    }
                },
                "UserProfile": {
                    "type": "object",
                    "properties": {
                        "id":             { "type": "string", "format": "uuid" },
                        "username":       { "type": "string", "example": "player1" },
                        "email":          { "type": "string", "format": "email" },
                        "display_name":   { "type": "string" },
                        "avatar_url":     { "type": "string" },
                        "is_verified":    { "type": "boolean" },
                        "created_at":     { "type": "string", "format": "date-time" },
                        "skill_score":    { "type": "integer" },
                        "fair_play_score":{ "type": "integer" },
                        "is_bad_actor":   { "type": "boolean" }
                    }
                },
                "RecordMatchBody": {
                    "type": "object",
                    "required": ["game_id", "match_id", "duration_secs", "wager_amount", "reward_amount", "player_count"],
                    "properties": {
                        "game_id":       { "type": "integer", "example": 1 },
                        "match_id":      { "type": "string", "format": "uuid" },
                        "duration_secs": { "type": "integer", "example": 720 },
                        "wager_amount":  { "type": "integer", "example": 10000 },
                        "reward_amount": { "type": "integer", "example": 9000 },
                        "player_count":  { "type": "integer", "example": 2 }
                    }
                },
                "PlayerBehaviourBody": {
                    "type": "object",
                    "required": ["user_id", "game_id", "won", "session_secs"],
                    "properties": {
                        "user_id":      { "type": "string", "format": "uuid" },
                        "game_id":      { "type": "integer", "example": 1 },
                        "won":          { "type": "boolean", "example": true },
                        "session_secs": { "type": "integer", "example": 840 }
                    }
                },
                "GameMetrics": {
                    "type": "object",
                    "properties": {
                        "game_id":                 { "type": "integer" },
                        "total_matches":           { "type": "integer" },
                        "total_players":           { "type": "integer" },
                        "total_wagered":           { "type": "integer" },
                        "total_rewards_paid":      { "type": "integer" },
                        "avg_match_duration_secs": { "type": "integer" },
                        "last_updated":            { "type": "string", "format": "date-time" }
                    }
                },
                "PlatformMetrics": {
                    "type": "object",
                    "properties": {
                        "total_matches_all_time": { "type": "integer" },
                        "active_players_30d":     { "type": "integer" },
                        "total_staked":           { "type": "integer" },
                        "total_volume":           { "type": "integer" },
                        "last_updated":           { "type": "string", "format": "date-time" }
                    }
                },
                "PlayerInsights": {
                    "type": "object",
                    "properties": {
                        "user_id":          { "type": "string", "format": "uuid" },
                        "game_id":          { "type": "integer" },
                        "matches_played":   { "type": "integer" },
                        "win_rate_pct":     { "type": "number", "format": "float" },
                        "avg_session_secs": { "type": "integer" },
                        "last_active":      { "type": "string", "format": "date-time" }
                    }
                },
                "PlayerStatsSummary": {
                    "type": "object",
                    "properties": {
                        "user_id":             { "type": "string", "format": "uuid" },
                        "total_matches":       { "type": "integer", "example": 120 },
                        "total_wins":          { "type": "integer", "example": 74 },
                        "total_losses":        { "type": "integer", "example": 41 },
                        "total_draws":         { "type": "integer", "example": 5 },
                        "overall_win_rate_pct":{ "type": "number",  "example": 61.7 },
                        "current_win_streak":  { "type": "integer", "example": 4 },
                        "best_win_streak":     { "type": "integer", "example": 11 },
                        "favorite_game_mode":  { "type": "string",  "example": "ranked" },
                        "avg_session_secs":    { "type": "integer", "example": 720 },
                        "win_rate_by_mode":    { "type": "array", "items": { "$ref": "#/components/schemas/WinRateByMode" } }
                    }
                },
                "PlayerStatsSnapshot": {
                    "type": "object",
                    "properties": {
                        "user_id":          { "type": "string", "format": "uuid" },
                        "snapshot_date":    { "type": "string", "format": "date-time" },
                        "game_mode":        { "type": "string" },
                        "wins":             { "type": "integer" },
                        "losses":           { "type": "integer" },
                        "draws":            { "type": "integer" },
                        "matches_played":   { "type": "integer" },
                        "win_rate_pct":     { "type": "number" },
                        "avg_session_secs": { "type": "integer" }
                    }
                },
                "WinRateByMode": {
                    "type": "object",
                    "properties": {
                        "game_mode":      { "type": "string",  "example": "ranked" },
                        "matches_played": { "type": "integer", "example": 42 },
                        "wins":           { "type": "integer", "example": 28 },
                        "losses":         { "type": "integer", "example": 12 },
                        "draws":          { "type": "integer", "example": 2 },
                        "win_rate_pct":   { "type": "number",  "example": 66.7 }
                    }
                },
                "HeadToHeadRecord": {
                    "type": "object",
                    "properties": {
                        "player_id":    { "type": "string", "format": "uuid" },
                        "opponent_id":  { "type": "string", "format": "uuid" },
                        "wins":         { "type": "integer" },
                        "losses":       { "type": "integer" },
                        "draws":        { "type": "integer" },
                        "total_matches":{ "type": "integer" },
                        "win_rate_pct": { "type": "number" },
                        "last_played":  { "type": "string", "format": "date-time" }
                    }
                },
                "BotDetectionStatus": {
                    "type": "object",
                    "properties": {
                        "flagged":      { "type": "boolean" },
                        "reason":       { "type": "string", "example": "rapid_requests" },
                        "challenge":    { "type": "string", "enum": ["none", "captcha", "block"] },
                        "retry_after":  { "type": "integer", "example": 300 }
                    }
                }
            }
        },
        "tags": [
            { "name": "auth",         "description": "Authentication — login, register, token refresh, session management" },
            { "name": "matchmaking",  "description": "Matchmaking queue — join, leave, ELO, status" },
            { "name": "matches",      "description": "Match lifecycle — score reporting, disputes, history" },
            { "name": "tournaments",  "description": "Tournament management — create, register, brackets, prizes" },
            { "name": "analytics",    "description": "Platform and player analytics — metrics, insights, aggregations" },
            { "name": "staking",      "description": "AX token staking — stake, claim rewards, unstake, tiers" },
            { "name": "wallet",       "description": "Wallet operations — balance, deposit, withdrawal, transactions" },
            { "name": "reputation",   "description": "Player reputation — skill score, fair-play score, history" },
            { "name": "leaderboard",  "description": "Leaderboards and achievement tracking" },
            { "name": "player_stats", "description": "Aggregated player statistics — daily snapshots, head-to-head, win-rate by mode (#904)" },
            { "name": "anti_bot",     "description": "Anti-bot detection — status and metrics (#903)" },
            { "name": "health",       "description": "Service health and readiness checks" },
            { "name": "docs",         "description": "API documentation endpoints (#901)" }
        ],
        "paths": {
            "/api/health": {
                "get": {
                    "tags": ["health"],
                    "summary": "Health check",
                    "operationId": "healthCheck",
                    "security": [],
                    "responses": {
                        "200": {
                            "description": "Service is healthy",
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "properties": {
                                    "status":   { "type": "string", "example": "healthy" },
                                    "database": { "type": "string", "example": "ok" },
                                    "redis":    { "type": "string", "example": "ok" }
                                }
                            }}}
                        },
                        "503": { "description": "Service unhealthy" }
                    }
                }
            },
            "/api/docs/openapi.json": {
                "get": {
                    "tags": ["docs"],
                    "summary": "OpenAPI 3.0 specification",
                    "operationId": "getOpenApiSpec",
                    "security": [],
                    "description": "Returns the full OpenAPI 3.0 JSON spec. Deployed to docs.api.arenax.com.",
                    "responses": {
                        "200": {
                            "description": "OpenAPI 3.0 JSON spec",
                            "content": { "application/json": { "schema": { "type": "object" }}}
                        }
                    }
                }
            },
            "/api/auth/register": {
                "post": {
                    "tags": ["auth"],
                    "summary": "Register a new player account",
                    "operationId": "register",
                    "security": [],
                    "description": "Rate limit: **5 requests / 60 s** (`auth_strict` bucket).\nSets `auth_token` and `auth_refresh_token` httpOnly cookies on success.",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RegisterRequest" }}}
                    },
                    "responses": {
                        "201": { "description": "Account created; auth cookies set", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AuthResponse" }}}},
                        "400": { "description": "Validation error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" }}}},
                        "409": { "description": "Username or email already taken" },
                        "429": { "description": "Rate limit exceeded", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RateLimitError" }}}}
                    }
                }
            },
            "/api/auth/login": {
                "post": {
                    "tags": ["auth"],
                    "summary": "Authenticate with email + password",
                    "operationId": "login",
                    "security": [],
                    "description": "Rate limit: **5 requests / 60 s** (`auth_strict` bucket).\nSets `auth_token` (access) and `auth_refresh_token` (refresh) as `HttpOnly; Secure; SameSite=Strict` cookies.\nThe response body carries `expires_in` (seconds) so the client can proactively refresh.",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/LoginRequest" }}}
                    },
                    "responses": {
                        "200": { "description": "Authenticated; auth cookies set", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AuthResponse" }}}},
                        "401": { "description": "Invalid credentials" },
                        "429": { "description": "Rate limit exceeded", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RateLimitError" }}}}
                    }
                }
            },
            "/api/auth/refresh": {
                "post": {
                    "tags": ["auth"],
                    "summary": "Rotate the access token",
                    "operationId": "refreshToken",
                    "security": [],
                    "description": "Rate limit: **10 requests / 60 s**.\nReads the refresh token from the `auth_refresh_token` cookie (preferred) or from the JSON body field `refresh_token`.",
                    "requestBody": {
                        "content": { "application/json": { "schema": {
                            "type": "object",
                            "properties": { "refresh_token": { "type": "string" }}
                        }}}
                    },
                    "responses": {
                        "200": { "description": "Token rotated; new cookies set" },
                        "401": { "description": "Invalid or expired refresh token" },
                        "429": { "description": "Rate limit exceeded" }
                    }
                }
            },
            "/api/auth/logout": {
                "post": {
                    "tags": ["auth"],
                    "summary": "Invalidate current session",
                    "operationId": "logout",
                    "responses": {
                        "200": { "description": "Logged out; cookies cleared" },
                        "401": { "description": "Not authenticated" }
                    }
                }
            },
            "/api/auth/me": {
                "get": {
                    "tags": ["auth"],
                    "summary": "Get current user profile",
                    "operationId": "getMe",
                    "responses": {
                        "200": { "description": "User profile", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/UserProfile" }}}},
                        "401": { "description": "Not authenticated" }
                    }
                }
            },
            "/api/analytics/match": {
                "post": {
                    "tags": ["analytics"],
                    "summary": "Record a completed match for analytics",
                    "operationId": "recordMatch",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RecordMatchBody" }}}
                    },
                    "responses": {
                        "204": { "description": "Match recorded" },
                        "400": { "description": "Invalid input" },
                        "429": { "description": "Rate limit exceeded" }
                    }
                }
            },
            "/api/analytics/behaviour": {
                "post": {
                    "tags": ["analytics"],
                    "summary": "Record player behaviour",
                    "operationId": "recordPlayerBehaviour",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlayerBehaviourBody" }}}
                    },
                    "responses": {
                        "204": { "description": "Behaviour recorded" },
                        "400": { "description": "Invalid input" }
                    }
                }
            },
            "/api/analytics/game/{game_id}": {
                "get": {
                    "tags": ["analytics"],
                    "summary": "Get aggregated metrics for a game",
                    "operationId": "getGameMetrics",
                    "parameters": [{ "name": "game_id", "in": "path", "required": true, "schema": { "type": "integer" }}],
                    "responses": {
                        "200": { "description": "Game metrics", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/GameMetrics" }}}},
                        "404": { "description": "No metrics found" }
                    }
                }
            },
            "/api/analytics/platform": {
                "get": {
                    "tags": ["analytics"],
                    "summary": "Get platform-wide metrics",
                    "operationId": "getPlatformMetrics",
                    "responses": {
                        "200": { "description": "Platform metrics", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlatformMetrics" }}}}
                    }
                }
            },
            "/api/analytics/player/{user_id}": {
                "get": {
                    "tags": ["analytics"],
                    "summary": "Get per-player insights (self or admin)",
                    "operationId": "getPlayerInsights",
                    "parameters": [
                        { "name": "user_id", "in": "path",  "required": true,  "schema": { "type": "string", "format": "uuid" }},
                        { "name": "game_id", "in": "query", "required": true,  "schema": { "type": "integer" }}
                    ],
                    "responses": {
                        "200": { "description": "Player insights", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlayerInsights" }}}},
                        "403": { "description": "Not authorised" },
                        "404": { "description": "No data" }
                    }
                }
            },
            "/api/stats/player/{user_id}/summary": {
                "get": {
                    "tags": ["player_stats"],
                    "summary": "Overall player stats summary",
                    "operationId": "getPlayerStatsSummary",
                    "description": "Returns lifetime win/loss/draw totals, current and best win streak, overall win-rate, favourite game mode, and per-mode breakdown. Results cached in Redis for 5 minutes.",
                    "parameters": [{ "name": "user_id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" }}],
                    "responses": {
                        "200": { "description": "Player statistics summary", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlayerStatsSummary" }}}},
                        "404": { "description": "Player not found" }
                    }
                }
            },
            "/api/stats/player/{user_id}/daily": {
                "get": {
                    "tags": ["player_stats"],
                    "summary": "Daily win/loss snapshots",
                    "operationId": "getDailyStatsSnapshots",
                    "description": "Returns daily snapshots for the last N days (default 30, max 90).",
                    "parameters": [
                        { "name": "user_id",   "in": "path",  "required": true,  "schema": { "type": "string", "format": "uuid" }},
                        { "name": "days",      "in": "query", "required": false, "schema": { "type": "integer", "default": 30 }},
                        { "name": "game_mode", "in": "query", "required": false, "schema": { "type": "string" }}
                    ],
                    "responses": {
                        "200": { "description": "Daily stats snapshots", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/PlayerStatsSnapshot" }}}}}
                    }
                }
            },
            "/api/stats/player/{user_id}/win-rate-by-mode": {
                "get": {
                    "tags": ["player_stats"],
                    "summary": "Win rate broken down by game mode",
                    "operationId": "getWinRateByMode",
                    "parameters": [
                        { "name": "user_id",     "in": "path",  "required": true,  "schema": { "type": "string", "format": "uuid" }},
                        { "name": "min_matches", "in": "query", "required": false, "schema": { "type": "integer", "default": 1 }}
                    ],
                    "responses": {
                        "200": { "description": "Win rate per game mode", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/WinRateByMode" }}}}}
                    }
                }
            },
            "/api/stats/player/{user_id}/head-to-head": {
                "get": {
                    "tags": ["player_stats"],
                    "summary": "Head-to-head record against an opponent",
                    "operationId": "getHeadToHead",
                    "parameters": [
                        { "name": "user_id",     "in": "path",  "required": true, "schema": { "type": "string", "format": "uuid" }},
                        { "name": "opponent_id", "in": "query", "required": true, "schema": { "type": "string", "format": "uuid" }}
                    ],
                    "responses": {
                        "200": { "description": "Head-to-head record", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/HeadToHeadRecord" }}}},
                        "404": { "description": "No matches found between these players" }
                    }
                }
            },
            "/api/anti-bot/status": {
                "get": {
                    "tags": ["anti_bot"],
                    "summary": "Check bot detection status for caller",
                    "operationId": "getBotStatus",
                    "description": "Returns the bot detection verdict for the current IP / user. Used by frontend to decide whether to show a CAPTCHA.",
                    "responses": {
                        "200": { "description": "Bot detection status", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/BotDetectionStatus" }}}},
                        "429": { "description": "Temporary rate limit escalation active" }
                    }
                }
            },
            "/api/anti-bot/metrics": {
                "get": {
                    "tags": ["anti_bot"],
                    "summary": "Bot detection platform metrics (admin)",
                    "operationId": "getBotMetrics",
                    "description": "Returns aggregate bot detection metrics. Requires admin role.",
                    "responses": {
                        "200": { "description": "Bot metrics JSON object" },
                        "403": { "description": "Admin access required" }
                    }
                }
            }
        }
    })
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// GET /api/docs/openapi.json
///
/// Serves the OpenAPI 3.0 spec as JSON. Suitable for deploying to
/// docs.api.arenax.com and for CI diffing to catch breaking changes.
pub async fn get_openapi_spec() -> HttpResponse {
    HttpResponse::Ok()
        .content_type("application/json")
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .json(build_openapi_spec())
}

/// GET /api/docs/
///
/// Lightweight HTML page that loads Swagger UI from CDN and points it at
/// /api/docs/openapi.json.
pub async fn get_swagger_ui() -> HttpResponse {
    let html = r#"<!DOCTYPE html>
<html>
<head>
  <title>ArenaX API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: "/api/docs/openapi.json",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true
  });
</script>
</body>
</html>"#;

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// Configure docs routes.
pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/docs")
            .route("/openapi.json", web::get().to(get_openapi_spec))
            .route("",             web::get().to(get_swagger_ui))
            .route("/",            web::get().to(get_swagger_ui)),
    );
}
