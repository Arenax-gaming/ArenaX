import { Server, Socket } from 'socket.io';
import { GameSessionService } from '../services/game-session.service';
import { logger } from '../services/logger.service';

const socketSessions = new Map<string, Set<string>>();

export function initGameSocket(io: Server) {
  const gameSessionService = new GameSessionService();

  io.of('/game').on('connection', (socket: Socket) => {
    logger.info('Player connected', { socketId: socket.id });

    socket.on('join', async (sessionId: string) => {
      try {
        const session = await gameSessionService.getSession(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }
        socket.join(sessionId);

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
        const session = await gameSessionService.processPlayerAction(sessionId, playerId, action);
        io.to(sessionId).emit('game:action', { playerId, action, timestamp: Date.now() });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    });

    socket.on('leave', async (sessionId: string) => {
      await handleLeave(socket, io, gameSessionService, sessionId);
    });

    socket.on('disconnect', async () => {
      logger.info('Player disconnected', { socketId: socket.id });
      const sessions = socketSessions.get(socket.id);
      if (sessions) {
        for (const sessionId of sessions) {
          socket.leave(sessionId);
          io.to(sessionId).emit('game:player-left', { playerId: socket.id });
        }
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

  io.to(sessionId).emit('game:player-left', { playerId: socket.id });
}
