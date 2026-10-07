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
            /**
             * Raw request body captured by the JSON parser's `verify` hook.
             * Required to re-compute provider webhook signatures (Paystack /
             * Flutterwave) over the exact bytes the provider signed.
             */
            rawBody?: Buffer;
        }
    }
}

export { };
