/**
 * WebSocket Connection Manager — Issue #697
 *
 * Features:
 * - Automatic reconnect with exponential back-off + jitter
 * - Heartbeat / ping-pong keep-alive
 * - Connection status indicators: connected | connecting | reconnecting | offline
 * - Auth token injection on connect
 * - Event-typed message dispatch
 * - Analytics hooks for connection lifecycle events
 */

"use client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline" | "closed";

export interface WsMessage<T = unknown> {
  /** Message category / event name */
  type: string;
  payload: T;
  /** Server-assigned message ID (optional) */
  id?: string;
  timestamp: number;
}

export interface WsConnectionConfig {
  url: string;
  /** JWT token for auth handshake */
  getToken?: () => string | null;
  /** Heartbeat interval in ms (default: 30 000) */
  heartbeatIntervalMs?: number;
  /** Max reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Base reconnect delay in ms (default: 1 000) */
  reconnectBaseDelayMs?: number;
  /** Max reconnect delay cap in ms (default: 30 000) */
  reconnectMaxDelayMs?: number;
  /** Called when a message arrives */
  onMessage?: (msg: WsMessage) => void;
  /** Called on connection status change */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Called when permanently disconnected (maxRetries exceeded) */
  onPermanentDisconnect?: () => void;
}

export interface ConnectionMetrics {
  connectedAt: number | null;
  disconnections: number;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesSent: number;
  lastHeartbeatAt: number | null;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface WsAnalyticsEvent {
  type: string;
  detail?: string;
  timestamp: number;
}

const _wsEvents: WsAnalyticsEvent[] = [];

function trackWsEvent(type: string, detail?: string): void {
  _wsEvents.unshift({ type, detail, timestamp: Date.now() });
  if (_wsEvents.length > 200) _wsEvents.length = 200;
}

export function getWsEvents(): readonly WsAnalyticsEvent[] {
  return _wsEvents;
}

export function clearWsEvents(): void {
  _wsEvents.length = 0;
}

// ─── Connection Manager ───────────────────────────────────────────────────────

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitClose = false;

  private readonly metrics: ConnectionMetrics = {
    connectedAt: null,
    disconnections: 0,
    reconnectAttempts: 0,
    messagesReceived: 0,
    messagesSent: 0,
    lastHeartbeatAt: null,
  };

  private readonly config: Required<WsConnectionConfig>;

  constructor(config: WsConnectionConfig) {
    this.config = {
      getToken: () => null,
      heartbeatIntervalMs: 30_000,
      maxReconnectAttempts: 10,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
      onMessage: () => {},
      onStatusChange: () => {},
      onPermanentDisconnect: () => {},
      ...config,
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    this.explicitClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.explicitClose = true;
    this.cleanup();
    this.setStatus("closed");
    trackWsEvent("explicit_disconnect");
  }

  send<T>(type: string, payload: T): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      const msg: WsMessage<T> = { type, payload, timestamp: Date.now() };
      this.ws.send(JSON.stringify(msg));
      this.metrics.messagesSent++;
      return true;
    } catch {
      return false;
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getMetrics(): Readonly<ConnectionMetrics> {
    return { ...this.metrics };
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private openSocket(): void {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    trackWsEvent("connecting", this.config.url);

    let url = this.config.url;
    const token = this.config.getToken();
    if (token) {
      // Append token as query param for WS (Authorization header not supported in browser WS)
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}token=${encodeURIComponent(token)}`;
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      trackWsEvent("open_error", String(err));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.metrics.connectedAt = Date.now();
      this.setStatus("connected");
      this.startHeartbeat();
      trackWsEvent("connected", this.config.url);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.metrics.messagesReceived++;
      try {
        const data = JSON.parse(event.data as string) as WsMessage;

        // Handle server pong (keep-alive response)
        if (data.type === "pong" || data.type === "heartbeat") {
          this.metrics.lastHeartbeatAt = Date.now();
          if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
          return;
        }

        this.config.onMessage(data);
      } catch {
        // Non-JSON frame — ignore
      }
    };

    this.ws.onerror = () => {
      // onerror fires before onclose — log but don't reconnect here
      trackWsEvent("socket_error");
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      this.metrics.disconnections++;
      trackWsEvent("disconnected", `code=${event.code}`);

      if (this.explicitClose) {
        this.setStatus("closed");
        return;
      }

      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.setStatus("offline");
      trackWsEvent("permanent_disconnect", `attempts=${this.reconnectAttempt}`);
      this.config.onPermanentDisconnect();
      return;
    }

    const delay = this.calcDelay(this.reconnectAttempt);
    this.reconnectAttempt++;
    this.metrics.reconnectAttempts++;
    this.setStatus("reconnecting");
    trackWsEvent("reconnect_scheduled", `attempt=${this.reconnectAttempt} delay=${delay}`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private calcDelay(attempt: number): number {
    const jitter = Math.random() * 500;
    const delay = this.config.reconnectBaseDelayMs * Math.pow(2, attempt) + jitter;
    return Math.min(delay, this.config.reconnectMaxDelayMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          this.metrics.lastHeartbeatAt = Date.now();

          // If no pong within 10 s, force reconnect
          this.pongTimer = setTimeout(() => {
            trackWsEvent("heartbeat_timeout");
            this.ws?.close(4000, "Heartbeat timeout");
          }, 10_000);
        } catch {
          // ignore send errors
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Explicit disconnect");
      }
      this.ws = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.config.onStatusChange(status);
  }
}
