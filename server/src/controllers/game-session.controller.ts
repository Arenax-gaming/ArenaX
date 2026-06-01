import { Request, Response } from 'express';
import { GameSessionService } from '../services/game-session.service';

const gameSessionService = new GameSessionService();

export const createSession = (req: Request, res: Response) => {
  const { players, gameMode, settings } = req.body;
  const session = gameSessionService.createSession(players, gameMode, settings);
  res.status(201).json(session);
};

export const getSession = (req: Request, res: Response) => {
  const { id } = req.params;
  const session = gameSessionService.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
};

export const updateState = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newState } = req.body;
  try {
    const session = await gameSessionService.updateGameState(id, newState);
    res.json(session);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};

export const submitAction = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { playerId, action } = req.body;
  try {
    const session = await gameSessionService.processPlayerAction(id, playerId, action);
    res.json(session);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
};

export const finishSession = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { results } = req.body;
  try {
    const session = await gameSessionService.finishGame(id, results);
    res.json(session);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};

export const getReplay = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const replay = await gameSessionService.generateReplayData(id);
    res.json({ replay });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
};
