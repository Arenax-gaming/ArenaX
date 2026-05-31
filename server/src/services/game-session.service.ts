import { v4 as uuidv4 } from 'uuid';

/**
 * Types for game session management.
 */
export interface GameSession {
  id: string;
  players: string[]; // player IDs
  gameMode: string;
  settings: Record<string, any>;
  state: any; // can be any serializable object representing the game state
  actions: any[]; // list of actions applied
  startedAt: number;
  finishedAt?: number;
  replayData?: any;
}

/**
 * In‑memory service handling game sessions.
 * This implementation purposefully avoids any external dependencies to keep the change minimal
 * and merge‑safe. All data lives in a Map keyed by the session ID.
 */
export class GameSessionService {
  private static sessions: Map<string, GameSession> = new Map();

  /** Create a new game session. */
  createSession(players: string[], gameMode: string, settings: Record<string, any> = {}): GameSession {
    const id = uuidv4();
    const session: GameSession = {
      id,
      players,
      gameMode,
      settings,
      state: {},
      actions: [],
      startedAt: Date.now(),
    };
    GameSessionService.sessions.set(id, session);
    return session;
  }

  /** Retrieve a session by ID. */
  getSession(id: string): GameSession | undefined {
    return GameSessionService.sessions.get(id);
  }

  /** Update the mutable part of a session's game state. */
  updateGameState(sessionId: string, newState: any): GameSession {
    const session = GameSessionService.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.state = { ...session.state, ...newState };
    return session;
  }

  /** Record a player action. */
  processPlayerAction(sessionId: string, playerId: string, action: any): GameSession {
    const session = GameSessionService.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    // Basic validation – ensure the player belongs to the session.
    if (!session.players.includes(playerId)) {
      throw new Error('Player not part of this session');
    }
    // Store the raw action; real implementation would include anti‑cheat logic.
    session.actions.push({ playerId, action, timestamp: Date.now() });
    return session;
  }

  /** Finish a session and optionally store the final results. */
  finishGame(sessionId: string, results: any): GameSession {
    const session = GameSessionService.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.finishedAt = Date.now();
    session.state = results; // simple assignment for demo purposes
    return session;
  }

  /** Generate a replay payload from stored actions. */
  generateReplayData(sessionId: string): any {
    const session = GameSessionService.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    // Replay data is just the ordered list of actions for now.
    return session.actions;
  }

  /** Get all active sessions. */
  getActiveSessions(): GameSession[] {
    return Array.from(GameSessionService.sessions.values()).filter(s => !s.finishedAt);
  }

  /** Forcefully/safely close all active sessions. */
  closeAllActiveSessions(reason: string = 'Server entering maintenance mode'): void {
    for (const session of this.getActiveSessions()) {
      this.finishGame(session.id, { error: reason, closedGracefully: true });
    }
  }
}
