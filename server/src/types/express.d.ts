import { Logger } from 'winston';

declare global {
    namespace Express {
        interface User {
            id: string;
            role: string;
            email: string;
            username: string;
        }
        interface Request {
            /** Legacy alias — equals correlationId. Kept for backward compatibility. */
            requestId: string;
            /** Active correlation ID for this request. */
            correlationId: string;
            log: Logger;
            user?: User;
        }
    }
}

export { };
