import { Request, Response, NextFunction } from 'express';
import { apiGatewayService } from '../services/api-gateway.service';
import { HttpError } from '../utils/http-error';

const API_KEY_HEADER = 'x-api-key';
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers[API_KEY_HEADER] as string | undefined;

  if (!apiKey) {
    return next(new HttpError(401, 'API key is required. Provide it via the X-API-Key header.'));
  }

  const result = await apiGatewayService.validateKey(apiKey);

  if (!result.valid) {
    return next(new HttpError(401, result.error ?? 'Invalid API key'));
  }

  const keyData = result.keyData!;
  req.apiKeyInfo = {
    keyId: keyData.id,
    keyPrefix: keyData.keyPrefix,
    name: keyData.name,
    userId: keyData.userId,
    permissions: keyData.permissions,
  };

  next();
}

export async function apiKeyRateLimiter(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const keyId = req.apiKeyInfo?.keyId;
  if (!keyId) return next();

  const now = Date.now();
  let entry = rateLimitStore.get(keyId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(keyId, entry);
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW - now) / 1000);
    return next(new HttpError(429, `Rate limit exceeded. Retry after ${retryAfter} seconds.`));
  }

  next();
}

export function requireApiPermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKeyInfo) {
      return next(new HttpError(401, 'API key authentication required'));
    }
    next();
  };
}

export function trackApiUsage(req: Request, _res: Response, next: NextFunction): void {
  const originalEnd = _res.end.bind(_res);
  const keyId = req.apiKeyInfo?.keyId;

  if (keyId) {
    _res.on('finish', () => {
      apiGatewayService.trackUsage(keyId, req.originalUrl, req.method, _res.statusCode);
    });
  }

  next();
}

declare global {
  namespace Express {
    interface Request {
      apiKeyInfo?: {
        keyId: string;
        keyPrefix: string;
        name: string;
        userId: string;
        permissions: string[];
      };
    }
  }
}
