import { Server, Socket } from 'socket.io';
import { GameSessionService } from '../services/game-session.service';
import { logger } from '../services/logger.service';

// Module-level map: socket.id → set of joined session IDs.
// Allows a single socket to participate in multiple sessions and ensures
// the disconnect handler can clean up all of them without relying on
// per-connection closure state alone.
const socketSessions = new Map<string, Set<string>>();
const sessionSockets = new Map<string, Set<string>>();

export function initGameSocket(io: Server) {
  const gameSessionService = new GameSessionService();

  io.of('/game').on('connection', (socket: Socket) => {
    logger.info('Player connected', { socketId: socket.id });

    socket.on('join', async (sessionId: string) => {
      try {
        const session = gameSessionService.getSession(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }
        socket.join(sessionId);

        // Track this session for the socket so disconnect can clean up.
        let sessions = socketSessions.get(socket.id);
        if (!sessions) {
          sessions = new Set();
          socketSessions.set(socket.id, sessions);
        }
        sessions.add(sessionId);

        let connectedSockets = sessionSockets.get(sessionId);
        if (!connectedSockets) {
          connectedSockets = new Set();
          sessionSockets.set(sessionId, connectedSockets);
        }
        const isNewJoin = !connectedSockets.has(socket.id);
        connectedSockets.add(socket.id);

        socket.emit('joined', { sessionId });
        if (isNewJoin) {
          io.to(sessionId).emit('game:player-joined', { playerId: socket.id });
        }
      } catch (err) {
        socket.emit('error', { message: (err as Error).message });
      }
    });

    socket.on('action', async ({ sessionId, playerId, action }: { sessionId: string; playerId: string; action: unknown }) => {
      try {
        await gameSessionService.processPlayerAction(sessionId, playerId, action);
        io.to(sessionId).emit('game:action', { playerId, action, timestamp: Date.now() });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    });

    socket.on('leave', async (sessionId: string) => {
      await handleLeave(socket, io, gameSessionService, sessionId);
    });

    // Handle client disconnect — clean up all sessions this socket joined.
    socket.on('disconnect', async () => {
      logger.info('Player disconnected', { socketId: socket.id });

      const sessions = socketSessions.get(socket.id);
      if (sessions) {
        for (const sessionId of Array.from(sessions)) {
          cleanupSocketFromSession(socket, io, gameSessionService, sessionId, 'disconnect');
        }
      }
    });
  });
}

async function handleLeave(
  socket: Socket,
  io: Server,
  gameSessionService: GameSessionService,
  sessionId: string,
): Promise<void> {
  cleanupSocketFromSession(socket, io, gameSessionService, sessionId, 'leave');
}

function cleanupSocketFromSession(
  socket: Socket,
  io: Server,
  gameSessionService: GameSessionService,
  sessionId: string,
  reason: 'disconnect' | 'leave',
): void {
  socket.leave(sessionId);

  const sessions = socketSessions.get(socket.id);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      socketSessions.delete(socket.id);
    }
  }

  const connectedSockets = sessionSockets.get(sessionId);
  if (!connectedSockets) {
    return;
  }

  connectedSockets.delete(socket.id);

  if (connectedSockets.size === 0) {
    sessionSockets.delete(sessionId);
    gameSessionService.removeSession(sessionId);
    logger.info('Game session deleted (no connected sockets remaining)', { sessionId, reason });
    return;
  }

  io.to(sessionId).emit('game:player-left', { playerId: socket.id });
}
