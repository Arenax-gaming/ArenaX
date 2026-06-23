import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';
import { logger } from './logger.service';

/**
 * Account Lockout Service
 * Tracks failed authentication attempts and locks accounts after threshold
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

interface FailedAttempt {
    userId: string;
    ipAddress: string;
    attempts: number;
    lastAttemptAt: Date;
    lockedUntil?: Date;
}

// Store failed attempts in memory (in production, use Redis)
const failedAttempts = new Map<string, FailedAttempt>();

// Clean up expired lockouts every 5 minutes.
// Collect keys first, then delete — avoids mutating the Map while iterating it.
setInterval(() => {
    const now = new Date();
    const expiredKeys: string[] = [];
    for (const [key, attempt] of failedAttempts.entries()) {
        if (attempt.lockedUntil && attempt.lockedUntil < now) {
            expiredKeys.push(key);
        }
    }
    for (const key of expiredKeys) {
        failedAttempts.delete(key);
    }
}, 5 * 60 * 1000);

/**
 * Get the key for failed attempts tracking
 */
const getAttemptKey = (userId: string, ipAddress: string): string => {
    return `${userId}:${ipAddress}`;
};

/**
 * Record a failed authentication attempt
 */
export const recordFailedAttempt = async (
    userId: string,
    ipAddress: string
): Promise<{ locked: boolean; remainingAttempts: number }> => {
    const key = getAttemptKey(userId, ipAddress);

    // Atomic read-modify-write: fetch the current record, compute the new
    // state, and write it back in a single synchronous block so that two
    // concurrent async callers cannot both read attempts=0 and both write
    // attempts=1 (losing one increment).
    const existing = failedAttempts.get(key);
    const attempts = (existing?.attempts ?? 0) + 1;
    const now = new Date();

    let lockedUntil: Date | undefined = existing?.lockedUntil;
    let locked = false;

    if (attempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
        locked = true;
    }

    failedAttempts.set(key, {
        userId,
        ipAddress,
        attempts,
        lastAttemptAt: now,
        lockedUntil
    });

    logger.warn('Failed auth attempt recorded', {
        userId,
        ipAddress,
        attempts,
        locked
    });

    return {
        locked,
        remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - attempts)
    };
};

/**
 * Check if an account is locked
 */
export const isAccountLocked = (userId: string, ipAddress: string): boolean => {
    const key = getAttemptKey(userId, ipAddress);
    const attempt = failedAttempts.get(key);
    
    if (!attempt || !attempt.lockedUntil) {
        return false;
    }
    
    if (attempt.lockedUntil < new Date()) {
        // Lockout has expired
        failedAttempts.delete(key);
        return false;
    }
    
    return true;
};

/**
 * Get remaining lockout time in seconds
 */
export const getLockoutRemainingSeconds = (userId: string, ipAddress: string): number => {
    const key = getAttemptKey(userId, ipAddress);
    const attempt = failedAttempts.get(key);
    
    if (!attempt || !attempt.lockedUntil) {
        return 0;
    }
    
    const remaining = attempt.lockedUntil.getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
};

/**
 * Clear failed attempts after successful authentication
 */
export const clearFailedAttempts = (userId: string, ipAddress: string): void => {
    const key = getAttemptKey(userId, ipAddress);
    failedAttempts.delete(key);
};

/**
 * Middleware to check account lockout before authentication
 */
export const checkAccountLockout = async (
    userId: string,
    ipAddress: string
): Promise<void> => {
    if (isAccountLocked(userId, ipAddress)) {
        const remainingSeconds = getLockoutRemainingSeconds(userId, ipAddress);
        throw new HttpError(
            429,
            `Account locked due to too many failed attempts. Try again in ${remainingSeconds} seconds.`
        );
    }
};
