import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error';

/**
 * IP Whitelist Middleware
 * Restricts access to specific endpoints based on IP whitelist
 */

/**
 * Parse IP whitelist from environment variable
 * Format: comma-separated list of IP addresses or CIDR ranges
 * Example: 192.168.1.1,10.0.0.0/8,172.16.0.0/12
 */
const parseIpWhitelist = (): string[] => {
    const whitelistEnv = process.env.ADMIN_IP_WHITELIST;
    if (!whitelistEnv) {
        return [];
    }
    
    return whitelistEnv
        .split(',')
        .map(ip => ip.trim())
        .filter(ip => ip.length > 0);
};

/**
 * Check if an IP address is in a CIDR range
 */
const isIpInCidr = (ip: string, cidr: string): boolean => {
    const [network, prefixLength] = cidr.split('/');
    if (!prefixLength) {
        return ip === network;
    }
    
    const prefix = parseInt(prefixLength, 10);
    const ipParts = ip.split('.').map(Number);
    const networkParts = network.split('.').map(Number);
    
    const mask = 0xffffffff << (32 - prefix);
    
    const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
    const networkNum = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];
    
    return (ipNum & mask) === (networkNum & mask);
};

/**
 * Check if an IP address is whitelisted
 */
const isIpWhitelisted = (ip: string, whitelist: string[]): boolean => {
    if (whitelist.length === 0) {
        // If whitelist is empty, allow all (for development)
        return process.env.NODE_ENV !== 'production';
    }
    
    return whitelist.some(whitelistedIp => {
        if (whitelistedIp.includes('/')) {
            return isIpInCidr(ip, whitelistedIp);
        }
        return ip === whitelistedIp;
    });
};

/**
 * Middleware to enforce IP whitelist
 */
export const requireIpWhitelist = (whitelist?: string[]) => {
    const effectiveWhitelist = whitelist || parseIpWhitelist();
    
    return (req: Request, _res: Response, next: NextFunction): void => {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        
        // Remove IPv6 prefix if present
        const normalizedIp = clientIp.replace(/^::ffff:/, '');
        
        if (!isIpWhitelisted(normalizedIp, effectiveWhitelist)) {
            throw new HttpError(
                403,
                'Access denied: IP address not whitelisted'
            );
        }
        
        next();
    };
};

/**
 * Middleware specifically for admin endpoints
 */
export const requireAdminIpWhitelist = requireIpWhitelist();
