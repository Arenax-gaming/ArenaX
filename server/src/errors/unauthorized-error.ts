import { BaseError, ErrorDetails } from './base-error';

export class UnauthorizedError extends BaseError {
    constructor(message = 'Unauthorized', details?: ErrorDetails) {
        super(
            message,
            401,
            'UNAUTHORIZED',
            {
                reason: details?.reason || 'authentication_required',
                required: details?.required || 'valid_token',
                ...details
            },
            true,
            true
        );
    }
}