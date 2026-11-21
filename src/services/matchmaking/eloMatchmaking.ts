import { Router, Request, Response } from "express";
import { createClient, RedisClientType } from "redis";

const DEFAULT_ELO = 1200;
const K_FACTOR = 32;
const BASE_RATING_WINDOW = 100;
const WINDOW_EXPANSION_PER_SEC = 10;
const QUEUE_TIMEOUT_MS = 60_000;

const ELO_KEY_PREFIX = "player:elo:";
const QUEUE_ZSET_KEY = "matchmaking:queue";
const QUEUE_META_PREFIX = "matchmaking:meta:";
const MATCH_STATUS_PREFIX = "matchmaking:status:";

export interface QueueEntry {
  playerId: string;
  elo: number;
  joinedAt: number;
}

export interface MatchStatus {
  status: "queued" | "matched" | "timeout" | "idle";
  matchId?: string;
  opponentId?: string;
  elo?: number;
  queuedAt?: number;
}

export class EloMatchmakingService {
  private redis: RedisClientType;

  constructor(redisUrl = process.env.REDIS_URL || "redis://localhost:6379") {
    this.redis = createClient({ url: redisUrl });
  }

  async connect(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  async getPlayerElo(playerId: string): Promise<number> {
    const raw = await this.redis.get(`${ELO_KEY_PREFIX}${playerId}`);
    if (raw === null) {
      await this.redis.set(`${ELO_KEY_PREFIX}${playerId}`, String(DEFAULT_ELO));
      return DEFAULT_ELO;
    }
    return Number(raw);
  }

  async setPlayerElo(playerId: string, elo: number): Promise<void> {
    await this.redis.set(`${ELO_KEY_PREFIX}${playerId}`, String(Math.round(elo)));
  }

  /**
   * Calculates updated Elo ratings for winner and loser after match completion.
   */
  calculateNewRatings(winnerElo: number, loserElo: number): {
    winnerNewElo: number;
    loserNewElo: number;
  } {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

    const winnerNewElo = Math.round(winnerElo + K_FACTOR * (1 - expectedWinner));
    const loserNewElo = Math.max(100, Math.round(loserElo + K_FACTOR * (0 - expectedLoser)));

    return { winnerNewElo, loserNewElo };
  }

  async recordMatchResult(
    winnerId: string,
    loserId: string
  ): Promise<{ winnerNewElo: number; loserNewElo: number }> {
    const [winnerElo, loserElo] = await Promise.all([
      this.getPlayerElo(winnerId),
      this.getPlayerElo(loserId),
    ]);

    const updated = this.calculateNewRatings(winnerElo, loserElo);

    await Promise.all([
      this.setPlayerElo(winnerId, updated.winnerNewElo),
      this.setPlayerElo(loserId, updated.loserNewElo),
    ]);

    return updated;
  }

  async joinQueue(playerId: string): Promise<MatchStatus> {
    const elo = await this.getPlayerElo(playerId);
    const now = Date.now();

    // Clean expired queue entries before matching
    await this.pruneExpiredEntries(now);

    const dynamicWindow = BASE_RATING_WINDOW;
    const candidates = await this.redis.zRangeByScore(
      QUEUE_ZSET_KEY,
      elo - dynamicWindow,
      elo + dynamicWindow
    );

    const opponentId = candidates.find((id) => id !== playerId);

    if (opponentId) {
      await Promise.all([
        this.redis.zRem(QUEUE_ZSET_KEY, opponentId),
        this.redis.del(`${QUEUE_META_PREFIX}${opponentId}`),
      ]);

      const matchId = `match_${now}_${playerId}_${opponentId}`;
      const playerStatus: MatchStatus = { status: "matched", matchId, opponentId, elo };
      const opponentElo = await this.getPlayerElo(opponentId);
      const opponentStatus: MatchStatus = {
        status: "matched",
        matchId,
        opponentId: playerId,
        elo: opponentElo,
      };

      await Promise.all([
        this.redis.set(`${MATCH_STATUS_PREFIX}${playerId}`, JSON.stringify(playerStatus), {
          EX: 300,
        }),
        this.redis.set(`${MATCH_STATUS_PREFIX}${opponentId}`, JSON.stringify(opponentStatus), {
          EX: 300,
        }),
      ]);

      return playerStatus;
    }

    const entry: QueueEntry = { playerId, elo, joinedAt: now };
    const queuedStatus: MatchStatus = { status: "queued", elo, queuedAt: now };

    await Promise.all([
      this.redis.zAdd(QUEUE_ZSET_KEY, { score: elo, value: playerId }),
      this.redis.set(`${QUEUE_META_PREFIX}${playerId}`, JSON.stringify(entry), {
        PX: QUEUE_TIMEOUT_MS,
      }),
      this.redis.set(`${MATCH_STATUS_PREFIX}${playerId}`, JSON.stringify(queuedStatus), {
        PX: QUEUE_TIMEOUT_MS,
      }),
    ]);

    return queuedStatus;
  }

  async getStatus(playerId: string): Promise<MatchStatus> {
    const metaRaw = await this.redis.get(`${QUEUE_META_PREFIX}${playerId}`);
    if (metaRaw) {
      const entry: QueueEntry = JSON.parse(metaRaw);
      const elapsedMs = Date.now() - entry.joinedAt;

      if (elapsedMs >= QUEUE_TIMEOUT_MS) {
        await this.removeFromQueue(playerId);
        const timeoutStatus: MatchStatus = { status: "timeout", elo: entry.elo };
        await this.redis.set(`${MATCH_STATUS_PREFIX}${playerId}`, JSON.stringify(timeoutStatus), {
          EX: 60,
        });
        return timeoutStatus;
      }

      // Attempt expanding-window match lookup while polling
      const expandedWindow =
        BASE_RATING_WINDOW + Math.floor(elapsedMs / 1000) * WINDOW_EXPANSION_PER_SEC;
      const candidates = await this.redis.zRangeByScore(
        QUEUE_ZSET_KEY,
        entry.elo - expandedWindow,
        entry.elo + expandedWindow
      );

      const opponentId = candidates.find((id) => id !== playerId);
      if (opponentId) {
        await this.removeFromQueue(playerId);
        return this.joinQueue(playerId);
      }
    }

    const statusRaw = await this.redis.get(`${MATCH_STATUS_PREFIX}${playerId}`);
    if (!statusRaw) {
      return { status: "idle" };
    }
    return JSON.parse(statusRaw) as MatchStatus;
  }

  private async removeFromQueue(playerId: string): Promise<void> {
    await Promise.all([
      this.redis.zRem(QUEUE_ZSET_KEY, playerId),
      this.redis.del(`${QUEUE_META_PREFIX}${playerId}`),
    ]);
  }

  private async pruneExpiredEntries(now: number): Promise<void> {
    const allQueued = await this.redis.zRange(QUEUE_ZSET_KEY, 0, -1);
    for (const id of allQueued) {
      const metaRaw = await this.redis.get(`${QUEUE_META_PREFIX}${id}`);
      if (!metaRaw) {
        await this.redis.zRem(QUEUE_ZSET_KEY, id);
        continue;
      }
      const entry: QueueEntry = JSON.parse(metaRaw);
      if (now - entry.joinedAt >= QUEUE_TIMEOUT_MS) {
        await this.removeFromQueue(id);
        await this.redis.set(
          `${MATCH_STATUS_PREFIX}${id}`,
          JSON.stringify({ status: "timeout", elo: entry.elo } satisfies MatchStatus),
          { EX: 60 }
        );
      }
    }
  }
}

export function createMatchmakingRouter(service: EloMatchmakingService): Router {
  const router = Router();

  router.post("/matchmaking/join", async (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId?: string };
    if (!playerId) {
      res.status(400).json({ error: "playerId is required" });
      return;
    }
    const result = await service.joinQueue(playerId);
    res.status(200).json(result);
  });

  router.get("/matchmaking/status", async (req: Request, res: Response) => {
    const playerId = req.query.playerId as string | undefined;
    if (!playerId) {
      res.status(400).json({ error: "playerId query parameter is required" });
      return;
    }
    const status = await service.getStatus(playerId);
    res.status(200).json(status);
  });

  return router;
}