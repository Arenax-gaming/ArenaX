import { Request, Response } from 'express';
import { GameSessionService } from '../services/game-session.service';

const gameSessionService = new GameSessionService();

/** POST /api/v1/games/sessions */
export const createSession = (req: Request, res: Response) => {
  const { players, gameMode, settings } = req.body;
  const session = gameSessionService.createSession(players, gameMode, settings);
  res.status(201).json(session);
};

/** GET /api/v1/games/sessions/:id */
export const getSession = (req: Request, res: Response) => {
  const { id } = req.params;
  const session = gameSessionService.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
};

/** PUT /api/v1/games/sessions/:id/state */
export const updateState = (req: Request, res: Response) => {
  const { id } = req.params;
  const { newState } = req.body;
  try {
    const session = gameSessionService.updateGameState(id, newState);
    res.json(session);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};

/** POST /api/v1/games/sessions/:id/actions */
export const submitAction = (req: Request, res: Response) => {
  const { id } = req.params;
  const { playerId, action } = req.body;
  try {
    const session = gameSessionService.processPlayerAction(id, playerId, action);
    res.json(session);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
};

/** POST /api/v1/games/sessions/:id/finish */
export const finishSession = (req: Request, res: Response) => {
  const { id } = req.params;
  const { results } = req.body;
  try {
    const session = gameSessionService.finishGame(id, results);
    res.json(session);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};

/** GET /api/v1/games/sessions/:id/replay */
export const getReplay = (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const replay = gameSessionService.generateReplayData(id);
    res.json({ replay });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};
