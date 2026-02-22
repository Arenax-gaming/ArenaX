import { BaseError, ErrorDetails } from './base-error';

export class UnauthorizedError extends BaseError {
    constructor(message = 'Unauthorized', details?: ErrorDetails) {
        super(message, 401, 'UNAUTHORIZED', details);
    }
}