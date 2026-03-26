import { BaseError, ErrorDetails } from './base-error';

export class NotFoundError extends BaseError {
    constructor(message = 'Resource not found', details?: ErrorDetails) {
        super(message, 404, 'NOT_FOUND', details);
    }
}