import { Request, Response } from 'express';
import { matchmakingService, PlayerPreferences } from '../services/matchmaking.service';
import { logger } from '../services/logger.service';
import { authenticateJWT } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { z } from 'zod';

// Validation schemas
const joinQueueSchema = z.object({
  gameMode: z.string().min(1),
  preferences: z.object({
    region: z.string().optional(),
    language: z.string().optional(),
    partyId: z.string().optional(),
  }).optional(),
});

const acceptMatchSchema = z.object({
  matchId: z.string().uuid(),
});

const declineMatchSchema = z.object({
  matchId: z.string().uuid(),
});

const historyQuerySchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 20),
  offset: z.string().optional().transform(val => val ? parseInt(val, 10) : 0),
});

// Middleware wrapper for authentication
const authenticate = [authenticateJWT];

/**
 * POST /api/v1/matchmaking/queue
 * Join matchmaking queue
 */
export const joinQueue = [
  ...authenticate,
  validateRequest(joinQueueSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { gameMode, preferences } = req.body;
      
      const result = await matchmakingService.joinQueue(
        userId,
        gameMode,
        preferences as PlayerPreferences
      );

      if (result.success) {
        res.status(200).json({
          success: true,
          queuePosition: result.queuePosition,
          estimatedWaitTime: result.estimatedWaitTime,
          gameMode,
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Failed to join queue',
        });
      }
    } catch (error) {
      logger.error('Error in join queue endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * DELETE /api/v1/matchmaking/queue
 * Leave matchmaking queue
 */
export const leaveQueue = [
  ...authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await matchmakingService.leaveQueue(userId);

      if (result.success) {
        res.status(200).json({
          success: true,
          gameMode: result.gameMode,
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Not in queue',
        });
      }
    } catch (error) {
      logger.error('Error in leave queue endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * GET /api/v1/matchmaking/status
 * Get queue status
 */
export const getQueueStatus = [
  ...authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const status = await matchmakingService.getQueueStatus(userId);

      res.status(200).json(status);
    } catch (error) {
      logger.error('Error in get queue status endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * POST /api/v1/matchmaking/accept
 * Accept match invitation
 */
export const acceptMatch = [
  ...authenticate,
  validateRequest(acceptMatchSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { matchId } = req.body;
      
      const result = await matchmakingService.acceptMatch(matchId, userId);

      if (result.success) {
        if (result.match) {
          res.status(200).json({
            success: true,
            match: result.match,
          });
        } else {
          res.status(200).json({
            success: true,
            message: 'Match accepted, waiting for other players',
          });
        }
      } else {
        res.status(400).json({
          success: false,
          error: 'Failed to accept match',
        });
      }
    } catch (error) {
      logger.error('Error in accept match endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * POST /api/v1/matchmaking/decline
 * Decline match invitation
 */
export const declineMatch = [
  ...authenticate,
  validateRequest(declineMatchSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { matchId } = req.body;
      
      const result = await matchmakingService.declineMatch(matchId, userId);

      if (result.success) {
        res.status(200).json({
          success: true,
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Failed to decline match',
        });
      }
    } catch (error) {
      logger.error('Error in decline match endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * GET /api/v1/matchmaking/history
 * Get match history
 */
export const getMatchHistory = [
  ...authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const query = historyQuerySchema.parse(req.query);
      const history = await matchmakingService.getMatchHistory(
        userId,
        query.limit,
        query.offset
      );

      res.status(200).json({
        success: true,
        history,
        limit: query.limit,
        offset: query.offset,
      });
    } catch (error) {
      logger.error('Error in get match history endpoint', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
];

/**
 * GET /api/v1/matchmaking/stats
 * Get matchmaking statistics (admin)
 */
export const getMatchmakingStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = matchmakingService.getQueueStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    logger.error('Error in get matchmaking stats endpoint', { error });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

// Default export for router
export default {
  joinQueue,
  leaveQueue,
  getQueueStatus,
  acceptMatch,
  declineMatch,
  getMatchHistory,
  getMatchmakingStats,
};