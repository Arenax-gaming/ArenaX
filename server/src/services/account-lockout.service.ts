import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';

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

// Clean up expired lockouts every 5 minutes
setInterval(() => {
    const now = new Date();
    for (const [key, attempt] of failedAttempts.entries()) {
        if (attempt.lockedUntil && attempt.lockedUntil < now) {
            failedAttempts.delete(key);
        }
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
    const existing = failedAttempts.get(key);
    
    const attempts = existing ? existing.attempts + 1 : 1;
    const now = new Date();
    
    let lockedUntil: Date | undefined;
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
    
    // Log the failed attempt
    console.warn(`[Security] Failed auth attempt for user ${userId} from IP ${ipAddress}. Total: ${attempts}`);
    
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
