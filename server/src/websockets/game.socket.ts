import { Server, Socket } from 'socket.io';
import { GameSessionService } from '../services/game-session.service';
import { logger } from '../services/logger.service';

// Module-level map: socket.id → set of joined session IDs.
// Allows a single socket to participate in multiple sessions and ensures
// the disconnect handler can clean up all of them without relying on
// per-connection closure state alone.
const socketSessions = new Map<string, Set<string>>();

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

        socket.emit('joined', { sessionId });
        io.to(sessionId).emit('game:player-joined', { playerId: socket.id });
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
        for (const sessionId of sessions) {
          socket.leave(sessionId);

          const session = gameSessionService.getSession(sessionId);
          if (session) {
            // Remove this player from the session's player list.
            session.players = session.players.filter((id) => id !== socket.id);

            if (session.players.length === 0) {
              // Last player left — delete the session to free memory immediately
              // rather than waiting for the stale-session cleanup interval.
              gameSessionService.removeSession(sessionId);
              logger.info('Game session deleted (no players remaining)', { sessionId });
            } else {
              // Notify remaining players that this player left.
              io.to(sessionId).emit('game:player-left', { playerId: socket.id });
            }
          }
        }

        // Remove the socket's entry from the tracking map.
        socketSessions.delete(socket.id);
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
  socket.leave(sessionId);

  const sessions = socketSessions.get(socket.id);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      socketSessions.delete(socket.id);
    }
  }

  const session = gameSessionService.getSession(sessionId);
  if (session) {
    session.players = session.players.filter((id) => id !== socket.id);
    if (session.players.length === 0) {
      gameSessionService.removeSession(sessionId);
      logger.info('Game session deleted after explicit leave (no players remaining)', { sessionId });
    } else {
      io.to(sessionId).emit('game:player-left', { playerId: socket.id });
    }
  }
}
