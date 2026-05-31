import { BaseError, ErrorDetails } from './base-error';

export class ValidationError extends BaseError {
    constructor(message = 'Validation failed', details?: ErrorDetails) {
        super(
            message,
            400,
            'VALIDATION_ERROR',
            {
                field: details?.field || 'unknown',
                constraint: details?.constraint || 'invalid',
                value: details?.value,
                ...details
            },
            true,
            true
        );
    }
}