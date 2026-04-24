import { PrismaClient, GameSessionStatus, GameSessionType } from '@prisma/client';
import { logger } from './logger.service';

const prisma = new PrismaClient();

export interface GameSessionConfig {
  gameId: string;
  gameMode: string;
  sessionType?: GameSessionType;
  maxPlayers?: number;
  minPlayers?: number;
  settings?: Record<string, any>;
}

export interface GameState {
  [key: string]: any;
}

export interface PlayerAction {
  actionType: string;
  data: Record<string, any>;
  timestamp?: Date;
}

export interface GameResult {
  playerId: string;
  score: number;
  rank: number;
  ratingChange?: number;
}

export class GameSessionService {
  /**
   * Create a new game session
   */
  async createSession(hostId: string, config: GameSessionConfig) {
    try {
      const session = await prisma.gameSession.create({
        data: {
          gameId: config.gameId,
          gameMode: config.gameMode,
          sessionType: config.sessionType || GameSessionType.CASUAL,
          hostId,
          maxPlayers: config.maxPlayers || 2,
          minPlayers: config.minPlayers || 2,
          settings: config.settings || {},
          status: GameSessionStatus.WAITING_FOR_PLAYERS,
        },
        include: {
          host: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      // Add host as first player
      await prisma.gameSessionPlayer.create({
        data: {
          sessionId: session.id,
          userId: hostId,
          playerNumber: 1,
          status: 'ACTIVE',
        },
      });

      // Record event
      await this.recordEvent(session.id, 'SESSION_CREATED', {
        hostId,
        config,
      });

      logger.info('Game session created', {
        sessionId: session.id,
        hostId,
        gameId: config.gameId,
      });

      return session;
    } catch (error) {
      logger.error('Failed to create game session', { error, hostId, config });
      throw error;
    }
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          host: {
            select: {
              id: true,
              username: true,
            },
          },
          players: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          _count: {
            select: {
              actions: true,
              events: true,
            },
          },
        },
      });

      return session;
    } catch (error) {
      logger.error('Failed to get session', { error, sessionId });
      throw error;
    }
  }

  /**
   * Update game state
   */
  async updateGameState(sessionId: string, newState: GameState, playerId?: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status !== GameSessionStatus.IN_PROGRESS) {
        throw new Error('Session is not in progress');
      }

      const updated = await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          currentState: newState,
        },
      });

      // Record state change event
      await this.recordEvent(sessionId, 'STATE_CHANGE', {
        playerId,
        stateKeys: Object.keys(newState),
      });

      return updated;
    } catch (error) {
      logger.error('Failed to update game state', { error, sessionId });
      throw error;
    }
  }

  /**
   * Process player action
   */
  async processPlayerAction(sessionId: string, playerId: string, action: PlayerAction) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          players: {
            where: { userId: playerId },
          },
        },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status !== GameSessionStatus.IN_PROGRESS) {
        throw new Error('Session is not in progress');
      }

      const player = session.players[0];
      if (!player) {
        throw new Error('Player not found in session');
      }

      if (player.status === 'DISCONNECTED') {
        throw new Error('Player is disconnected');
      }

      // Validate action
      const isValid = await this.validateGameRules(sessionId, action, player);
      if (!isValid) {
        throw new Error('Invalid action - violates game rules');
      }

      // Record action
      const recordedAction = await prisma.gameSessionAction.create({
        data: {
          sessionId,
          playerId: player.id,
          actionType: action.actionType,
          data: action.data,
          timestamp: action.timestamp || new Date(),
          validated: true,
        },
      });

      // Record event
      await this.recordEvent(sessionId, 'PLAYER_ACTION', {
        playerId,
        actionType: action.actionType,
      });

      logger.debug('Player action processed', {
        sessionId,
        playerId,
        actionType: action.actionType,
      });

      return recordedAction;
    } catch (error) {
      logger.error('Failed to process player action', { error, sessionId, playerId });
      throw error;
    }
  }

  /**
   * Validate game rules for an action
   */
  async validateGameRules(sessionId: string, action: PlayerAction, player: any): Promise<boolean> {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) return false;

      const settings = session.settings as Record<string, any>;

      // Basic validation - can be extended with game-specific rules
      switch (action.actionType) {
        case 'MOVE':
          // Validate move is within bounds
          return true;
        case 'ATTACK':
          // Validate attack target and range
          return true;
        case 'USE_ITEM':
          // Validate item availability
          return true;
        case 'CHAT':
          // Validate message length and content
          const message = action.data.message as string;
          return !!(message && message.length <= 500);
        default:
          return true;
      }
    } catch (error) {
      logger.error('Failed to validate game rules', { error, sessionId });
      return false;
    }
  }

  /**
   * Finish game session
   */
  async finishGame(sessionId: string, results: GameResult[]) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status === GameSessionStatus.COMPLETED) {
        throw new Error('Session already completed');
      }

      const startedAt = session.startedAt || session.createdAt;
      const endedAt = new Date();
      const duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

      // Generate replay data
      const replayData = await this.generateReplayData(sessionId);

      // Update session
      await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          status: GameSessionStatus.COMPLETED,
          endedAt,
          duration,
          replayData,
        },
      });

      // Update player results
      for (const result of results) {
        const player = await prisma.gameSessionPlayer.findFirst({
          where: {
            sessionId,
            userId: result.playerId,
          },
        });

        if (player) {
          await prisma.gameSessionPlayer.update({
            where: { id: player.id },
            data: {
              score: result.score,
              rank: result.rank,
              ratingChange: result.ratingChange || 0,
              rating: result.ratingChange
                ? { increment: result.ratingChange }
                : undefined,
            },
          });
        }
      }

      // Record event
      await this.recordEvent(sessionId, 'GAME_COMPLETED', {
        results,
        duration,
      });

      logger.info('Game session completed', {
        sessionId,
        duration,
        playerCount: results.length,
      });

      return {
        sessionId,
        duration,
        results,
        replayData,
      };
    } catch (error) {
      logger.error('Failed to finish game', { error, sessionId });
      throw error;
    }
  }

  /**
   * Generate replay data from session actions
   */
  async generateReplayData(sessionId: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          players: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          actions: {
            orderBy: { timestamp: 'asc' },
          },
        },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      const replayData = {
        sessionId: session.id,
        gameId: session.gameId,
        gameMode: session.gameMode,
        initialState: session.initialState,
        settings: session.settings,
        players: session.players.map((p) => ({
          userId: p.userId,
          username: p.user.username,
          playerNumber: p.playerNumber,
        })),
        actions: session.actions.map((a) => ({
          playerId: a.playerId,
          actionType: a.actionType,
          data: a.data,
          timestamp: a.timestamp,
        })),
        duration: session.duration,
        createdAt: session.createdAt,
      };

      return replayData;
    } catch (error) {
      logger.error('Failed to generate replay data', { error, sessionId });
      throw error;
    }
  }

  /**
   * Get replay data for a session
   */
  async getReplayData(sessionId: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          replayData: true,
          initialState: true,
          settings: true,
          players: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      return session.replayData || session.initialState;
    } catch (error) {
      logger.error('Failed to get replay data', { error, sessionId });
      throw error;
    }
  }

  /**
   * Player join session
   */
  async joinSession(sessionId: string, userId: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          players: true,
        },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status !== GameSessionStatus.WAITING_FOR_PLAYERS) {
        throw new Error('Cannot join - session is not waiting for players');
      }

      if (session.players.length >= session.maxPlayers) {
        throw new Error('Session is full');
      }

      // Check if already joined
      const existing = session.players.find((p) => p.userId === userId);
      if (existing) {
        throw new Error('Already joined this session');
      }

      const playerNumber = session.players.length + 1;

      const player = await prisma.gameSessionPlayer.create({
        data: {
          sessionId,
          userId,
          playerNumber,
          status: 'ACTIVE',
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      // Record event
      await this.recordEvent(sessionId, 'PLAYER_JOIN', {
        userId,
        playerNumber,
      });

      // Check if session can start
      if (session.players.length + 1 >= session.minPlayers) {
        await this.startSession(sessionId);
      }

      logger.info('Player joined session', {
        sessionId,
        userId,
        playerNumber,
      });

      return player;
    } catch (error) {
      logger.error('Failed to join session', { error, sessionId, userId });
      throw error;
    }
  }

  /**
   * Start game session
   */
  async startSession(sessionId: string) {
    try {
      const session = await prisma.gameSession.findUnique({
        where: { id: sessionId },
        include: {
          players: true,
        },
      });

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.players.length < session.minPlayers) {
        throw new Error('Not enough players to start');
      }

      const updated = await prisma.gameSession.update({
        where: { id: sessionId },
        data: {
          status: GameSessionStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });

      // Record event
      await this.recordEvent(sessionId, 'GAME_START', {
        playerCount: session.players.length,
      });

      logger.info('Game session started', {
        sessionId,
        playerCount: session.players.length,
      });

      return updated;
    } catch (error) {
      logger.error('Failed to start session', { error, sessionId });
      throw error;
    }
  }

  /**
   * Handle player disconnect
   */
  async handleDisconnect(sessionId: string, userId: string) {
    try {
      const player = await prisma.gameSessionPlayer.findFirst({
        where: {
          sessionId,
          userId,
        },
      });

      if (!player) return;

      await prisma.gameSessionPlayer.update({
        where: { id: player.id },
        data: {
          status: 'DISCONNECTED',
          disconnectedAt: new Date(),
        },
      });

      await this.recordEvent(sessionId, 'PLAYER_DISCONNECT', {
        userId,
      });

      logger.info('Player disconnected', { sessionId, userId });
    } catch (error) {
      logger.error('Failed to handle disconnect', { error, sessionId, userId });
    }
  }

  /**
   * Handle player reconnect
   */
  async handleReconnect(sessionId: string, userId: string) {
    try {
      const player = await prisma.gameSessionPlayer.findFirst({
        where: {
          sessionId,
          userId,
          status: 'DISCONNECTED',
        },
      });

      if (!player) {
        throw new Error('Player not found or not disconnected');
      }

      await prisma.gameSessionPlayer.update({
        where: { id: player.id },
        data: {
          status: 'ACTIVE',
          reconnectedAt: new Date(),
        },
      });

      await this.recordEvent(sessionId, 'PLAYER_RECONNECT', {
        userId,
      });

      logger.info('Player reconnected', { sessionId, userId });
    } catch (error) {
      logger.error('Failed to handle reconnect', { error, sessionId, userId });
      throw error;
    }
  }

  /**
   * Record session event
   */
  private async recordEvent(sessionId: string, eventType: string, data: Record<string, any>) {
    try {
      await prisma.gameSessionEvent.create({
        data: {
          sessionId,
          eventType,
          data,
        },
      });
    } catch (error) {
      logger.error('Failed to record event', { error, sessionId, eventType });
    }
  }
}

export default new GameSessionService();
