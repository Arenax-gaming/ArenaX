type EventHandler = (payload: unknown) => void;

const TOPIC_RATING_CHANGED = 'RATING_CHANGED';
const TOPIC_MATCH_EVENTS = 'MATCH_EVENTS';

const subscribers = new Map<string, Set<EventHandler>>();

export function publish(topic: string, payload: unknown): void {
    const handlers = subscribers.get(topic);
    if (handlers) {
        for (const handler of handlers) {
            try {
                handler(payload);
            } catch {
                // ignore handler errors
            }
        }
    }
}

export function subscribe(topic: string, handler: EventHandler): () => void {
    if (!subscribers.has(topic)) {
        subscribers.set(topic, new Set());
    }
    subscribers.get(topic)!.add(handler);
    return () => {
        subscribers.get(topic)?.delete(handler);
    };
}

export function publishRatingChanged(userId: string, user: { id: string; displayName: string; rating: number; createdAt: Date }): void {
    publish(`${TOPIC_RATING_CHANGED}:${userId}`, user);
}

export function publishMatchEvent(matchId: string, match: Record<string, unknown>): void {
    publish(`${TOPIC_MATCH_EVENTS}:${matchId}`, match);
}

export { TOPIC_RATING_CHANGED, TOPIC_MATCH_EVENTS };
