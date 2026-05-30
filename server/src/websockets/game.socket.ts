import { Server } from 'socket.io';
import { GameSessionService } from '../services/game-session.service';

// Initialize a Socket.IO server (the HTTP server is assumed to be created elsewhere)
export function initGameSocket(io: Server) {
  const gameSessionService = new GameSessionService();

  io.of('/game').on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Join the socket to a specific game room based on session ID supplied by client
    socket.on('join', (sessionId: string) => {
      const session = gameSessionService.getSession(sessionId);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }
      socket.join(sessionId);
      socket.emit('joined', { sessionId });
      io.to(sessionId).emit('game:player-joined', { playerId: socket.id });
    });

    // Receive player actions and broadcast to other participants
    socket.on('action', ({ sessionId, playerId, action }: { sessionId: string; playerId: string; action: unknown }) => {
      try {
        const session = gameSessionService.processPlayerAction(sessionId, playerId, action);
        // Broadcast the new action to all participants
        io.to(sessionId).emit('game:action', { playerId, action, timestamp: Date.now() });
      } catch (e) {
        socket.emit('error', { message: (e as Error).message });
      }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      // Notify remaining players – the sessionId must be tracked per socket for a real impl.
      // For simplicity, we broadcast a generic event.
      io.emit('game:player-left', { playerId: socket.id });
    });
  });
}
