import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { HttpError } from '../utils/http-error';

/**
 * Request Signature Validation Middleware
 * Validates HMAC signatures for sensitive operations to ensure request integrity
 */

const SIGNATURE_HEADER_NAME = 'x-signature';
const SIGNATURE_TIMESTAMP_HEADER = 'x-signature-timestamp';
const SIGNATURE_ALGORITHM = 'sha256';
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate HMAC signature for a request
 */
export const generateSignature = (
    payload: string,
    secret: string,
    timestamp: number
): string => {
    const message = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac(SIGNATURE_ALGORITHM, secret);
    hmac.update(message);
    return hmac.digest('hex');
};

/**
 * Validate request signature
 */
export const validateSignature = (
    payload: string,
    signature: string,
    secret: string,
    timestamp: number
): boolean => {
    // Check timestamp is within tolerance
    const now = Date.now();
    if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_MS) {
        return false;
    }
    
    // Generate expected signature
    const expectedSignature = generateSignature(payload, secret, timestamp);
    
    // Use constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
    );
};

/**
 * Middleware to require valid request signature
 */
export const requireSignature = (secret: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const signature = req.header(SIGNATURE_HEADER_NAME);
        const timestampHeader = req.header(SIGNATURE_TIMESTAMP_HEADER);
        
        if (!signature || !timestampHeader) {
            throw new HttpError(
                401,
                'Missing signature headers'
            );
        }
        
        const timestamp = parseInt(timestampHeader, 10);
        if (isNaN(timestamp)) {
            throw new HttpError(
                400,
                'Invalid timestamp format'
            );
        }
        
        // Get request body as string for signature
        const payload = JSON.stringify(req.body);
        
        if (!validateSignature(payload, signature, secret, timestamp)) {
            throw new HttpError(
                401,
                'Invalid request signature'
            );
        }
        
        next();
    };
};

/**
 * Middleware to require signature for specific sensitive operations
 * Uses environment variable for secret
 */
export const requireSensitiveOperationSignature = () => {
    const secret = process.env.SENSITIVE_OPERATION_SECRET;
    
    if (!secret) {
        // In development, skip signature validation if secret not set
        if (process.env.NODE_ENV !== 'production') {
            return (_req: Request, _res: Response, next: NextFunction) => next();
        }
        
        throw new Error('SENSITIVE_OPERATION_SECRET environment variable is required in production');
    }
    
    return requireSignature(secret);
};
