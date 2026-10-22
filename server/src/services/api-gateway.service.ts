import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { logger } from './logger.service';
import { getDatabaseClient } from './database.service';
import { HttpError } from '../utils/http-error';

/**
 * Permission scopes a third-party API key can be granted (#1420).
 * Format: `<action>:<resource>`.
 */
export const API_KEY_SCOPES = [
  'read:tournaments',
  'write:tournaments',
  'read:matches',
  'write:results',
  'read:leaderboards',
  'read:profiles',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Default overlap during which a rotated key keeps working (24h). */
export const DEFAULT_ROTATION_OVERLAP_SECONDS = Number(
  process.env.API_KEY_ROTATION_OVERLAP_SECONDS ?? 86400,
);
/** Upper bound for a configurable rotation overlap (30 days). */
export const MAX_ROTATION_OVERLAP_SECONDS = 30 * 86400;

interface ApiKeyData {
  id: string;
  keyPrefix: string;
  name: string;
  userId: string;
  permissions: string[];
  isActive: boolean;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
  rotatedFromId: string | null;
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

/** Persisted API key row. `key` is the SHA-256 hash; the raw key is never stored. */
export interface ApiKeyRecord {
  id: string;
  key: string;
  keyPrefix: string | null;
  name: string;
  userId: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
  rotatedFromId: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export type NewApiKeyRecord = Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt'>;

export interface ApiKeyStore {
  create(data: NewApiKeyRecord): Promise<ApiKeyRecord>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  update(id: string, data: Partial<NewApiKeyRecord> & { lastUsedAt?: Date }): Promise<ApiKeyRecord>;
  list(filter: { userId?: string }): Promise<ApiKeyRecord[]>;
}

/** Prisma-backed store (production). */
export class PrismaApiKeyStore implements ApiKeyStore {
  async create(data: NewApiKeyRecord): Promise<ApiKeyRecord> {
    return getDatabaseClient().apiKey.create({ data });
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    return getDatabaseClient().apiKey.findUnique({ where: { id } });
  }

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return getDatabaseClient().apiKey.findUnique({ where: { key: hash } });
  }

  async update(
    id: string,
    data: Partial<NewApiKeyRecord> & { lastUsedAt?: Date },
  ): Promise<ApiKeyRecord> {
    return getDatabaseClient().apiKey.update({ where: { id }, data });
  }

  async list(filter: { userId?: string }): Promise<ApiKeyRecord[]> {
    return getDatabaseClient().apiKey.findMany({
      where: { isActive: true, ...(filter.userId ? { userId: filter.userId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}

/** In-memory store for tests and local tooling. */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private rows = new Map<string, ApiKeyRecord>();

  async create(data: NewApiKeyRecord): Promise<ApiKeyRecord> {
    const row: ApiKeyRecord = { ...data, id: randomUUID(), createdAt: new Date(), lastUsedAt: null };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    for (const row of this.rows.values()) {
      if (row.key === hash) return { ...row };
    }
    return null;
  }

  async update(
    id: string,
    data: Partial<NewApiKeyRecord> & { lastUsedAt?: Date },
  ): Promise<ApiKeyRecord> {
    const row = this.rows.get(id);
    if (!row) throw new Error('API key not found');
    Object.assign(row, data);
    return { ...row };
  }

  async list(filter: { userId?: string }): Promise<ApiKeyRecord[]> {
    return [...this.rows.values()]
      .filter(r => r.isActive && (!filter.userId || r.userId === filter.userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(r => ({ ...r }));
  }
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `ax_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.substring(0, 10) };
}

/** Throws if any scope is not a known {@link ApiKeyScope}; returns the de-duplicated list. */
export function validateScopes(scopes: unknown): ApiKeyScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new HttpError(400, 'At least one scope is required');
  }
  const unknown = scopes.filter(s => !(API_KEY_SCOPES as readonly string[]).includes(s));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown API key scope(s): ${unknown.join(', ')}`);
  }
  return [...new Set(scopes as ApiKeyScope[])];
}

/** True when `granted` covers every scope in `required`. */
export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
  return required.every(scope => granted.includes(scope));
}

function toKeyData(r: ApiKeyRecord): ApiKeyData {
  return {
    id: r.id,
    keyPrefix: r.keyPrefix ?? '',
    name: r.name,
    userId: r.userId,
    permissions: r.scopes,
    isActive: r.isActive,
    expiresAt: r.expiresAt,
    graceExpiresAt: r.graceExpiresAt,
    rotatedFromId: r.rotatedFromId,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  };
}

export class ApiGatewayService {
  private usageStore: Map<string, UsageRecord[]> = new Map();
  private maxUsageRecords = 10000;

  constructor(private readonly store: ApiKeyStore = new PrismaApiKeyStore()) {}

  async createKey(options: CreateKeyOptions): Promise<{ id: string; rawKey: string; name: string; scopes: string[] }> {
    const scopes = validateScopes(options.permissions);
    const { raw, hash, prefix } = generateApiKey();

    const apiKey = await this.store.create({
      key: hash,
      keyPrefix: prefix,
      name: options.name,
      userId: options.userId,
      scopes,
      isActive: true,
      expiresAt: options.expiresInDays > 0
        ? new Date(Date.now() + options.expiresInDays * 86400000)
        : null,
      graceExpiresAt: null,
      rotatedFromId: null,
    });

    logger.info('API key created', { keyId: apiKey.id, name: options.name, scopes });
    return { id: apiKey.id, rawKey: raw, name: options.name, scopes };
  }

  async validateKey(rawKey: string): Promise<{ valid: boolean; keyData?: ApiKeyData; error?: string }> {
    try {
      const record = await this.store.findByHash(hashApiKey(rawKey));
      if (!record || !record.isActive) {
        return { valid: false, error: 'Invalid API key' };
      }

      const now = new Date();
      if (record.expiresAt && record.expiresAt <= now) {
        return { valid: false, error: 'API key has expired' };
      }
      if (record.graceExpiresAt && record.graceExpiresAt <= now) {
        return { valid: false, error: 'API key has been rotated' };
      }

      await this.store.update(record.id, { lastUsedAt: now }).catch(() => {});

      return { valid: true, keyData: toKeyData({ ...record, lastUsedAt: now }) };
    } catch (error) {
      logger.error('API key validation error', { error });
      return { valid: false, error: 'Validation error' };
    }
  }

  async listKeys(userId: string): Promise<ApiKeyData[]> {
    const records = await this.store.list({ userId });
    return records.map(toKeyData);
  }

  async revokeKey(keyId: string, userId: string): Promise<void> {
    const record = await this.store.findById(keyId);
    if (!record || record.userId !== userId) {
      throw new HttpError(404, 'API key not found');
    }

    await this.store.update(keyId, { isActive: false });
    logger.info('API key revoked', { keyId });
  }

  /**
   * Issue a replacement key with the same scopes. The old key stays valid for
   * `overlapSeconds` (0 = revoke immediately) so clients can roll over
   * without downtime. Pass `userId = null` for admin rotation of any key.
   */
  async rotateKey(
    keyId: string,
    userId: string | null,
    overlapSeconds: number = DEFAULT_ROTATION_OVERLAP_SECONDS,
  ): Promise<{ id: string; rawKey: string; oldKeyValidUntil: Date | null }> {
    if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > MAX_ROTATION_OVERLAP_SECONDS) {
      throw new HttpError(400, `overlapSeconds must be between 0 and ${MAX_ROTATION_OVERLAP_SECONDS}`);
    }

    const record = await this.store.findById(keyId);
    if (!record || !record.isActive || (userId !== null && record.userId !== userId)) {
      throw new HttpError(404, 'API key not found');
    }
    if (record.graceExpiresAt) {
      throw new HttpError(409, 'API key has already been rotated');
    }

    const { raw, hash, prefix } = generateApiKey();
    const newKey = await this.store.create({
      key: hash,
      keyPrefix: prefix,
      name: record.name,
      userId: record.userId,
      scopes: record.scopes,
      isActive: true,
      expiresAt: record.expiresAt,
      graceExpiresAt: null,
      rotatedFromId: record.id,
    });

    let oldKeyValidUntil: Date | null = null;
    if (overlapSeconds === 0) {
      await this.store.update(record.id, { isActive: false });
    } else {
      oldKeyValidUntil = new Date(Date.now() + overlapSeconds * 1000);
      await this.store.update(record.id, { graceExpiresAt: oldKeyValidUntil });
    }

    logger.info('API key rotated', { keyId, newKeyId: newKey.id, overlapSeconds });
    return { id: newKey.id, rawKey: raw, oldKeyValidUntil };
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
    const trackedKeys = this.usageStore.size;
    return { totalKeys: trackedKeys, activeKeys: trackedKeys, totalRequests, keysUsage };
  }

  async adminCreateKey(options: CreateKeyOptions): Promise<{ id: string; rawKey: string; name: string; scopes: string[] }> {
    return this.createKey(options);
  }

  async adminListAllKeys(): Promise<ApiKeyData[]> {
    const records = await this.store.list({});
    return records.map(toKeyData);
  }

  async adminUpdatePermissions(keyId: string, permissions: string[]): Promise<void> {
    const scopes = validateScopes(permissions);
    const record = await this.store.findById(keyId);
    if (!record) {
      throw new HttpError(404, 'API key not found');
    }
    await this.store.update(keyId, { scopes });
    logger.info('API key permissions updated', { keyId, scopes });
  }
}

export const apiGatewayService = new ApiGatewayService();
