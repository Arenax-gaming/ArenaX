declare module 'passport-twitch-new' {
    import { Strategy as BaseStrategy } from 'passport-strategy';
    import { Request } from 'express';

    export interface Profile {
        id: string;
        username: string;
        display_name: string;
        email?: string;
        login: string;
        type: string;
        broadcaster_type: string;
        description?: string;
        profile_image_url?: string;
        offline_image_url?: string;
        created_at?: string;
    }

    export interface StrategyOption {
        clientID: string;
        clientSecret: string;
        callbackURL: string;
        scope?: string[];
    }

    export class Strategy extends BaseStrategy {
        constructor(options: StrategyOption, verify: (...args: any[]) => any);
    }
}
