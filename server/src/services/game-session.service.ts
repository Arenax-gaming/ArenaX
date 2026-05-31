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
 * All data lives in a module-level Map so that the HTTP controller and the
 * WebSocket handler share the same session store regardless of how many times
 * GameSessionService is instantiated.
 */
const sessionStore: Map<string, GameSession> = new Map();

export class GameSessionService {
  // Expose the shared store so callers can inject a test-scoped Map if needed.
  private sessions: Map<string, GameSession> = sessionStore;

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
    this.sessions.set(id, session);
    return session;
  }

  /** Retrieve a session by ID. */
  getSession(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  /** Update the mutable part of a session's game state. */
  updateGameState(sessionId: string, newState: any): GameSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.state = { ...session.state, ...newState };
    return session;
  }

  /** Record a player action. */
  processPlayerAction(sessionId: string, playerId: string, action: any): GameSession {
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.finishedAt = Date.now();
    session.state = results; // simple assignment for demo purposes
    return session;
  }

  /** Generate a replay payload from stored actions. */
  generateReplayData(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    // Replay data is just the ordered list of actions for now.
    return session.actions;
  }
}

/** Clear the shared session store — for use in tests only. */
export const clearSessionStore = (): void => sessionStore.clear();
