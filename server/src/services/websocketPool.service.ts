import { Server, Socket } from 'socket.io';
import { logger } from './logger.service';

// How long to keep a message in the offline queue before dropping it.
const MESSAGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Maximum number of queued messages per disconnected client.
const MAX_QUEUE_SIZE = 100;
// Reconnection heartbeat interval.
const HEARTBEAT_INTERVAL_MS = 30_000;
// How many missed heartbeats before the connection is considered stale.
const HEARTBEAT_TIMEOUT_INTERVALS = 2;

interface QueuedMessage {
  event: string;
  data: unknown;
  queuedAt: number;
}

interface ConnectionStats {
  socketId: string;
  userId?: string;
  connectedAt: number;
  lastSeenAt: number;
  messagesSent: number;
  rooms: Set<string>;
}

export class WebSocketPoolService {
  private _io: Server | null = null;
  // Per-user offline message queue (keyed by userId).
  private readonly _offlineQueue = new Map<string, QueuedMessage[]>();
  // Live connection tracking (keyed by socketId).
  private readonly _connections = new Map<string, ConnectionStats>();
  // userId → set of active socketIds (one user may have multiple tabs).
  private readonly _userSockets = new Map<string, Set<string>>();
  // Heartbeat timer.
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── Initialisation ─────────────────────────────────────────────────────────

  init(io: Server): void {
    this._io = io;
    this._startHeartbeat();

    io.on('connection', (socket: Socket) => {
      this._registerConnection(socket);

      socket.on('authenticate', (userId: string) => {
        this._associateUser(socket, userId);
        this._flushOfflineQueue(socket, userId);
      });

      socket.on('join_room', (room: string) => {
        socket.join(room);
        const stats = this._connections.get(socket.id);
        if (stats) stats.rooms.add(room);
        logger.info('Socket joined room', { socketId: socket.id, room });
      });

      socket.on('leave_room', (room: string) => {
        socket.leave(room);
        const stats = this._connections.get(socket.id);
        if (stats) stats.rooms.delete(room);
      });

      socket.on('pong', () => {
        const stats = this._connections.get(socket.id);
        if (stats) stats.lastSeenAt = Date.now();
      });

      socket.on('disconnect', () => {
        this._deregisterConnection(socket);
      });
    });
  }

  // ── Connection management ──────────────────────────────────────────────────

  private _registerConnection(socket: Socket): void {
    const now = Date.now();
    this._connections.set(socket.id, {
      socketId: socket.id,
      connectedAt: now,
      lastSeenAt: now,
      messagesSent: 0,
      rooms: new Set(),
    });
    logger.info('WebSocket connected', { socketId: socket.id, total: this._connections.size });
  }

  private _associateUser(socket: Socket, userId: string): void {
    const stats = this._connections.get(socket.id);
    if (stats) stats.userId = userId;

    let sockets = this._userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this._userSockets.set(userId, sockets);
    }
    sockets.add(socket.id);

    logger.info('Socket authenticated', { socketId: socket.id, userId });
  }

  private _deregisterConnection(socket: Socket): void {
    const stats = this._connections.get(socket.id);
    if (stats?.userId) {
      const sockets = this._userSockets.get(stats.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) this._userSockets.delete(stats.userId);
      }
    }
    this._connections.delete(socket.id);
    logger.info('WebSocket disconnected', { socketId: socket.id, total: this._connections.size });
  }

  // ── Message delivery ────────────────────────────────────────────────────────

  /**
   * Send an event to a specific user. If the user has no active connections,
   * queue the message for delivery on reconnect.
   */
  sendToUser(userId: string, event: string, data: unknown): boolean {
    const sockets = this._userSockets.get(userId);
    if (sockets && sockets.size > 0) {
      for (const socketId of sockets) {
        this._io?.to(socketId).emit(event, data);
        const stats = this._connections.get(socketId);
        if (stats) stats.messagesSent++;
      }
      return true;
    }
    // User offline — queue message.
    this._enqueue(userId, event, data);
    return false;
  }

  /** Broadcast to a room. Never queues; rooms are ephemeral. */
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this._io?.to(room).emit(event, data);
  }

  /** Broadcast to all connected clients. */
  broadcastToAll(event: string, data: unknown): void {
    this._io?.emit(event, data);
  }

  // ── Offline queue ───────────────────────────────────────────────────────────

  private _enqueue(userId: string, event: string, data: unknown): void {
    let queue = this._offlineQueue.get(userId);
    if (!queue) {
      queue = [];
      this._offlineQueue.set(userId, queue);
    }
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Drop the oldest message to make room.
      queue.shift();
    }
    queue.push({ event, data, queuedAt: Date.now() });
  }

  private _flushOfflineQueue(socket: Socket, userId: string): void {
    const queue = this._offlineQueue.get(userId);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    const fresh = queue.filter((m) => now - m.queuedAt < MESSAGE_TTL_MS);
    this._offlineQueue.delete(userId);

    const dropped = queue.length - fresh.length;
    if (dropped > 0) {
      logger.info('Dropped stale queued messages', { userId, dropped });
    }

    for (const msg of fresh) {
      socket.emit(msg.event, msg.data);
    }
    if (fresh.length > 0) {
      logger.info('Flushed offline queue', { userId, count: fresh.length });
    }
  }

  // ── Heartbeat / stale connection cleanup ────────────────────────────────────

  private _startHeartbeat(): void {
    this._heartbeatTimer = setInterval(() => {
      const staleThreshold = Date.now() - HEARTBEAT_INTERVAL_MS * HEARTBEAT_TIMEOUT_INTERVALS;
      for (const [socketId, stats] of this._connections) {
        if (stats.lastSeenAt < staleThreshold) {
          logger.warn('Disconnecting stale WebSocket', { socketId, userId: stats.userId });
          this._io?.sockets.sockets.get(socketId)?.disconnect(true);
        } else {
          this._io?.to(socketId).emit('ping');
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // ── Analytics ───────────────────────────────────────────────────────────────

  getStats() {
    return {
      totalConnections: this._connections.size,
      uniqueUsers: this._userSockets.size,
      offlineQueueSize: Array.from(this._offlineQueue.values()).reduce(
        (sum, q) => sum + q.length,
        0,
      ),
    };
  }

  destroy(): void {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    this._connections.clear();
    this._userSockets.clear();
    this._offlineQueue.clear();
  }
}

export const webSocketPool = new WebSocketPoolService();
