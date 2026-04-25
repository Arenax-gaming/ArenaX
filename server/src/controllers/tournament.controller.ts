import { Request, Response, NextFunction } from 'express';
import { TournamentService } from '../services/tournament.service';
import { TournamentFormat, TournamentStatus } from '@prisma/client';

const tournamentService = new TournamentService();

export class TournamentController {
  /**
   * POST /api/v1/tournaments - Create new tournament
   */
  async createTournament(req: Request, res: Response, next: NextFunction) {
    try {
      const organizerId = req.user?.id;
      if (!organizerId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const {
        name,
        description,
        format,
        gameId,
        gameMode,
        maxPlayers,
        minPlayers,
        entryFee,
        prizePool,
        prizeDistribution,
        registrationStart,
        registrationEnd,
        startDate,
        endDate,
        checkInWindow,
        settings,
      } = req.body;

      // Validate required fields
      if (!name || !format || !gameId || !gameMode || !maxPlayers) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['name', 'format', 'gameId', 'gameMode', 'maxPlayers'],
        });
        return;
      }

      // Validate format
      if (!Object.values(TournamentFormat).includes(format)) {
        res.status(400).json({
          error: 'Invalid tournament format',
          validFormats: Object.values(TournamentFormat),
        });
        return;
      }

      const tournament = await tournamentService.createTournament(organizerId, {
        name,
        description,
        format,
        gameId,
        gameMode,
        maxPlayers,
        minPlayers,
        entryFee,
        prizePool,
        prizeDistribution,
        registrationStart: new Date(registrationStart),
        registrationEnd: new Date(registrationEnd),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : undefined,
        checkInWindow,
        settings,
      });

      res.status(201).json({
        success: true,
        data: tournament,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/tournaments - List tournaments
   */
  async listTournaments(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, gameId, format, page, limit } = req.query;

      const filters: any = {
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 20,
      };

      if (status) {
        filters.status = status as TournamentStatus;
      }
      if (gameId) {
        filters.gameId = gameId as string;
      }
      if (format) {
        filters.format = format as TournamentFormat;
      }

      const result = await tournamentService.listTournaments(filters);

      res.json({
        success: true,
        data: result.tournaments,
        pagination: result.pagination,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/tournaments/:id - Get tournament details
   */
  async getTournament(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const tournament = await tournamentService.getTournament(id);

      if (!tournament) {
        res.status(404).json({ error: 'Tournament not found' });
        return;
      }

      res.json({
        success: true,
        data: tournament,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * POST /api/v1/tournaments/:id/register - Register for tournament
   */
  async registerPlayer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const playerId = req.user?.id;

      if (!playerId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const registration = await tournamentService.registerPlayer(id, playerId);

      res.status(201).json({
        success: true,
        data: registration,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * POST /api/v1/tournaments/:id/check-in - Tournament check-in
   */
  async checkIn(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const playerId = req.user?.id;

      if (!playerId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const participant = await tournamentService.checkInPlayer(id, playerId);

      res.json({
        success: true,
        data: participant,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/tournaments/:id/bracket - Get tournament bracket
   */
  async getBracket(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const bracket = await tournamentService.getTournamentBracket(id);

      res.json({
        success: true,
        data: bracket,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * POST /api/v1/tournaments/:id/report-result - Report match result
   */
  async reportResult(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { matchId, playerAScore, playerBScore, winnerId, resultType } = req.body;

      if (!matchId || winnerId === undefined) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['matchId', 'playerAScore', 'playerBScore', 'winnerId', 'resultType'],
        });
        return;
      }

      const match = await tournamentService.handleMatchResult(id, matchId, {
        matchId,
        playerAScore,
        playerBScore,
        winnerId,
        resultType,
      });

      res.json({
        success: true,
        data: match,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /api/v1/tournaments/:id/standings - Get tournament standings
   */
  async getStandings(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const standings = await tournamentService.calculateStandings(id);

      res.json({
        success: true,
        data: standings,
      });
    } catch (error: any) {
      next(error);
    }
  }
}

export default new TournamentController();
