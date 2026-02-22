export interface ErrorDetails {
    [key: string]: unknown;
}

export class BaseError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: ErrorDetails;
    public readonly isOperational: boolean;
    public readonly expose: boolean;

    constructor(
        message: string,
        statusCode: number,
        code: string,
        details?: ErrorDetails,
        isOperational = true,
        expose = statusCode < 500
    ) {
        super(message);

        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = isOperational;
        this.expose = expose;

        Error.captureStackTrace(this, this.constructor);
    }
}

export const isBaseError = (value: unknown): value is BaseError => value instanceof BaseError;