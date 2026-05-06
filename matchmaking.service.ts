import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export interface MatchmakingPreferences {
  region?: string;
  language?: string;
  isPremium?: boolean;
}

export interface PlayerData {
  userId: string;
  elo: number;
  joinedAt: number;
  gameMode: string;
  preferences: MatchmakingPreferences;
}

export class MatchmakingService extends EventEmitter {
  private redis: Redis;
  private readonly INVITE_EXPIRY = 30; // seconds
  private readonly K_FACTOR = 32;

  constructor(redisClient: Redis) {
    super();
    this.redis = redisClient;
  }

  /**
   * Adds a player to the game-specific queue in Redis
   */
  async joinQueue(userId: string, gameMode: string, elo: number, preferences: MatchmakingPreferences) {
    const playerKey = `mm:player:${userId}`;
    const queueKey = `mm:queue:${gameMode}`;

    const playerData: PlayerData = {
      userId,
      elo,
      joinedAt: Date.now(),
      gameMode,
      preferences,
    };

    // Priority system: premium players get a "virtual" earlier join time for sorting
    const score = preferences.isPremium ? Date.now() - 30000 : Date.now();

    await this.redis.multi()
      .hset(playerKey, { 
        userId, 
        elo: elo.toString(), 
        joinedAt: playerData.joinedAt.toString(), 
        gameMode, 
        preferences: JSON.stringify(preferences) 
      })
      .zadd(queueKey, score, userId)
      .exec();

    this.emit('queue:joined', { userId, gameMode });
  }

  async leaveQueue(userId: string, gameMode: string) {
    await this.redis.multi()
      .del(`mm:player:${userId}`)
      .zrem(`mm:queue:${gameMode}`, userId)
      .exec();
    
    this.emit('matchmaking:cancelled', { userId, reason: 'user_left' });
  }

  /**
   * Core matching logic - should be called by a background worker
   */
  async findMatches(gameMode: string) {
    const queueKey = `mm:queue:${gameMode}`;
    const players = await this.redis.zrange(queueKey, 0, -1);

    if (players.length < 2) return;

    const matchedPairs: [string, string][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < players.length; i++) {
      const p1Id = players[i];
      if (processed.has(p1Id)) continue;

      const p1Data = await this.getPlayerData(p1Id);
      if (!p1Data) continue;

      // Dynamic ELO expansion based on wait time
      const waitTimeSeconds = (Date.now() - p1Data.joinedAt) / 1000;
      const eloRange = this.calculateEloRange(waitTimeSeconds);

      for (let j = i + 1; j < players.length; j++) {
        const p2Id = players[j];
        if (processed.has(p2Id)) continue;

        const p2Data = await this.getPlayerData(p2Id);
        if (!p2Data) continue;

        const eloDiff = Math.abs(p1Data.elo - p2Data.elo);
        const quality = this.calculateMatchQuality(eloDiff, waitTimeSeconds);

        // Preference check (Region matching)
        if (p1Data.preferences.region && p2Data.preferences.region && 
            p1Data.preferences.region !== p2Data.preferences.region) continue;

        if (eloDiff <= eloRange && quality > 0.5) {
          matchedPairs.push([p1Id, p2Id]);
          processed.add(p1Id);
          processed.add(p2Id);
          break;
        }
      }
    }

    for (const [p1, p2] of matchedPairs) {
      await this.createMatchInvitation(p1, p2, gameMode);
    }
  }

  private async createMatchInvitation(p1: string, p2: string, gameMode: string) {
    const matchId = uuidv4();
    const inviteKey = `mm:invite:${matchId}`;
    
    await this.redis.multi()
      .set(inviteKey, JSON.stringify({ players: [p1, p2], accepted: [], gameMode }), 'EX', this.INVITE_EXPIRY)
      .zrem(`mm:queue:${gameMode}`, p1, p2)
      .exec();

    this.emit('match:found', { matchId, players: [p1, p2], gameMode });
  }

  async acceptMatch(matchId: string, userId: string) {
    const inviteKey = `mm:invite:${matchId}`;
    const data = await this.redis.get(inviteKey);
    if (!data) throw new Error('Invitation expired or not found');

    const invite = JSON.parse(data);
    if (!invite.players.includes(userId)) throw new Error('Unauthorized');
    
    if (!invite.accepted.includes(userId)) {
      invite.accepted.push(userId);
      await this.redis.set(inviteKey, JSON.stringify(invite), 'KEEPTTL');
    }

    if (invite.accepted.length === invite.players.length) {
      await this.createMatchSession(invite.players, invite.gameMode);
      await this.redis.del(inviteKey);
    }
  }

  async declineMatch(matchId: string, userId: string) {
    const inviteKey = `mm:invite:${matchId}`;
    const data = await this.redis.get(inviteKey);
    if (!data) return;

    const invite = JSON.parse(data);
    await this.redis.del(inviteKey);

    // Notify other players that the match was cancelled
    invite.players.forEach((pId: string) => {
      if (pId !== userId) {
        this.emit('matchmaking:cancelled', { userId: pId, reason: 'declined_by_opponent' });
      }
    });
  }

  async handleQueueTimeouts() {
    // Note: Redis 'EX' handles key deletion, but we need to notify users
    // In a production environment, use Redis Keyspace Notifications (Expirations)
    // For this implementation, we emit 'matchmaking:expired' when a search fails in controller/socket
  }

  private calculateEloRange(waitTime: number): number {
    // Expands range: 100 base + 50 every 30 seconds
    return 100 + Math.floor(waitTime / 30) * 50;
  }

  private calculateMatchQuality(eloDiff: number, waitTime: number): number {
    const eloWeight = Math.max(0, 1 - eloDiff / 400);
    const waitWeight = Math.min(0.5, waitTime / 120);
    return eloWeight + waitWeight;
  }

  /**
   * Standard ELO formula for post-match updates
   */
  calculateSkillRating(currentElo: number, opponentElo: number, result: 1 | 0.5 | 0): number {
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));
    return Math.round(currentElo + this.K_FACTOR * (result - expectedScore));
  }

  private async createMatchSession(players: string[], gameMode: string) {
    const sessionId = uuidv4();
    this.emit('match:started', { sessionId, players, gameMode });
  }

  async getQueueStatus(userId: string) {
    const playerData = await this.redis.hgetall(`mm:player:${userId}`);
    if (!playerData || !playerData.userId) return { status: 'idle' };
    return { 
      status: 'searching', 
      gameMode: playerData.gameMode,
      waitTime: Math.floor((Date.now() - parseInt(playerData.joinedAt)) / 1000)
    };
  }

  private async getPlayerData(userId: string): Promise<PlayerData | null> {
    const data = await this.redis.hgetall(`mm:player:${userId}`);
    if (!data || !data.userId) return null;
    return {
      userId: data.userId,
      gameMode: data.gameMode,
      elo: parseInt(data.elo),
      joinedAt: parseInt(data.joinedAt),
      preferences: JSON.parse(data.preferences)
    };
  }
}