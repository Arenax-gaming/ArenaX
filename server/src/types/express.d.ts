import { Logger } from 'winston';

declare global {
    namespace Express {
        interface User {
            id: string;
            role: string;
        }
        interface Request {
            requestId: string;
            log: Logger;
            user?: User;
        }
    }
}

export { };
