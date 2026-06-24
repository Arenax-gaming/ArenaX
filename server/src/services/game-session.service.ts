import { v4 as uuidv4 } from 'uuid';

export interface GameSession {
  id: string;
  players: string[];
  gameMode: string;
  settings: Record<string, any>;
  state: any;
  actions: any[];
  startedAt: number;
  finishedAt?: number;
  replayData?: any;
}

const sessionStore: Map<string, GameSession> = new Map();
const sessionLocks: Map<string, Promise<void>> = new Map();

function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(sessionId, next.then(() => {}, () => {}));
  return next;
}

const STALE_TIMEOUT_MS = 30 * 60 * 1000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessionStore) {
      if (session.finishedAt && (now - session.finishedAt) > STALE_TIMEOUT_MS) {
        sessionStore.delete(id);
        sessionLocks.delete(id);
      }
    }
    if (sessionStore.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }, 60_000);
}

startCleanupInterval();

export class GameSessionService {
  private sessions: Map<string, GameSession> = sessionStore;

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

  getSession(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  async updateGameState(sessionId: string, newState: any): Promise<GameSession> {
    return withSessionLock(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      session.state = { ...session.state, ...newState };
      return session;
    });
  }

  async processPlayerAction(sessionId: string, playerId: string, action: any): Promise<GameSession> {
    return withSessionLock(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      if (!session.players.includes(playerId)) {
        throw new Error('Player not part of this session');
      }
      session.actions.push({ playerId, action, timestamp: Date.now() });
      return session;
    });
  }

  async finishGame(sessionId: string, results: any): Promise<GameSession> {
    return withSessionLock(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      session.finishedAt = Date.now();
      session.state = results;
      return session;
    });
  }

  async generateReplayData(sessionId: string): Promise<any> {
    return withSessionLock(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      return session.actions;
    });
  }

  /**
   * Remove a session from the store and free all associated resources
   * (including its lock entry).
   *
   * Must be called when a game ends or when all players disconnect so the
   * module-level `sessionStore` Map does not grow unboundedly over the
   * server's lifetime.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    sessionLocks.delete(sessionId);
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /** Get all active sessions. */
  getActiveSessions(): GameSession[] {
    return Array.from(this.sessions.values()).filter(s => !s.finishedAt);
  }

  /** Forcefully/safely close all active sessions. */
  closeAllActiveSessions(reason: string = 'Server entering maintenance mode'): void {
    for (const session of this.getActiveSessions()) {
      this.finishGame(session.id, { error: reason, closedGracefully: true });
    }
  }
}

export const clearSessionStore = (): void => {
  sessionStore.clear();
  sessionLocks.clear();
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
};
