import { EventEmitter } from 'events';
import { logger } from './logger.service';

export type GameEventType =
    | 'MATCH_WON'
    | 'MATCH_COMPLETED'
    | 'PROFILE_UPDATED'
    | 'KYC_APPROVED'
    | 'SEASONAL_ACTIVE';

export interface GameEvent {
    type: GameEventType;
    playerId: string;
    payload?: Record<string, unknown>;
}

type GameEventHandler = (event: GameEvent) => void | Promise<void>;

const bus = new EventEmitter();
bus.setMaxListeners(50);

export const emitGameEvent = (event: GameEvent): void => {
    setImmediate(() => {
        bus.emit('game', event);
    });
};

export const onGameEvent = (handler: GameEventHandler): void => {
    bus.on('game', (evt: GameEvent) => {
        void Promise.resolve(handler(evt)).catch((err: unknown) => {
            logger.error('achievement game event handler failed', {
                type: evt.type,
                playerId: evt.playerId,
                message: err instanceof Error ? err.message : String(err)
            });
        });
    });
};
