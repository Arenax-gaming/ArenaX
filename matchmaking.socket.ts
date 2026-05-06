import { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';

export const setupMatchmakingHandlers = (io: Server, mmService: MatchmakingService) => {
  
  // Service Event Listeners
  mmService.on('queue:joined', ({ userId, gameMode }) => {
    io.to(`user:${userId}`).emit('matchmaking:queue', { status: 'searching', gameMode });
  });

  mmService.on('match:found', ({ matchId, players, gameMode }) => {
    players.forEach((userId: string) => {
      io.to(`user:${userId}`).emit('matchmaking:found', { 
        matchId, 
        gameMode, 
        expiresIn: 30 
      });
    });
  });

  mmService.on('matchmaking:cancelled', ({ userId, reason }) => {
    io.to(`user:${userId}`).emit('matchmaking:cancelled', { reason });
  });

  mmService.on('match:started', ({ sessionId, players }) => {
    players.forEach((userId: string) => {
      io.to(`user:${userId}`).emit('matchmaking:ready', { sessionId });
    });
  });

  // Socket Connection logic
  io.on('connection', (socket: Socket) => {
    const userId = socket.handshake.auth.userId; // Example auth
    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on('disconnect', () => {
      // Optional: Logic to handle accidental disconnects during queue
    });
  });
};