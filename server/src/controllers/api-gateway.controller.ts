import { Request, Response, NextFunction } from 'express';
import { apiGatewayService } from '../services/api-gateway.service';
import { HttpError } from '../utils/http-error';

function parseOverlapSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpError(400, 'overlapSeconds must be a number');
  }
  return n;
}

export async function createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, permissions, expiresInDays } = req.body as {
      name?: string;
      permissions?: string[];
      expiresInDays?: number;
    };
    if (!name) {
      throw new HttpError(400, 'name is required');
    }
    const apiKey = await apiGatewayService.createKey({
      name,
      userId: req.user!.id,
      permissions: permissions ?? ['read:tournaments'],
      expiresInDays: expiresInDays ?? 365,
    });
    res.status(201).json({ apiKey, message: 'Store this key securely — it will not be shown again' });
  } catch (err) {
    next(err);
  }
}

export async function listApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keys = await apiGatewayService.listKeys(req.user!.id);
    res.json({ keys });
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    await apiGatewayService.revokeKey(id, req.user!.id);
    res.json({ message: 'API key revoked' });
  } catch (err) {
    next(err);
  }
}

export async function rotateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const overlapSeconds = parseOverlapSeconds((req.body as { overlapSeconds?: unknown })?.overlapSeconds);
    const rotated = await apiGatewayService.rotateKey(id, req.user!.id, overlapSeconds);
    res.json({
      apiKey: rotated.rawKey,
      id: rotated.id,
      oldKeyValidUntil: rotated.oldKeyValidUntil,
      message: 'Store this new key securely',
    });
  } catch (err) {
    next(err);
  }
}

export async function getApiKeyAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const analytics = apiGatewayService.getKeyAnalytics();
    res.json({ analytics });
  } catch (err) {
    next(err);
  }
}

export async function getApiKeyUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const usage = apiGatewayService.getKeyUsage(id);
    res.json({ usage });
  } catch (err) {
    next(err);
  }
}

export async function adminCreateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, userId, scopes, expiresInDays } = req.body as {
      name?: string;
      userId?: string;
      scopes?: string[];
      expiresInDays?: number;
    };
    if (!name || !userId) {
      throw new HttpError(400, 'name and userId are required');
    }
    if (!scopes) {
      throw new HttpError(400, 'scopes is required');
    }
    const apiKey = await apiGatewayService.adminCreateKey({
      name,
      userId,
      permissions: scopes,
      expiresInDays: expiresInDays ?? 365,
    });
    res.status(201).json({ apiKey, message: 'Store this key securely — it will not be shown again' });
  } catch (err) {
    next(err);
  }
}

export async function adminRotateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const overlapSeconds = parseOverlapSeconds((req.body as { overlapSeconds?: unknown })?.overlapSeconds);
    const rotated = await apiGatewayService.rotateKey(id, null, overlapSeconds);
    res.json({
      apiKey: rotated.rawKey,
      id: rotated.id,
      oldKeyValidUntil: rotated.oldKeyValidUntil,
      message: 'Store this new key securely',
    });
  } catch (err) {
    next(err);
  }
}

export async function adminListAllKeys(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keys = await apiGatewayService.adminListAllKeys();
    res.json({ keys });
  } catch (err) {
    next(err);
  }
}

export async function adminUpdateKeyPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { permissions } = req.body as { permissions?: string[] };
    if (!permissions) {
      throw new HttpError(400, 'permissions is required');
    }
    await apiGatewayService.adminUpdatePermissions(id, permissions);
    res.json({ message: 'Permissions updated' });
  } catch (err) {
    next(err);
  }
}
