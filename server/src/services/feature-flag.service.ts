import prisma from './database.service';
import { FeatureFlag } from '@prisma/client';
import { cacheService } from './cache.service';
import { logger } from './logger.service';
import * as crypto from 'crypto';

export interface EvaluationContext {
    userId?: string;
    role?: string;
    email?: string;
    ip?: string;
}

export interface FlagRule {
    type: 'percentage' | 'user' | 'role' | 'email';
    value?: number; // for percentage rollout (0-100)
    userIds?: string[];
    roles?: string[];
    domains?: string[];
}

export class FeatureFlagService {
    private getCacheKey(key: string): string {
        return `ff:${key}`;
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

        const flag = await prisma.featureFlag.findUnique({
            where: { key }
        });

        if (flag) {
            await cacheService.set(cacheKey, flag, 300); // 5 min TTL
        }
        return flag;
    }

    async evaluate(key: string, context: EvaluationContext): Promise<boolean> {
        const flag = await this.getFlag(key);
        if (!flag || !flag.isEnabled) {
            return false;
        }

        const rules = flag.rules as unknown as FlagRule[];
        if (!rules || !Array.isArray(rules) || rules.length === 0) {
            return true;
        }

        for (const rule of rules) {
            if (rule.type === 'user' && rule.userIds && context.userId) {
                if (rule.userIds.includes(context.userId)) {
                    return true;
                }
            }

            if (rule.type === 'role' && rule.roles && context.role) {
                if (rule.roles.includes(context.role)) {
                    return true;
                }
            }

            if (rule.type === 'email' && rule.domains && context.email) {
                const domain = context.email.split('@')[1];
                if (domain && rule.domains.includes(domain)) {
                    return true;
                }
            }

            if (rule.type === 'percentage' && rule.value !== undefined && context.userId) {
                const hash = crypto.createHash('sha256').update(`${context.userId}-${key}`).digest('hex');
                const score = parseInt(hash.substring(0, 8), 16) % 100;
                if (score < rule.value) {
                    return true;
                }
            }
        }

        return false;
    }

    async createFlag(
        data: { key: string; description?: string; isEnabled?: boolean; rules?: FlagRule[] },
        adminId: string
    ): Promise<FeatureFlag> {
        const flag = await prisma.featureFlag.create({
            data: {
                key: data.key,
                description: data.description,
                isEnabled: data.isEnabled ?? false,
                rules: data.rules ?? []
            }
        });

        await prisma.featureFlagAuditLog.create({
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
        const oldFlag = await prisma.featureFlag.findUnique({ where: { key } });
        if (!oldFlag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        const updateData: any = {};
        if (data.description !== undefined) updateData.description = data.description;
        if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
        if (data.rules !== undefined) updateData.rules = data.rules;

        const newFlag = await prisma.featureFlag.update({
            where: { key },
            data: updateData
        });

        await prisma.featureFlagAuditLog.create({
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
        const flag = await prisma.featureFlag.findUnique({ where: { key } });
        if (!flag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        await prisma.featureFlagAuditLog.create({
            data: {
                flagId: flag.id,
                action: 'DELETE',
                changedBy: adminId,
                changes: { before: flag, after: null }
            }
        });

        await prisma.featureFlag.delete({ where: { key } });
        await cacheService.delete(this.getCacheKey(key));
    }

    async getAuditLogs(key: string) {
        const flag = await prisma.featureFlag.findUnique({ where: { key } });
        if (!flag) {
            throw new Error(`Feature flag ${key} not found`);
        }

        return prisma.featureFlagAuditLog.findMany({
            where: { flagId: flag.id },
            orderBy: { createdAt: 'desc' }
        });
    }

    async listFlags() {
        return prisma.featureFlag.findMany({
            orderBy: { key: 'asc' }
        });
    }
}

export const featureFlagService = new FeatureFlagService();
