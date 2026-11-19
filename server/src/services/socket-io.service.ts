/**
 * #1388 — Shared Socket.IO server singleton.
 *
 * server.ts calls setSocketIOServer(io) right after creating the SocketIO
 * instance so other services (e.g. soroban-monitor.worker) can emit events
 * to users without importing server.ts (which would create a circular dep).
 */

import { Server } from 'socket.io';

let _io: Server | null = null;

export function setSocketIOServer(io: Server): void {
    _io = io;
}

export function getSocketIOServer(): Server | null {
    return _io;
}
