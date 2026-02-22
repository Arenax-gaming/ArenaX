import Redis from "ioredis";

export class MatchService {
    private redis: Redis;

    constructor(redisClient: Redis) {
        this.redis = redisClient;
    }

    /**
     * Create if a player is already queued.
     */
    async isQueued(playerId: string): Promise<boolean> {
        const exists = await this.redis.sismember("queue:active", playerId);
        return exists === 1;
    }
    /**
     * Add a player to matchmaking queue.
     */
    async joinQueue(playerId: string, elo: number, group: string) {
        const alreadyQueued = await this.isQueued(playerId);

        if(alreadyQueued) {
            throw new Error("Player already in matchmaking queue");
        }
        const queueKey = `queue:elo:${group}`;
        const metaKey = `queue:meta:${playerId}`;
        const now = Date.now();

        const multi = this.redis.multi();

        //Add to sorted set(score = elo)
        multi.zadd(queueKey, elo, playerId);

        //Store metadata
        multi.hset(metaKey, {
            elo: elo.toString(),
            joinedAt: now.toString(),
            group,
        });
        //Add to active set
        multi.sadd("queue:active", playerId);
        await multi.exec();
        return {success:  true};

    }
    /**
     * Remove player from matchmaking queue.
     */
    async leaveQueue(playerId: string) {
        const metaKey = `queue:meta:${playerId}`;
        const metadata = await this.redis.hgetall(metaKey);

        if (!metadata || !metadata.group) {
            throw new Error("Player is not in queue");
        }
        const queueKey = `queue:elo:${metadata.group}`;
        const multi = this.redis.multi();

        //remove from sorted set
        multi.zrem(queueKey, playerId);

        //delete metadata
        multi.del(metaKey);

        //remove from active set
        multi.srem("queue:active", playerId);

        await multi.exec();

        return {success: true};


    }
    async createMatch(player1Id: string, player2Id: string, matchType: string) {
        // Placeholder for match creation
        console.log(`Creating match ${player1Id} vs ${player2Id}`);

        //TODO: Save in DB
        return {
            player1Id,
            player2Id,
            state: "PENDING",
            matchType,
        }
    }

    /**
     * Report score for a match.
     */
    async reportScore(matchId: string, userId: string, score: any) {
        // Placeholder for score reporting
    }
}
