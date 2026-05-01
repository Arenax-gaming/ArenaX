import { Server, Socket } from 'socket.io';
import { matchmakingService, MatchSession, MatchInvitation } from '../services/matchmaking.service';
import { logger } from '../services/logger.service';

// WebSocket event types
export interface MatchmakingSocketEvents {
  'matchmaking:join': (data: { gameMode: string; preferences?: { region?: string; language?: string; partyId?: string } }) => void;
  'matchmaking:leave': () => void;
  'matchmaking:accept': (data: { matchId: string }) => void;
  'matchmaking:decline': (data: { matchId: string }) => void;
  'matchmaking:status': () => void;
}

// Extend Socket interface
declare module 'socket.io' {
  interface Socket {
    userId?: string;
    gameMode?: string;
  }
}

export const setupMatchmakingWebSocket = (io: Server): void => {
  const matchmakingNamespace = io.of('/matchmaking');

  matchmakingNamespace.on('connection', (socket: Socket) => {
    logger.info('New matchmaking WebSocket connection', { socketId: socket.id });

    // Authenticate user from handshake
    const userId = socket.handshake.auth.userId || socket.handshake.query.userId as string;
    
    if (!userId) {
      socket.emit('matchmaking:error', { message: 'Authentication required' });
      socket.disconnect();
      return;
    }

    socket.userId = userId;
    logger.info('User authenticated for matchmaking', { userId, socketId: socket.id });

    /**
     * Join matchmaking queue via WebSocket
     */
    socket.on('matchmaking:join', async (data: { gameMode: string; preferences?: { region?: string; language?: string; partyId?: string } }) => {
      try {
        const { gameMode, preferences } = data;
        
        if (!gameMode) {
          socket.emit('matchmaking:error', { message: 'Game mode is required' });
          return;
        }

        // Leave any existing queue first
        if (socket.gameMode) {
          await matchmakingService.leaveQueue(userId);
        }

        // Join new queue
        const result = await matchmakingService.joinQueue(userId, gameMode, preferences);
        
        if (result.success) {
          socket.gameMode = gameMode;
          socket.join(`queue:${gameMode}`);
          
          socket.emit('matchmaking:queue', {
            status: 'searching',
            gameMode,
            queuePosition: result.queuePosition,
            estimatedWaitTime: result.estimatedWaitTime,
          });

          // Notify others in the queue
          matchmakingNamespace.to(`queue:${gameMode}`).emit('matchmaking:queue', {
            status: 'update',
            gameMode,
            playersInQueue: (await matchmakingService.getQueueStatus(userId)).playersInQueue || 0,
          });

          logger.info('Player joined matchmaking queue via WebSocket', { userId, gameMode });
        } else {
          socket.emit('matchmaking:error', { message: 'Failed to join queue' });
        }
      } catch (error) {
        logger.error('Error in matchmaking:join event', { error, userId });
        socket.emit('matchmaking:error', { message: 'Internal server error' });
      }
    });

    /**
     * Leave matchmaking queue via WebSocket
     */
    socket.on('matchmaking:leave', async () => {
      try {
        const result = await matchmakingService.leaveQueue(userId);
        
        if (result.success) {
          const gameMode = socket.gameMode;
          socket.gameMode = undefined;
          
          if (gameMode) {
            socket.leave(`queue:${gameMode}`);
          }

          socket.emit('matchmaking:queue', {
            status: 'left',
            gameMode: result.gameMode,
          });

          logger.info('Player left matchmaking queue via WebSocket', { userId });
        } else {
          socket.emit('matchmaking:error', { message: 'Not in queue' });
        }
      } catch (error) {
        logger.error('Error in matchmaking:leave event', { error, userId });
        socket.emit('matchmaking:error', { message: 'Internal server error' });
      }
    });

    /**
     * Get queue status via WebSocket
     */
    socket.on('matchmaking:status', async () => {
      try {
        const status = await matchmakingService.getQueueStatus(userId);
        
        socket.emit('matchmaking:status', status);
      } catch (error) {
        logger.error('Error in matchmaking:status event', { error, userId });
        socket.emit('matchmaking:error', { message: 'Internal server error' });
      }
    });

    /**
     * Accept match invitation via WebSocket
     */
    socket.on('matchmaking:accept', async (data: { matchId: string }) => {
      try {
        const { matchId } = data;
        
        const result = await matchmakingService.acceptMatch(matchId, userId);
        
        if (result.success) {
          if (result.match) {
            // Match confirmed - notify all players
            const match = result.match;
            matchmakingNamespace.to(`match:${matchId}`).emit('matchmaking:found', {
              matchId: match.matchId,
              gameMode: match.gameMode,
              status: 'confirmed',
              players: match.players,
            });

            // Create game session room
            for (const playerId of match.players) {
              matchmakingNamespace.to(`user:${playerId}`).emit('matchmaking:ready', {
                matchId: match.matchId,
                sessionId: match.matchId,
                gameMode: match.gameMode,
                players: match.players,
                skillRatings: match.skillRatings,
              });
            }
          } else {
            socket.emit('matchmaking:accept', {
              matchId,
              status: 'waiting',
              message: 'Match accepted, waiting for other players',
            });
          }
        } else {
          socket.emit('matchmaking:error', { message: 'Failed to accept match' });
        }
      } catch (error) {
        logger.error('Error in matchmaking:accept event', { error, userId });
        socket.emit('matchmaking:error', { message: 'Internal server error' });
      }
    });

    /**
     * Decline match invitation via WebSocket
     */
    socket.on('matchmaking:decline', async (data: { matchId: string }) => {
      try {
        const { matchId } = data;
        
        const result = await matchmakingService.declineMatch(matchId, userId);
        
        if (result.success) {
          socket.emit('matchmaking:decline', {
            matchId,
            status: 'declined',
          });

          // Notify other players in the match
          matchmakingNamespace.to(`match:${matchId}`).emit('matchmaking:cancelled', {
            matchId,
            reason: 'Match declined by player',
          });
        } else {
          socket.emit('matchmaking:error', { message: 'Failed to decline match' });
        }
      } catch (error) {
        logger.error('Error in matchmaking:decline event', { error, userId });
        socket.emit('matchmaking:error', { message: 'Internal server error' });
      }
    });

    /**
     * Handle disconnect
     */
    socket.on('disconnect', async () => {
      logger.info('Matchmaking WebSocket disconnected', { userId, socketId: socket.id });
      
      // Optionally leave queue on disconnect
      if (socket.gameMode) {
        await matchmakingService.leaveQueue(userId);
        
        matchmakingNamespace.to(`queue:${socket.gameMode}`).emit('matchmaking:queue', {
          status: 'player_left',
          userId,
          gameMode: socket.gameMode,
        });
      }
    });

    /**
     * Handle errors
     */
    socket.on('error', (error) => {
      logger.error('Matchmaking WebSocket error', { error, userId, socketId: socket.id });
    });
  });

  // Helper function to emit events to specific users
  const emitToUser = (userId: string, event: string, data: any): void => {
    matchmakingNamespace.to(`user:${userId}`).emit(event, data);
  };

  // Helper function to emit events to all players in a match
  const emitToMatch = (matchId: string, event: string, data: any): void => {
    matchmakingNamespace.to(`match:${matchId}`).emit(event, data);
  };

  logger.info('Matchmaking WebSocket handlers initialized');
};

export default setupMatchmakingWebSocket;