# Integration Guide

Quick-start walkthroughs for the most common ArenaX integration scenarios.

---

## 1. Register → Play a Ranked Match

### Step 1 — Register and authenticate

```http
POST /api/auth/register
{
  "username": "player_one",
  "email": "player@example.com",
  "phone_number": "+2348012345678",
  "password": "S3cur3P@ss!"
}
```

Store the returned `token` (access) and `refresh_token`.

### Step 2 — Connect WebSocket

```js
const ws = new WebSocket(`wss://api.arenax.gg/ws?token=${accessToken}`);
ws.onmessage = ({ data }) => handleEvent(JSON.parse(data));
```

### Step 3 — Join matchmaking queue

```http
POST /api/matchmaking/join
Authorization: Bearer <token>
Idempotency-Key: <uuid-v4>

{ "game": "chess", "game_mode": "ranked" }
```

### Step 4 — Wait for `match_found` event

```json
{
  "type": "match_found",
  "match_id": "abc123...",
  "opponent_id": "def456...",
  "opponent_name": "player_two",
  "game_mode": "ranked",
  "timestamp": "..."
}
```

Subscribe to the match channel:
```js
ws.send(JSON.stringify({ type: 'subscribe', channel: `match:${event.match_id}` }));
```

### Step 5 — Start the match

```http
POST /api/matches/abc123.../start
Authorization: Bearer <token>
```

### Step 6 — Complete the match

```http
POST /api/matches/abc123.../complete
Authorization: Bearer <token>

{ "winner": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" }
```

### Step 7 — Finalize (on-chain settlement)

```http
POST /api/matches/abc123.../finalize
Authorization: Bearer <token>
```

Listen for `match_completed` on the WebSocket — it carries the ELO delta.

---

## 2. Tournament Flow

### Create a tournament (admin)

```http
POST /api/tournaments
Authorization: Bearer <admin_token>

{
  "name": "Weekend Warriors Cup",
  "game": "chess",
  "bracket_type": "single_elimination",
  "max_participants": 16,
  "entry_fee": 50000,
  "entry_fee_currency": "NGN",
  "start_time": "2026-05-01T18:00:00Z",
  "registration_deadline": "2026-04-30T23:59:59Z"
}
```

### Join a tournament

```http
POST /api/tournaments/{id}/join
Authorization: Bearer <token>
Idempotency-Key: <uuid-v4>
```

### Monitor progress

Subscribe to `user:{user_id}` on WebSocket — you'll receive `match_found` events as rounds progress.

---

## 3. Idempotent Payments / Wallet Operations

For any wallet mutation, always send an `Idempotency-Key`:

```http
POST /api/wallets/deposit
Authorization: Bearer <token>
Idempotency-Key: 7f3d9a2b-1c4e-4f8a-9b0d-2e5f6a7c8d9e
Content-Type: application/json

{ "amount": 100000, "currency": "NGN", "provider": "paystack" }
```

If the request times out, replay it with the **same** key — you'll get the original response without double-charging.

---

## SDK Examples

### JavaScript / TypeScript

```ts
class ArenaXClient {
  private baseUrl = 'https://api.arenax.gg';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async login(email: string, password: string) {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    this.accessToken = data.token;
    this.refreshToken = data.refresh_token;
    return data.user;
  }

  async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...options.headers,
      },
    });

    if (res.status === 401) {
      await this.refreshAccessToken();
      return this.request(path, options); // retry once
    }

    if (!res.ok) throw await res.json();
    return res.json();
  }

  private async refreshAccessToken() {
    const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    const data = await res.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
  }

  joinQueue(game: string, gameMode: string) {
    return this.request('/api/matchmaking/join', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ game, game_mode: gameMode }),
    });
  }
}
```

### Python

```python
import httpx
import uuid

class ArenaXClient:
    BASE_URL = "https://api.arenax.gg"

    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        self.client = httpx.Client(base_url=self.BASE_URL)

    def login(self, email: str, password: str) -> dict:
        r = self.client.post("/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        data = r.json()
        self.access_token = data["token"]
        self.refresh_token = data["refresh_token"]
        return data["user"]

    def _headers(self, idempotency: bool = False) -> dict:
        h = {"Authorization": f"Bearer {self.access_token}"}
        if idempotency:
            h["Idempotency-Key"] = str(uuid.uuid4())
        return h

    def join_queue(self, game: str, game_mode: str) -> dict:
        r = self.client.post(
            "/api/matchmaking/join",
            json={"game": game, "game_mode": game_mode},
            headers=self._headers(idempotency=True),
        )
        r.raise_for_status()
        return r.json()

    def get_reputation(self, user_id: str) -> dict:
        r = self.client.get(f"/api/reputation/player/{user_id}")
        r.raise_for_status()
        return r.json()["data"]
```

### Rust (reqwest)

```rust
use reqwest::Client;
use serde_json::json;

async fn login(client: &Client, email: &str, password: &str) -> anyhow::Result<String> {
    let res = client
        .post("https://api.arenax.gg/api/auth/login")
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    Ok(res["token"].as_str().unwrap().to_string())
}

async fn join_queue(client: &Client, token: &str, game: &str) -> anyhow::Result<()> {
    client
        .post("https://api.arenax.gg/api/matchmaking/join")
        .bearer_auth(token)
        .header("Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .json(&json!({ "game": game, "game_mode": "ranked" }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
```

---

## Rate Limits

| Endpoint group | Default limit |
|----------------|--------------|
| Auth (login/register) | Configured via `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` |
| All other endpoints | Same global limit |

When you hit the limit you receive:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

Back off for the indicated number of seconds before retrying.
