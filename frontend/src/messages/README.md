# ArenaX Real-Time Messages — `src/messages`

> **Issue #697** — WebSocket connection manager, message queue, optimistic UI, and localStorage persistence.

---

## Overview

```
src/messages/
├── wsManager.ts           — WebSocketManager: connect, reconnect, heartbeat
├── messageStore.ts        — Message state, offline queue, persistence, analytics
├── useRealtimeMessages.ts — React hook (useSyncExternalStore pattern)
└── index.ts               — Public barrel export
```

---

## WebSocket Manager (`wsManager.ts`)

### Features

| Feature | Detail |
|---|---|
| **Auto-reconnect** | Exponential back-off with jitter (configurable base / cap / max attempts) |
| **Heartbeat** | Sends `ping` every 30 s; closes and reconnects if no `pong` within 10 s |
| **Auth injection** | Appends `?token=<jwt>` to WS URL for browser-compatible auth |
| **Status indicators** | `idle → connecting → connected → reconnecting → offline → closed` |
| **Analytics** | Every lifecycle event logged with `trackWsEvent()` |

### Usage

```ts
import { WebSocketManager } from "@/messages";

const manager = new WebSocketManager({
  url: "wss://api.arenax.io/ws",
  getToken: () => localStorage.getItem("auth_token"),
  onMessage: (msg) => console.log("Received:", msg),
  onStatusChange: (status) => console.log("Status:", status),
  onPermanentDisconnect: () => console.warn("Gave up reconnecting"),
});

manager.connect();

// Send a typed message
manager.send("match_update", { matchId: "123", score: [2, 1] });

// Graceful disconnect
manager.disconnect();
```

---

## Message Store (`messageStore.ts`)

### Features

| Feature | Detail |
|---|---|
| **Optimistic UI** | Messages appear in the UI instantly with `status: "pending"` before server confirms |
| **Offline queue** | Outgoing messages buffered when disconnected, auto-flushed on reconnect |
| **Delivery tracking** | Messages transition `pending → sent → delivered / failed` |
| **localStorage persistence** | Conversations, messages (last 500 per conversation), and queue survive page reload |
| **Conversation management** | `upsertConversation`, `markConversationRead`, `getTotalUnread` |
| **`useSyncExternalStore`** | React-18-safe subscription model — no stale closure issues |

---

## React Hook (`useRealtimeMessages.ts`)

```tsx
import { useRealtimeMessages } from "@/messages";

function MatchChat({ matchId }: { matchId: string }) {
  const {
    messages,
    status,
    queueLength,
    isOnline,
    sendMessage,
    markRead,
    reconnect,
  } = useRealtimeMessages({
    conversationId: `match-${matchId}`,
    autoConnect: true,
    onMessage: (msg) => console.log("New message:", msg.content),
  });

  return (
    <div>
      <ConnectionBadge status={status} />
      {queueLength > 0 && <p>{queueLength} message(s) queued</p>}

      <ul>
        {messages.map((msg) => (
          <li key={msg.id} data-status={msg.status}>
            <b>{msg.senderName}</b>: {msg.content}
            {msg.optimistic && " (sending…)"}
          </li>
        ))}
      </ul>

      <input
        onKeyDown={(e) => {
          if (e.key === "Enter") sendMessage(e.currentTarget.value);
        }}
      />
    </div>
  );
}
```

### Additional hooks

```ts
import { useWsStatus, useTotalUnread } from "@/messages";

const status = useWsStatus();         // ConnectionStatus
const unread = useTotalUnread();      // number
```

---

## Connection Status Reference

| Status | Meaning |
|---|---|
| `idle` | Not yet connected |
| `connecting` | First connect attempt in progress |
| `connected` | Live connection established |
| `reconnecting` | Connection lost, trying to reconnect |
| `offline` | Max reconnect attempts exceeded |
| `closed` | Explicitly closed by `manager.disconnect()` |

---

## Analytics

```ts
import { getWsEvents, getMessageDeliveryStats } from "@/messages";

const events = getWsEvents();                    // Connection lifecycle log
const stats  = getMessageDeliveryStats();        // { sent, delivered, failed, deliveryRate }
```

---

## Testing

Tests live in `src/__tests__/realtime-messages.test.ts`.

```bash
cd frontend
npx jest realtime-messages.test.ts
```

Test coverage:
- ✅ Connected status on open
- ✅ `send()` returns `true` / `false` based on connection state
- ✅ Reconnect scheduling on unexpected close
- ✅ Permanent disconnect after max attempts
- ✅ Token appended to WS URL
- ✅ Heartbeat metrics tracking
- ✅ Optimistic message creation
- ✅ Queue messages when offline
- ✅ Flush queue on reconnection
- ✅ Receive + update optimistic message to `delivered`
- ✅ `subscribe` / `unsubscribe` works correctly
- ✅ `localStorage` persistence of messages and queue
