import prisma, { getDatabaseClient } from './database.service';
import { FeatureFlag, Prisma } from '@prisma/client';
import { cacheService } from './cache.service';
import { logger } from './logger.service';
import { SUPPORTED_REGIONS } from './region.service';
import * as crypto from 'crypto';

export interface EvaluationContext {
    userId?: string;
    role?: string;
    email?: string;
    ip?: string;
    region?: string;
    betaOnly?: boolean;
    beta?: boolean;
    isBeta?: boolean;
    [key: string]: any;
}

export interface FlagRule {
    type?: 'percentage' | 'userIds' | 'region' | 'betaOnly' | 'user' | 'role' | 'email' | string;
    value?: number | string; // for percentage rollout (0-100) or legacy
    percentage?: number;
    userIds?: string[];
    region?: string;
    regions?: string[];
    betaOnly?: boolean;
    isBeta?: boolean;
    roles?: string[];
    domains?: string[];
    enabled?: boolean;
}

export interface EvaluationResult {
    enabled: boolean;
    reason: string;
}

function matchesRegion(targetRegion: string, contextRegion?: string): boolean {
    if (!contextRegion || !targetRegion) return false;
    const normTarget = targetRegion.trim().toUpperCase();
    const normContext = contextRegion.trim().toUpperCase();
    if (normTarget === normContext) return true;

    for (const [code, config] of Object.entries(SUPPORTED_REGIONS)) {
        const c = code.toUpperCase();
        const n = config.name.toUpperCase();
        if ((normTarget === c || normTarget === n) && (normContext === c || normContext === n)) {
            return true;
        }
    }

    return false;
}

export class FeatureFlagService {
    private get db() {
        return getDatabaseClient() || prisma;
    }

    private getCacheKey(key: string): string {
        return `ff:${key}`;
    }

    private getEvalCacheKey(key: string, userId: string): string {
        return `ff:eval:${key}:${userId}`;
    }

    async getFlag(key: string): Promise<FeatureFlag | null> {
        const cacheKey = this.getCacheKey(key);
        try {
            const cached = await cacheService.get<FeatureFlag>(cacheKey);
            if (cached !== null) {
                return cached;
            }
        } catch (err) {
            logger.warn('Failed to get feature flag from cache', { key, error: err });
        }

        const flag = await this.db.featureFlag.findUnique({
            where: { key }
        });

        if (flag) {
            await cacheService.set(cacheKey, flag, 300); // 5 min TTL
        }
        return flag;
    }

    async evaluateDetail(key: string, context: EvaluationContext = {}): Promise<EvaluationResult> {
        const evalCacheKey = context.userId ? this.getEvalCacheKey(key, context.userId) : null;
        if (evalCacheKey) {
            try {
                const cached = await cacheService.get<EvaluationResult>(evalCacheKey);
                if (cached !== null) {
                    return cached;
                }
            } catch (err) {
                logger.warn('Failed to get evaluated feature flag from cache', { key, userId: context.userId, error: err });
            }
        }

        const flag = await this.getFlag(key);
        if (!flag) {
            return {
                enabled: false,
                reason: `Feature flag '${key}' not found`
            };
        }

        if (!flag.isEnabled) {
            const result: EvaluationResult = {
                enabled: false,
                reason: `Feature flag '${key}' is disabled globally`
            };
            if (evalCacheKey) {
                try {
                    await cacheService.set(evalCacheKey, result, 60);
                } catch (err) {
                    logger.warn('Failed to cache evaluated feature flag', { key, userId: context.userId, error: err });
                }
            }
            return result;
        }

        const rules = flag.rules as unknown as FlagRule[];
        if (!rules || !Array.isArray(rules) || rules.length === 0) {
            const result: EvaluationResult = {
                enabled: true,
                reason: 'Flag is enabled with no targeting rules'
            };
            if (evalCacheKey) {
                try {
                    await cacheService.set(evalCacheKey, result, 60);
                } catch (err) {
                    logger.warn('Failed to cache evaluated feature flag', { key, userId: context.userId, error: err });
                }
            }
            return result;
        }

        let evaluationResult: EvaluationResult | null = null;

        for (const rule of rules) {
            // 1. userIds targeting
            if (rule.type === 'userIds' || rule.type === 'user' || (rule.userIds && Array.isArray(rule.userIds))) {
                const userIds = rule.userIds || [];
                if (context.userId && userIds.includes(context.userId)) {
                    const isEnabled = rule.enabled !== false;
                    evaluationResult = {
                        enabled: isEnabled,
                        reason: isEnabled
                            ? `Matched userIds rule for user ${context.userId}`
                            : `User ${context.userId} explicitly disabled by rule`
                    };
                    break;
                }
                continue;
            }

            // 2. percentage rollout targeting
            const pct = rule.percentage !== undefined
                ? rule.percentage
                : (rule.type === 'percentage' && typeof rule.value === 'number'
                    ? rule.value
                    : (rule.type === undefined && typeof rule.value === 'number' ? rule.value : undefined));

            if (pct !== undefined) {
                if (context.userId) {
                    const hash = crypto.createHash('sha256').update(`${context.userId}-${key}`).digest('hex');
                    const score = parseInt(hash.substring(0, 8), 16) % 100;
                    if (score < pct) {
                        const isEnabled = rule.enabled !== false;
                        evaluationResult = {
                            enabled: isEnabled,
                            reason: isEnabled
                                ? `Matched percentage rollout rule (${pct}%) with score ${score}`
                                : `Disabled by percentage rule (${pct}%)`
                        };
                        break;
                    }
                }
                continue;
            }

            // 3. region targeting
            if (rule.type === 'region' || rule.region !== undefined || rule.regions !== undefined || (rule.type === 'region' && typeof rule.value === 'string')) {
                const targetRegions: string[] = [];
                if (rule.region) targetRegions.push(rule.region);
                if (Array.isArray(rule.regions)) targetRegions.push(...rule.regions);
                if (rule.type === 'region' && typeof rule.value === 'string') targetRegions.push(rule.value);

                if (context.region && targetRegions.some(tr => matchesRegion(tr, context.region))) {
                    const isEnabled = rule.enabled !== false;
                    evaluationResult = {
                        enabled: isEnabled,
                        reason: isEnabled
                            ? `Matched region rule for region ${context.region}`
                            : `Disabled by region rule for region ${context.region}`
                    };
                    break;
                }
                continue;
            }

            // 4. betaOnly targeting
            if (rule.type === 'betaOnly' || rule.type === 'beta' || rule.betaOnly !== undefined) {
                const isBetaUser = Boolean(context.isBeta ?? context.beta ?? context.betaOnly);
                const requireBeta = rule.betaOnly !== false;
                if (requireBeta) {
                    if (isBetaUser) {
                        const isEnabled = rule.enabled !== false;
                        evaluationResult = {
                            enabled: isEnabled,
                            reason: isEnabled
                                ? 'Matched betaOnly rule for beta user'
                                : 'Disabled by betaOnly rule for beta user'
                        };
                        break;
                    }
                } else {
                    if (!isBetaUser) {
                        const isEnabled = rule.enabled !== false;
                        evaluationResult = {
                            enabled: isEnabled,
                            reason: isEnabled
                                ? 'Matched non-beta rule for standard user'
                                : 'Disabled by non-beta rule'
                        };
                        break;
                    }
                }
                continue;
            }

            // 5. role targeting (legacy / backward-compatibility)
            if (rule.type === 'role' && rule.roles && context.role) {
                if (rule.roles.includes(context.role)) {
                    const isEnabled = rule.enabled !== false;
                    evaluationResult = {
                        enabled: isEnabled,
                        reason: isEnabled
                            ? `Matched role rule for role ${context.role}`
                            : `Disabled by role rule for role ${context.role}`
                    };
                    break;
                }
                continue;
            }

            // 6. email domain targeting (legacy / backward-compatibility)
            if (rule.type === 'email' && rule.domains && context.email) {
                const domain = context.email.split('@')[1];
                if (domain && rule.domains.includes(domain)) {
                    const isEnabled = rule.enabled !== false;
                    evaluationResult = {
                        enabled: isEnabled,
                        reason: isEnabled
                            ? `Matched email domain rule for domain ${domain}`
                            : `Disabled by email domain rule for domain ${domain}`
                    };
                    break;
                }
                continue;
            }
        }

        if (!evaluationResult) {
            evaluationResult = {
                enabled: false,
                reason: 'No targeting rules matched'
            };
        }

        if (evalCacheKey) {
            try {
                await cacheService.set(evalCacheKey, evaluationResult, 60); // 60 seconds TTL
            } catch (err) {
                logger.warn('Failed to cache evaluated feature flag', { key, userId: context.userId, error: err });
            }
        }

        return evaluationResult;
    }

    async evaluate(key: string, context: EvaluationContext = {}): Promise<boolean> {
        const result = await this.evaluateDetail(key, context);
        return result.enabled;
    }

    async createFlag(
        data: { key: string; description?: string; isEnabled?: boolean; rules?: FlagRule[] },
        adminId: string
    ): Promise<FeatureFlag> {
        const flag = await this.db.featureFlag.create({
            data: {
                key: data.key,
                description: data.description,
                isEnabled: data.isEnabled ?? false,
                rules: (data.rules ?? []) as unknown as Prisma.InputJsonValue
            }
        });

        await this.db.featureFlagAuditLog.create({
            data: {
                flagId: flag.id,
                action: 'CREATE',
                changedBy: adminId,
                changes: { before: null, after: flag }
            }
        });

        await cacheService.set(this.getCacheKey(flag.key), flag, 300);
        return flag;
    }

    async updateFlag(
        key: string,
        data: { description?: string; isEnabled?: boolean; rules?: FlagRule[] },
        adminId: string
    ): Promise<FeatureFlag> {
        const oldFlag = await this.db.featureFlag.findUnique({ where: { key } });
        if (!oldFlag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        const updateData: any = {};
        if (data.description !== undefined) updateData.description = data.description;
        if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
        if (data.rules !== undefined) updateData.rules = data.rules;

        const newFlag = await this.db.featureFlag.update({
            where: { key },
            data: updateData
        });

        await this.db.featureFlagAuditLog.create({
            data: {
                flagId: oldFlag.id,
                action: 'UPDATE',
                changedBy: adminId,
                changes: { before: oldFlag, after: newFlag }
            }
        });

        await cacheService.set(this.getCacheKey(key), newFlag, 300);
        return newFlag;
    }

    async deleteFlag(key: string, adminId: string): Promise<void> {
        const flag = await this.db.featureFlag.findUnique({ where: { key } });
        if (!flag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        await this.db.featureFlagAuditLog.create({
            data: {
                flagId: flag.id,
                action: 'DELETE',
                changedBy: adminId,
                changes: { before: flag, after: null }
            }
        });

        await this.db.featureFlag.delete({ where: { key } });
        await cacheService.delete(this.getCacheKey(key));
    }

    async getAuditLogs(key: string) {
        const flag = await this.db.featureFlag.findUnique({ where: { key } });
        if (!flag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        return this.db.featureFlagAuditLog.findMany({
            where: { flagId: flag.id },
            orderBy: { createdAt: 'desc' }
        });
    }

    async listFlags() {
        return this.db.featureFlag.findMany({
            orderBy: { key: 'asc' }
        });
    }
}

export const featureFlagService = new FeatureFlagService();
