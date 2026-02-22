import Redis from "ioredis";
import {MatchService} from "../services/match.service";

export class MatchMakingWorker {
    private redis: Redis;
    private matchService: MatchService;
    private readonly BASE_DELTA = 50;
    private readonly STALE_TIMEOUT = 5*60*1000;
    private readonly GROUPS = ["solo"];

    constructor(redis: Redis) {
        this.redis = redis;
        this.matchService = new MatchService(redis);

    }
    start() {
        console.log("Matchmaking worker started");

        setInterval(() => {
            this.tick();
        },3000); //every 3 seconds
    }
    private async tick() {
        for(const group of this.GROUPS) {
            await this.processGroup(group);
        }
    }
    private async processGroup(group: string) {
        await this.cleanupStale(group);
        await this.tryMatch(group);
    }
    /**
     * Remove players who waited too long(stale)
     */
    private async cleanupStale(group: string){
        const queueKey = `queue:elo:${group}`;
        const now = Date.now();

        const players = await this.redis.zrange(queueKey, 0, 50);
        for (const playerId of players) {
            const meta = await this.redis.hgetall(`queue:meta:${playerId}`);
            if(!meta.joinedAt) continue;

            const joinedAt = parseInt(meta.joinedAt);
            const waitTime = now- joinedAt;

            if(waitTime > this.STALE_TIMEOUT) {
                console.log(`Removing stale player ${playerId}`);
                await this.matchService.leaveQueue(playerId);
            }
        }
    }
    /**
     * Try to match players
     */
    private async tryMatch(group: string) {
        const queueKey = `queue:elo:${group}`;
        const players = await this.redis.zrange(queueKey, 0, 20);

        for (const playerId of players) {
            const meta = await this.redis.hgetall(`queue:meta:${playerId}`);
            if(!meta.elo) continue;

            const elo = parseInt(meta.elo);
            const joinedAt = parseInt(meta.joinedAt);
            const waitTime = Date.now() - joinedAt;

            //dynamic radius expansion
            const dynamicDelta =
                this.BASE_DELTA + Math.floor(waitTime / 10000) *20;
            const min = elo - dynamicDelta;
            const max = elo + dynamicDelta;

            const candidates = await this.redis.zrangebyscore(
                queueKey,
                min,
                max,
                "LIMIT",
                0,
                5,
            );
            const opponent = candidates.find(p=>p!==playerId);
            if(opponent) {
                await this.createMatch(playerId, opponent, group);
                return; //process next tick
            }
        }
    }
    private async createMatch(
        player1: string,
        player2: string,
        group: string
    ) {
        console.log(`Match found: ${player1} vs ${player2}`);

        await this.matchService.leaveQueue(player1);
        await this.matchService.leaveQueue(player2);

        await this.matchService.createMatch(player1, player2, group);
    }
}