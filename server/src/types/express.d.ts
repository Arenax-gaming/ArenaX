import { AuthenticatedUser } from './auth.types';

declare global {
    namespace Express {
        interface User extends AuthenticatedUser {}
    }
}

export {};
