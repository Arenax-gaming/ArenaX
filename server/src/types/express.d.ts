import { Logger } from 'winston';

declare global {
    namespace Express {
        interface Request {
            requestId: string;
            log: Logger;
        }
    }
}

export {};
