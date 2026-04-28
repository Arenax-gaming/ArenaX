import { Request, Response } from 'express';
import { MatchmakingService } from '../services/matchmaking.service';

export class MatchmakingController {
  constructor(private matchmakingService: MatchmakingService) {}

  joinQueue = async (req: Request, res: Response) => {
    try {
      const { gameMode, preferences } = req.body;
      const userId = req.user.id; // From Auth Middleware
      
      // Fetch current ELO from DB (simplified)
      const elo = 1200; 
      
      await this.matchmakingService.joinQueue(userId, gameMode, elo, preferences);
      res.status(202).json({ message: 'Joined queue' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  leaveQueue = async (req: Request, res: Response) => {
    try {
      const { gameMode } = req.body;
      await this.matchmakingService.leaveQueue(req.user.id, gameMode);
      res.status(200).json({ message: 'Left queue' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  getStatus = async (req: Request, res: Response) => {
    try {
      const status = await this.matchmakingService.getQueueStatus(req.user.id);
      res.status(200).json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  acceptMatch = async (req: Request, res: Response) => {
    try {
      const { matchId } = req.body;
      await this.matchmakingService.acceptMatch(matchId, req.user.id);
      res.status(200).json({ message: 'Match accepted' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  declineMatch = async (req: Request, res: Response) => {
    try {
      const { matchId } = req.body;
      await this.matchmakingService.declineMatch(matchId, req.user.id);
      res.status(200).json({ message: 'Match declined' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  getHistory = async (req: Request, res: Response) => {
    // Implementation: Fetch from PostgreSQL MatchHistory table
    res.status(200).json({ history: [] });
  };
}