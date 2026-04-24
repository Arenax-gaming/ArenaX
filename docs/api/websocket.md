# WebSocket Event Documentation

ArenaX uses WebSocket for real-time delivery of match events, balance updates, and notifications.

## Connection

```
wss://api.arenax.gg/ws?token=<access_token>
```

The JWT access token is passed as a query parameter. The connection is rejected with HTTP 401 if the token is missing or invalid.

### Heartbeat

The server sends a WebSocket `ping` frame every **5 seconds**. If no `pong` is received within **10 seconds**, the connection is closed. Most WebSocket clients handle ping/pong automatically.

You can also send application-level heartbeats:
```json
{ "type": "ping" }
```
Server responds:
```json
{ "type": "pong" }
```

---

## Channel Subscriptions

On connect, you are automatically subscribed to your own user channel (`user:<your_uuid>`).

### Subscribe to a channel
```json
{ "type": "subscribe", "channel": "match:550e8400-e29b-41d4-a716-446655440000" }
```

### Unsubscribe
```json
{ "type": "unsubscribe", "channel": "match:550e8400-e29b-41d4-a716-446655440000" }
```

### Channel naming

| Pattern | Description |
|---------|-------------|
| `user:{user_id}` | Personal events (balance, notifications, match found) |
| `match:{match_id}` | Events for a specific match |

---

## Server → Client Events

All events are JSON objects with a `type` discriminator field.

### `balance_update`
Fired when the user's wallet balance changes.
```json
{
  "type": "balance_update",
  "user_id": "550e8400-...",
  "balance_ngn": 500000,
  "balance_arenax_tokens": 1000,
  "balance_xlm": 50000000,
  "timestamp": "2026-04-24T12:00:00Z"
}
```
> Amounts: `balance_ngn` in kobo (÷100 for NGN), `balance_xlm` in stroops (÷10,000,000 for XLM).

### `match_found`
Fired when the matchmaker pairs you with an opponent.
```json
{
  "type": "match_found",
  "match_id": "...",
  "opponent_id": "...",
  "opponent_name": "player_two",
  "game_mode": "ranked",
  "timestamp": "2026-04-24T12:00:00Z"
}
```

### `match_status_change`
Fired on every match state transition.
```json
{
  "type": "match_status_change",
  "match_id": "...",
  "from_status": "CREATED",
  "to_status": "STARTED",
  "timestamp": "2026-04-24T12:00:00Z"
}
```

### `match_completed`
Fired when a match reaches the COMPLETED state.
```json
{
  "type": "match_completed",
  "match_id": "...",
  "winner_id": "...",
  "elo_change": 24,
  "timestamp": "2026-04-24T12:00:00Z"
}
```
> `elo_change` is positive for a win, negative for a loss.

### `match_disputed`
Fired when a dispute is raised on a completed match.
```json
{
  "type": "match_disputed",
  "match_id": "...",
  "reason": "Score mismatch reported by player",
  "timestamp": "2026-04-24T12:00:00Z"
}
```

### `notification`
In-app notification pushed in real time.
```json
{
  "type": "notification",
  "id": "...",
  "title": "Tournament starting soon",
  "body": "Your tournament begins in 5 minutes.",
  "category": "tournament",
  "timestamp": "2026-04-24T12:00:00Z"
}
```

### `error`
Sent when the server cannot process a client message.
```json
{
  "type": "error",
  "message": "Invalid message format"
}
```

---

## Client → Server Messages

### `subscribe`
```json
{ "type": "subscribe", "channel": "match:<uuid>" }
```

### `unsubscribe`
```json
{ "type": "unsubscribe", "channel": "match:<uuid>" }
```

### `ping`
```json
{ "type": "ping" }
```

---

## JavaScript Example

```js
const token = localStorage.getItem('access_token'); // prefer memory storage
const ws = new WebSocket(`wss://api.arenax.gg/ws?token=${token}`);

ws.onopen = () => {
  console.log('Connected');
  // Subscribe to a match channel
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'match:550e8400-...' }));
};

ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  switch (event.type) {
    case 'match_found':
      console.log('Match found!', event.match_id);
      break;
    case 'balance_update':
      console.log('New balance (NGN):', event.balance_ngn / 100);
      break;
    case 'notification':
      showToast(event.title, event.body);
      break;
  }
};

ws.onclose = (e) => {
  console.log('Disconnected', e.code, e.reason);
  // Implement exponential back-off reconnect here
};
```

---

## Reconnection Strategy

Implement exponential back-off with jitter:

```js
let retryDelay = 1000;
const MAX_DELAY = 30000;

function connect() {
  const ws = new WebSocket(`wss://api.arenax.gg/ws?token=${getToken()}`);
  ws.onopen = () => { retryDelay = 1000; };
  ws.onclose = () => {
    setTimeout(connect, retryDelay + Math.random() * 500);
    retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
  };
}
```

> If the access token expires while connected, the server will close the connection. Refresh the token before reconnecting.
