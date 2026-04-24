import { Request, Response, NextFunction } from 'express';
import gameSessionService from '../services/game-session.service';
import { GameSessionType } from '@prisma/client';

export class GameSessionController {
  /**
   * POST /api/v1/games/sessions - Create new game session
   */
  async createSession(req: Request, res: Response, next: NextFunction) {
    try {
      const hostId = req.user?.id;
      if (!hostId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { gameId, gameMode, sessionType, maxPlayers, minPlayers, settings } = req.body;

      if (!gameId || !gameMode) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['gameId', 'gameMode'],
        });
        return;
      }

      const session = await gameSessionService.createSession(hostId, {
        gameId,
        gameMode,
        sessionType: sessionType || GameSessionType.CASUAL,
        maxPlayers,
        minPlayers,
        settings,
      });

      res.status(201).json({ success: true, data: session });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/games/sessions/:id - Get session details
   */
  async getSession(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const session = await gameSessionService.getSession(id);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ success: true, data: session });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/games/sessions/:id/state - Update game state
   */
  async updateState(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const playerId = req.user?.id;
      const { state } = req.body;

      if (!state) {
        res.status(400).json({ error: 'State is required' });
        return;
      }

      const updated = await gameSessionService.updateGameState(id, state, playerId);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * POST /api/v1/games/sessions/:id/actions - Submit player action
   */
  async submitAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const playerId = req.user?.id;

      if (!playerId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { actionType, data } = req.body;

      if (!actionType) {
        res.status(400).json({ error: 'Action type is required' });
        return;
      }

      const action = await gameSessionService.processPlayerAction(id, playerId, {
        actionType,
        data: data || {},
      });

      res.json({ success: true, data: action });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * POST /api/v1/games/sessions/:id/finish - End game session
   */
  async finishGame(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { results } = req.body;

      if (!results || !Array.isArray(results)) {
        res.status(400).json({ error: 'Results array is required' });
        return;
      }

      const result = await gameSessionService.finishGame(id, results);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/games/sessions/:id/replay - Get replay data
   */
  async getReplay(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const replayData = await gameSessionService.getReplayData(id);
      res.json({ success: true, data: replayData });
    } catch (error: any) {
      next(error);
    }
  }
}

export default new GameSessionController();
