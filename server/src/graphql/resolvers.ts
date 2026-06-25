import { getDatabaseClient } from '../services/database.service';
import { publishRatingChanged, publishMatchEvent } from './pubsub';
import type { GraphQLContext } from './context';

interface UserArgs {
    id: string;
}

interface MatchesArgs {
    limit?: number;
    after?: string;
}

interface TournamentArgs {
    id: string;
}

interface MatchEventsArgs {
    matchId: string;
}

interface JoinMatchmakingArgs {
    gameMode: string;
}

export const resolvers = {
    DateTime: {
        __serialize(value: Date | string): string {
            return value instanceof Date ? value.toISOString() : value;
        },
    },

    Query: {
        async viewer(_: unknown, __: unknown, ctx: GraphQLContext) {
            if (!ctx.userId) return null;
            const prisma = getDatabaseClient();
            const user = await (prisma as any).user.findUnique({
                where: { id: ctx.userId },
                select: { id: true, username: true, role: true, createdAt: true },
            });
            if (!user) return null;
            return {
                id: user.id,
                displayName: user.username,
                rating: 1000,
                createdAt: user.createdAt,
            };
        },

        async user(_: unknown, args: UserArgs) {
            const prisma = getDatabaseClient();
            const user = await (prisma as any).user.findUnique({
                where: { id: args.id },
                select: { id: true, username: true, createdAt: true },
            });
            if (!user) return null;
            return {
                id: user.id,
                displayName: user.username,
                rating: 1000,
                createdAt: user.createdAt,
            };
        },

        async matches(_: unknown, args: MatchesArgs) {
            const prisma = getDatabaseClient();
            const take = Math.min(args.limit || 20, 100);
            const matches = await (prisma as any).match.findMany({
                take: take + 1,
                ...(args.after ? { cursor: { id: args.after }, skip: 1 } : {}),
                orderBy: { createdAt: 'desc' },
            });
            const hasNextPage = matches.length > take;
            const edges = hasNextPage ? matches.slice(0, take) : matches;
            const endCursor = edges.length > 0 ? edges[edges.length - 1].id : null;
            return {
                edges: edges.map((m: any) => ({
                    id: m.id,
                    gameMode: m.metadata?.gameMode || 'unknown',
                    teamA: [],
                    teamB: [],
                    startedAt: m.createdAt,
                })),
                pageInfo: { hasNextPage, endCursor },
            };
        },

        async tournament(_: unknown, args: TournamentArgs) {
            const prisma = getDatabaseClient();
            const t = await (prisma as any).tournament.findUnique({
                where: { id: args.id },
                select: { id: true, name: true, startDate: true, endDate: true, _count: { select: { participants: true } } },
            });
            if (!t) return null;
            return {
                id: t.id,
                name: t.name,
                startsAt: t.startDate,
                endsAt: t.endDate,
                participantCount: t._count.participants,
            };
        },
    },

    Mutation: {
        async joinMatchmakingQueue(_: unknown, args: JoinMatchmakingArgs, ctx: GraphQLContext) {
            if (!ctx.userId) return false;
            return true;
        },

        async leaveMatchmakingQueue(_: unknown, __: unknown, ctx: GraphQLContext) {
            if (!ctx.userId) return false;
            return true;
        },
    },

    Subscription: {
        viewerRatingChanged: {
            subscribe(_: unknown, __: unknown, ctx: GraphQLContext) {
                if (!ctx.userId) throw new Error('Not authenticated');
                const topic = `RATING_CHANGED:${ctx.userId}`;
                return {
                    [Symbol.asyncIterator]() {
                        let resolveNext: ((value: unknown) => void) | null = null;
                        const unsubscribe = subscribeToTopic(topic, (payload) => {
                            if (resolveNext) {
                                resolveNext({ done: false, value: payload });
                                resolveNext = null;
                            }
                        });
                        return {
                            next() {
                                return new Promise((resolve) => {
                                    resolveNext = resolve;
                                });
                            },
                            return() {
                                unsubscribe();
                                return Promise.resolve({ done: true, value: undefined });
                            },
                        };
                    },
                };
            },
            resolve(payload: unknown) {
                return payload;
            },
        },

        matchEvents: {
            subscribe(_: unknown, args: MatchEventsArgs) {
                const topic = `MATCH_EVENTS:${args.matchId}`;
                return {
                    [Symbol.asyncIterator]() {
                        let resolveNext: ((value: unknown) => void) | null = null;
                        const unsubscribe = subscribeToTopic(topic, (payload) => {
                            if (resolveNext) {
                                resolveNext({ done: false, value: payload });
                                resolveNext = null;
                            }
                        });
                        return {
                            next() {
                                return new Promise((resolve) => {
                                    resolveNext = resolve;
                                });
                            },
                            return() {
                                unsubscribe();
                                return Promise.resolve({ done: true, value: undefined });
                            },
                        };
                    },
                };
            },
            resolve(payload: unknown) {
                return payload;
            },
        },
    },

    User: {
        recentMatches(parent: { id: string }, args: { limit?: number }) {
            return [];
        },
    },
};

type TopicHandler = (payload: unknown) => void;
const topicSubscribers = new Map<string, Set<TopicHandler>>();

export function subscribeToTopic(topic: string, handler: TopicHandler): () => void {
    if (!topicSubscribers.has(topic)) {
        topicSubscribers.set(topic, new Set());
    }
    topicSubscribers.get(topic)!.add(handler);
    return () => {
        topicSubscribers.get(topic)?.delete(handler);
    };
}

export function publishToTopic(topic: string, payload: unknown): void {
    const handlers = topicSubscribers.get(topic);
    if (handlers) {
        for (const handler of handlers) {
            try { handler(payload); } catch { /* ignore */ }
        }
    }
}
