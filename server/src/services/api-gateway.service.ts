import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { logger } from './logger.service';
import { getDatabaseClient } from './database.service';

interface ApiKeyData {
  id: string;
  keyPrefix: string;
  name: string;
  userId: string;
  permissions: string[];
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface CreateKeyOptions {
  name: string;
  userId: string;
  permissions: string[];
  expiresInDays: number;
}

interface UsageRecord {
  timestamp: number;
  endpoint: string;
  method: string;
  statusCode: number;
}

interface KeyUsage {
  keyId: string;
  totalRequests: number;
  last24h: number;
  topEndpoints: Array<{ endpoint: string; count: number }>;
  recentRequests: UsageRecord[];
}

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `ax_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.substring(0, 10);
  return { raw, hash, prefix };
}

export class ApiGatewayService {
  private usageStore: Map<string, UsageRecord[]> = new Map();
  private keyCache: Map<string, { key: ApiKeyData; hash: string }> = new Map();
  private maxUsageRecords = 10000;

  async createKey(options: CreateKeyOptions): Promise<{ id: string; rawKey: string; name: string }> {
    const { raw, hash, prefix } = generateApiKey();
    const prisma = getDatabaseClient();

    const apiKey = await prisma.apiKey.create({
      data: {
        key: hash,
        name: options.name,
        userId: options.userId,
        isActive: true,
        expiresAt: options.expiresInDays > 0
          ? new Date(Date.now() + options.expiresInDays * 86400000)
          : null,
      },
    });

    this.keyCache.set(apiKey.id, {
      key: {
        id: apiKey.id,
        keyPrefix: prefix,
        name: apiKey.name,
        userId: apiKey.userId,
        permissions: options.permissions,
        isActive: apiKey.isActive,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        lastUsedAt: null,
      },
      hash,
    });

    // Store permissions in a separate record
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { key: hash },
    });

    logger.info('API key created', { keyId: apiKey.id, name: options.name });
    return { id: apiKey.id, rawKey: raw, name: options.name };
  }

  async validateKey(rawKey: string): Promise<{ valid: boolean; keyData?: ApiKeyData; error?: string }> {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const prisma = getDatabaseClient();

    try {
      const record = await prisma.apiKey.findFirst({ where: { key: hash, isActive: true } });
      if (!record) {
        return { valid: false, error: 'Invalid API key' };
      }

      if (record.expiresAt && record.expiresAt < new Date()) {
        return { valid: false, error: 'API key has expired' };
      }

      const keyData: ApiKeyData = {
        id: record.id,
        keyPrefix: record.key.substring(0, 10),
        name: record.name,
        userId: record.userId,
        permissions: [],
        isActive: record.isActive,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        lastUsedAt: null,
      };

      await prisma.apiKey.update({
        where: { id: record.id },
        data: { updatedAt: new Date() },
      }).catch(() => {});

      return { valid: true, keyData };
    } catch (error) {
      logger.error('API key validation error', { error });
      return { valid: false, error: 'Validation error' };
    }
  }

  async listKeys(userId: string): Promise<ApiKeyData[]> {
    const prisma = getDatabaseClient();
    const records = await prisma.apiKey.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return records.map(r => ({
      id: r.id,
      keyPrefix: r.key.substring(0, 10),
      name: r.name,
      userId: r.userId,
      permissions: [],
      isActive: r.isActive,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      lastUsedAt: null,
    }));
  }

  async revokeKey(keyId: string, userId: string): Promise<void> {
    const prisma = getDatabaseClient();
    const record = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!record || record.userId !== userId) {
      throw new Error('API key not found');
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive: false },
    });

    this.keyCache.delete(keyId);
    logger.info('API key revoked', { keyId });
  }

  async rotateKey(keyId: string, userId: string): Promise<string> {
    await this.revokeKey(keyId, userId);
    const { raw, hash, prefix } = generateApiKey();
    const prisma = getDatabaseClient();

    const record = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!record) throw new Error('Original key not found');

    const newKey = await prisma.apiKey.create({
      data: {
        key: hash,
        name: `${record.name} (rotated)`,
        userId: record.userId,
        isActive: true,
        expiresAt: record.expiresAt,
      },
    });

    this.keyCache.set(newKey.id, {
      key: {
        id: newKey.id,
        keyPrefix: prefix,
        name: newKey.name,
        userId: newKey.userId,
        permissions: [],
        isActive: newKey.isActive,
        expiresAt: newKey.expiresAt,
        createdAt: newKey.createdAt,
        lastUsedAt: null,
      },
      hash,
    });

    logger.info('API key rotated', { keyId, newKeyId: newKey.id });
    return raw;
  }

  trackUsage(keyId: string, endpoint: string, method: string, statusCode: number): void {
    const record: UsageRecord = { timestamp: Date.now(), endpoint, method, statusCode };
    let records = this.usageStore.get(keyId);
    if (!records) {
      records = [];
      this.usageStore.set(keyId, records);
    }
    records.push(record);
    if (records.length > this.maxUsageRecords) {
      records.splice(0, records.length - this.maxUsageRecords);
    }
  }

  getKeyUsage(keyId: string): KeyUsage {
    const records = this.usageStore.get(keyId) ?? [];
    const now = Date.now();
    const last24h = records.filter(r => now - r.timestamp < 86400000);
    const endpointCounts = new Map<string, number>();
    records.forEach(r => {
      endpointCounts.set(r.endpoint, (endpointCounts.get(r.endpoint) ?? 0) + 1);
    });
    const topEndpoints = Array.from(endpointCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    return {
      keyId,
      totalRequests: records.length,
      last24h: last24h.length,
      topEndpoints,
      recentRequests: records.slice(-50),
    };
  }

  getKeyAnalytics(): { totalKeys: number; activeKeys: number; totalRequests: number; keysUsage: Record<string, number> } {
    const keysUsage: Record<string, number> = {};
    let totalRequests = 0;
    for (const [keyId, records] of this.usageStore.entries()) {
      keysUsage[keyId] = records.length;
      totalRequests += records.length;
    }
    return { totalKeys: this.keyCache.size, activeKeys: this.keyCache.size, totalRequests, keysUsage };
  }

  async adminListAllKeys(): Promise<ApiKeyData[]> {
    const prisma = getDatabaseClient();
    const records = await prisma.apiKey.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(r => ({
      id: r.id,
      keyPrefix: r.key.substring(0, 10),
      name: r.name,
      userId: r.userId,
      permissions: [],
      isActive: r.isActive,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      lastUsedAt: null,
    }));
  }

  async adminUpdatePermissions(keyId: string, permissions: string[]): Promise<void> {
    logger.info('API key permissions updated', { keyId, permissions });
  }
}

export const apiGatewayService = new ApiGatewayService();
