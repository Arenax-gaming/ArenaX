import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.service';
import { CacheService } from './cache.service';

// Types for matchmaking
export interface PlayerPreferences {
  region?: string;
  language?: string;
  partyId?: string;
}

export interface QueueEntry {
  userId: string;
  gameMode: string;
  skillRating: number;
  preferences: PlayerPreferences;
  joinedAt: number;
  isPremium: boolean;
  partyId?: string;
}

export interface MatchSession {
  matchId: string;
  gameMode: string;
  players: string[];
  skillRatings: Record<string, number>;
  createdAt: number;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  region?: string;
}

export interface MatchInvitation {
  matchId: string;
  players: string[];
  expiresAt: number;
  acceptedBy: string[];
  declinedBy: string[];
}

export interface MatchHistoryEntry {
  matchId: string;
  userId: string;
  gameMode: string;
  skillRating: number;
  result: 'win' | 'loss' | 'draw';
  timestamp: number;
  teammates?: string[];
  opponents?: string[];
}

// Game mode configurations
const GAME_MODES: Record<string, { minPlayers: number; maxPlayers: number; teamSize: number }> = {
  '1v1': { minPlayers: 2, maxPlayers: 2, teamSize: 1 },
  '2v2': { minPlayers: 4, maxPlayers: 4, teamSize: 2 },
  '3v3': { minPlayers: 6, maxPlayers: 6, teamSize: 3 },
  '5v5': { minPlayers: 10, maxPlayers: 10, teamSize: 5 },
  'battle-royale': { minPlayers: 50, maxPlayers: 100, teamSize: 1 },
};

// Skill rating constants
const ELO_K_FACTOR = 32;
const ELO_DEFAULT_RATING = 1000;
const SKILL_RANGE_DEFAULT = 200;
const QUEUE_TIMEOUT_MS = 120000; // 2 minutes
const INVITATION_TIMEOUT_MS = 30000; // 30 seconds

export class MatchmakingService {
  private queues: Map<string, QueueEntry[]> = new Map();
  private matchInvitations: Map<string, MatchInvitation> = new Map();
  private matchHistory: Map<string, MatchHistoryEntry[]> = new Map();
  private playerSkillRatings: Map<string, number> = new Map();
  private cacheService: CacheService;
  private matchQualityThreshold: number = 0.7;

  constructor() {
    this.cacheService = new CacheService(300);
    this.initializeQueues();
    this.startQueueCleanup();
  }

  private initializeQueues(): void {
    for (const mode of Object.keys(GAME_MODES)) {
      this.queues.set(mode, []);
    }
  }

  private startQueueCleanup(): void {
    setInterval(() => {
      this.handleQueueTimeouts();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Join matchmaking queue
   */
  async joinQueue(
    userId: string,
    gameMode: string,
    preferences: PlayerPreferences = {}
  ): Promise<{ success: boolean; queuePosition?: number; estimatedWaitTime?: number }> {
    try {
      // Validate game mode
      if (!GAME_MODES[gameMode]) {
        return { success: false };
      }

      // Check if already in queue
      const existingQueue = this.queues.get(gameMode) || [];
      const alreadyInQueue = existingQueue.find((entry) => entry.userId === userId);
      if (alreadyInQueue) {
        return { success: false };
      }

      // Get or calculate skill rating
      let skillRating = this.playerSkillRatings.get(userId) || ELO_DEFAULT_RATING;

      // Create queue entry
      const queueEntry: QueueEntry = {
        userId,
        gameMode,
        skillRating,
        preferences,
        joinedAt: Date.now(),
        isPremium: false, // TODO: Check premium status from user profile
        partyId: preferences.partyId,
      };

      // Add to queue
      const queue = this.queues.get(gameMode) || [];
      queue.push(queueEntry);
      this.queues.set(gameMode, queue);

      // Sort queue by skill rating (for priority matching)
      this.sortQueue(gameMode);

      // Calculate position and estimated wait time
      const position = queue.indexOf(queueEntry) + 1;
      const estimatedWaitTime = this.calculateEstimatedWaitTime(position, gameMode);

      logger.info('Player joined matchmaking queue', {
        userId,
        gameMode,
        position,
        skillRating,
      });

      // Try to find matches
      await this.findMatches(gameMode);

      return {
        success: true,
        queuePosition: position,
        estimatedWaitTime,
      };
    } catch (error) {
      logger.error('Error joining matchmaking queue', { error, userId, gameMode });
      return { success: false };
    }
  }

  /**
   * Leave matchmaking queue
   */
  async leaveQueue(userId: string): Promise<{ success: boolean; gameMode?: string }> {
    try {
      for (const [gameMode, queue] of this.queues.entries()) {
        const index = queue.findIndex((entry) => entry.userId === userId);
        if (index !== -1) {
          const entry = queue[index];
          queue.splice(index, 1);
          this.queues.set(gameMode, queue);

          logger.info('Player left matchmaking queue', { userId, gameMode });

          return { success: true, gameMode };
        }
      }

      return { success: false };
    } catch (error) {
      logger.error('Error leaving matchmaking queue', { error, userId });
      return { success: false };
    }
  }

  /**
   * Get queue status
   */
  async getQueueStatus(userId: string): Promise<{
    inQueue: boolean;
    gameMode?: string;
    position?: number;
    estimatedWaitTime?: number;
    playersInQueue?: number;
  }> {
    try {
      for (const [gameMode, queue] of this.queues.entries()) {
        const entry = queue.find((e) => e.userId === userId);
        if (entry) {
          const position = queue.indexOf(entry) + 1;
          const estimatedWaitTime = this.calculateEstimatedWaitTime(position, gameMode);

          return {
            inQueue: true,
            gameMode,
            position,
            estimatedWaitTime,
            playersInQueue: queue.length,
          };
        }
      }

      return { inQueue: false };
    } catch (error) {
      logger.error('Error getting queue status', { error, userId });
      return { inQueue: false };
    }
  }

  /**
   * Accept match invitation
   */
  async acceptMatch(matchId: string, userId: string): Promise<{ success: boolean; match?: MatchSession }> {
    try {
      const invitation = this.matchInvitations.get(matchId);
      if (!invitation) {
        return { success: false };
      }

      // Check if expired
      if (Date.now() > invitation.expiresAt) {
        this.matchInvitations.delete(matchId);
        return { success: false };
      }

      // Check if user is in the invitation
      if (!invitation.players.includes(userId)) {
        return { success: false };
      }

      // Add to accepted
      if (!invitation.acceptedBy.includes(userId)) {
        invitation.acceptedBy.push(userId);
      }

      // Remove from declined if present
      const declinedIndex = invitation.declinedBy.indexOf(userId);
      if (declinedIndex !== -1) {
        invitation.declinedBy.splice(declinedIndex, 1);
      }

      // Check if all players accepted
      if (invitation.acceptedBy.length === invitation.players.length) {
        // Create match session
        const matchSession = await this.createMatchSession(invitation.players);
        this.matchInvitations.delete(matchId);

        return { success: true, match: matchSession };
      }

      return { success: true };
    } catch (error) {
      logger.error('Error accepting match', { error, matchId, userId });
      return { success: false };
    }
  }

  /**
   * Decline match invitation
   */
  async declineMatch(matchId: string, userId: string): Promise<{ success: boolean }> {
    try {
      const invitation = this.matchInvitations.get(matchId);
      if (!invitation) {
        return { success: false };
      }

      // Check if expired
      if (Date.now() > invitation.expiresAt) {
        this.matchInvitations.delete(matchId);
        return { success: false };
      }

      // Add to declined
      if (!invitation.declinedBy.includes(userId)) {
        invitation.declinedBy.push(userId);
      }

      // Remove from accepted if present
      const acceptedIndex = invitation.acceptedBy.indexOf(userId);
      if (acceptedIndex !== -1) {
        invitation.acceptedBy.splice(acceptedIndex, 1);
      }

      // If anyone declined, cancel the match
      if (invitation.declinedBy.length > 0) {
        this.matchInvitations.delete(matchId);
        logger.info('Match invitation declined', { matchId, userId });
      }

      return { success: true };
    } catch (error) {
      logger.error('Error declining match', { error, matchId, userId });
      return { success: false };
    }
  }

  /**
   * Get match history
   */
  async getMatchHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<MatchHistoryEntry[]> {
    try {
      const history = this.matchHistory.get(userId) || [];
      return history.slice(offset, offset + limit);
    } catch (error) {
      logger.error('Error getting match history', { error, userId });
      return [];
    }
  }

  /**
   * Find matches for players in queue
   */
  async findMatches(gameMode: string, skillRange?: number): Promise<void> {
    try {
      const queue = this.queues.get(gameMode) || [];
      if (queue.length < 2) return;

      const range = skillRange || SKILL_RANGE_DEFAULT;
      const config = GAME_MODES[gameMode];
      const requiredPlayers = config.minPlayers;

      // Sort by join time for fair matching
      const sortedQueue = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);

      // Try to find a match
      for (let i = 0; i < sortedQueue.length; i++) {
        const candidate = sortedQueue[i];
        const matchPlayers: QueueEntry[] = [candidate];

        // Find players within skill range
        for (let j = i + 1; j < sortedQueue.length && matchPlayers.length < requiredPlayers; j++) {
          const other = sortedQueue[j];
          
          // Check skill range
          const skillDiff = Math.abs(candidate.skillRating - other.skillRating);
          if (skillDiff <= range) {
            // Check party compatibility
            if (candidate.partyId && other.partyId && candidate.partyId === other.partyId) {
              matchPlayers.push(other);
            } else if (!candidate.partyId && !other.partyId) {
              matchPlayers.push(other);
            }
          }
        }

        // Check if we have enough players
        if (matchPlayers.length >= requiredPlayers) {
          // Calculate match quality
          const quality = this.calculateMatchQuality(matchPlayers);
          
          if (quality >= this.matchQualityThreshold) {
            // Create match invitation
            await this.createMatchInvitation(matchPlayers, gameMode);
            
            // Remove matched players from queue
            for (const player of matchPlayers) {
              const queueIndex = queue.findIndex((e) => e.userId === player.userId);
              if (queueIndex !== -1) {
                queue.splice(queueIndex, 1);
              }
            }
            this.queues.set(gameMode, queue);
          }
        }
      }
    } catch (error) {
      logger.error('Error finding matches', { error, gameMode });
    }
  }

  /**
   * Create match session
   */
  async createMatchSession(players: string[]): Promise<MatchSession> {
    const matchId = uuidv4();
    const skillRatings: Record<string, number> = {};

    for (const player of players) {
      skillRatings[player] = this.playerSkillRatings.get(player) || ELO_DEFAULT_RATING;
    }

    const matchSession: MatchSession = {
      matchId,
      gameMode: 'custom', // Will be determined from queue
      players,
      skillRatings,
      createdAt: Date.now(),
      status: 'active',
    };

    // Store in cache
    await this.cacheService.set(`match:${matchId}`, matchSession, 3600); // 1 hour

    logger.info('Match session created', { matchId, players: players.length });

    return matchSession;
  }

  /**
   * Handle queue timeouts
   */
  async handleQueueTimeouts(): Promise<void> {
    const now = Date.now();

    for (const [gameMode, queue] of this.queues.entries()) {
      const timedOutEntries = queue.filter(
        (entry) => now - entry.joinedAt > QUEUE_TIMEOUT_MS
      );

      for (const entry of timedOutEntries) {
        const index = queue.indexOf(entry);
        if (index !== -1) {
          queue.splice(index, 1);
          logger.info('Player timed out of matchmaking queue', {
            userId: entry.userId,
            gameMode,
            waitTime: now - entry.joinedAt,
          });
        }
      }

      this.queues.set(gameMode, queue);
    }

    // Handle invitation timeouts
    for (const [matchId, invitation] of this.matchInvitations.entries()) {
      if (now > invitation.expiresAt) {
        this.matchInvitations.delete(matchId);
        logger.info('Match invitation expired', { matchId });
      }
    }
  }

  /**
   * Calculate skill rating based on history
   */
  calculateSkillRating(userId: string, history: MatchHistoryEntry[]): number {
    if (history.length === 0) {
      return ELO_DEFAULT_RATING;
    }

    // Calculate average skill from recent matches
    const recentMatches = history.slice(-20);
    const totalRating = recentMatches.reduce((sum, match) => sum + match.skillRating, 0);
    return Math.round(totalRating / recentMatches.length);
  }

  /**
   * Update skill rating after match
   */
  updateSkillRating(
    userId: string,
    opponentRating: number,
    actualResult: 'win' | 'loss' | 'draw'
  ): number {
    const currentRating = this.playerSkillRatings.get(userId) || ELO_DEFAULT_RATING;
    
    let expectedScore: number;
    let actualScore: number;

    switch (actualResult) {
      case 'win':
        actualScore = 1;
        break;
      case 'loss':
        actualScore = 0;
        break;
      case 'draw':
        actualScore = 0.5;
        break;
    }

    // Calculate expected score using ELO formula
    const ratingDiff = opponentRating - currentRating;
    expectedScore = 1 / (1 + Math.pow(10, ratingDiff / 400));

    // Calculate new rating
    const newRating = Math.round(currentRating + ELO_K_FACTOR * (actualScore - expectedScore));
    
    this.playerSkillRatings.set(userId, newRating);
    
    logger.info('Skill rating updated', { userId, oldRating: currentRating, newRating, result: actualResult });

    return newRating;
  }

  /**
   * Get active match for user
   */
  async getActiveMatch(userId: string): Promise<MatchSession | null> {
    try {
      // Check cache for active matches
      const keys = await this.cacheService.get(`match:*`);
      if (keys) {
        // This is simplified - in production, use proper Redis scanning
      }
      return null;
    } catch (error) {
      logger.error('Error getting active match', { error, userId });
      return null;
    }
  }

  // Private helper methods

  private sortQueue(gameMode: string): void {
    const queue = this.queues.get(gameMode) || [];
    queue.sort((a, b) => {
      // Premium players first
      if (a.isPremium && !b.isPremium) return -1;
      if (!a.isPremium && b.isPremium) return 1;
      
      // Then by skill rating (closer ratings match first)
      return a.skillRating - b.skillRating;
    });
    this.queues.set(gameMode, queue);
  }

  private calculateEstimatedWaitTime(position: number, gameMode: string): number {
    const config = GAME_MODES[gameMode];
    const avgMatchTime = 120000; // 2 minutes average
    
    // Estimate based on queue position and game mode popularity
    const baseTime = position * 10000; // 10 seconds per person ahead
    return Math.min(baseTime, avgMatchTime);
  }

  private calculateMatchQuality(players: QueueEntry[]): number {
    if (players.length < 2) return 0;

    // Calculate skill spread
    const ratings = players.map((p) => p.skillRating);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const spread = maxRating - minRating;

    // Calculate average rating
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;

    // Quality score based on skill spread (lower spread = higher quality)
    const skillScore = 1 - Math.min(spread / 500, 1);

    // Bonus for balanced teams (if even number of players)
    let teamBalanceScore = 1;
    if (players.length % 2 === 0) {
      const team1 = players.slice(0, players.length / 2);
      const team2 = players.slice(players.length / 2);
      const team1Avg = team1.reduce((a, b) => a + b.skillRating, 0) / team1.length;
      const team2Avg = team2.reduce((a, b) => a + b.skillRating, 0) / team2.length;
      teamBalanceScore = 1 - Math.abs(team1Avg - team2Avg) / 1000;
    }

    // Combined quality score
    return (skillScore * 0.7 + teamBalanceScore * 0.3);
  }

  private async createMatchInvitation(players: QueueEntry[], gameMode: string): Promise<void> {
    const matchId = uuidv4();
    const invitation: MatchInvitation = {
      matchId,
      players: players.map((p) => p.userId),
      expiresAt: Date.now() + INVITATION_TIMEOUT_MS,
      acceptedBy: [],
      declinedBy: [],
    };

    this.matchInvitations.set(matchId, invitation);

    logger.info('Match invitation created', {
      matchId,
      gameMode,
      players: players.map((p) => p.userId),
    });
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): Record<string, { playersInQueue: number; avgWaitTime: number }> {
    const stats: Record<string, { playersInQueue: number; avgWaitTime: number }> = {};

    for (const [gameMode, queue] of this.queues.entries()) {
      const avgWaitTime = queue.reduce((sum, entry) => sum + (Date.now() - entry.joinedAt), 0) / Math.max(queue.length, 1);
      
      stats[gameMode] = {
        playersInQueue: queue.length,
        avgWaitTime: Math.round(avgWaitTime / 1000),
      };
    }

    return stats;
  }

  /**
   * Get match invitation
   */
  getMatchInvitation(matchId: string): MatchInvitation | undefined {
    return this.matchInvitations.get(matchId);
  }
}

// Export singleton instance
export const matchmakingService = new MatchmakingService();