import { Request, Response, NextFunction } from 'express';
import { apiGatewayService } from '../services/api-gateway.service';
import { v4 as uuid } from 'uuid';
import { HttpError } from '../utils/http-error';

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
      permissions: permissions ?? ['read'],
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
    const newKey = await apiGatewayService.rotateKey(id, req.user!.id);
    res.json({ apiKey: newKey, message: 'Store this new key securely' });
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
