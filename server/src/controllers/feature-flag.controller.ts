import { Request, Response } from 'express';
import { featureFlagService } from '../services/feature-flag.service';
import { logger } from '../services/logger.service';

export const listFlags = async (req: Request, res: Response): Promise<void> => {
    try {
        const flags = await featureFlagService.listFlags();
        res.status(200).json(flags);
    } catch (error) {
        logger.error('Failed to list feature flags', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

export const getFlag = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key } = req.params;
        const flag = await featureFlagService.getFlag(key);
        if (!flag) {
            res.status(404).json({ error: `Feature flag '${key}' not found` });
            return;
        }
        res.status(200).json(flag);
    } catch (error) {
        logger.error('Failed to get feature flag', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

export const createFlag = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key, description, isEnabled, rules } = req.body;
        if (!key) {
            res.status(400).json({ error: 'Key is required' });
            return;
        }

        const user = req.user as any;
        const adminId = user?.id || 'system';
        const flag = await featureFlagService.createFlag({ key, description, isEnabled, rules }, adminId);
        res.status(201).json(flag);
    } catch (error) {
        logger.error('Failed to create feature flag', { error });
        res.status(400).json({ error: (error as Error).message });
    }
};

export const updateFlag = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key } = req.params;
        const { description, isEnabled, rules } = req.body;

        const user = req.user as any;
        const adminId = user?.id || 'system';
        const flag = await featureFlagService.updateFlag(key, { description, isEnabled, rules }, adminId);
        res.status(200).json(flag);
    } catch (error) {
        logger.error('Failed to update feature flag', { error });
        res.status(400).json({ error: (error as Error).message });
    }
};

export const deleteFlag = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key } = req.params;
        const user = req.user as any;
        const adminId = user?.id || 'system';
        await featureFlagService.deleteFlag(key, adminId);
        res.status(200).json({ message: `Feature flag '${key}' deleted successfully` });
    } catch (error) {
        logger.error('Failed to delete feature flag', { error });
        res.status(400).json({ error: (error as Error).message });
    }
};

export const getAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
        const { key } = req.params;
        const logs = await featureFlagService.getAuditLogs(key);
        res.status(200).json(logs);
    } catch (error) {
        logger.error('Failed to get audit logs', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};

export const evaluateFlag = async (req: Request, res: Response): Promise<void> => {
    try {
        const flagKey = req.params.flagKey || req.params.key;
        if (!flagKey) {
            res.status(400).json({ error: 'Flag key is required' });
            return;
        }

        const user = req.user as any;
        const userId = (req.query?.userId as string) || req.body?.userId || user?.id || (req.headers['x-user-id'] as string);
        const role = (req.query?.role as string) || req.body?.role || user?.role;
        const email = (req.query?.email as string) || req.body?.email || user?.email;
        const ip = (req.query?.ip as string) || req.body?.ip || req.ip;
        const region = (req.query?.region as string) || req.body?.region || (req.headers['x-user-region'] as string) || (req.headers['cf-ipcountry'] as string);

        const rawBeta = req.query?.beta ?? req.query?.betaOnly ?? req.query?.isBeta ?? req.body?.beta ?? req.body?.betaOnly ?? req.body?.isBeta ?? req.headers['x-user-beta'];
        const isBeta = rawBeta !== undefined ? (rawBeta === true || rawBeta === 'true' || rawBeta === '1') : Boolean(user?.isBeta || user?.beta);

        const result = await featureFlagService.evaluateDetail(flagKey, {
            userId,
            role,
            email,
            ip,
            region,
            isBeta,
            beta: isBeta
        });

        res.status(200).json({
            enabled: result.enabled,
            reason: result.reason
        });
    } catch (error) {
        logger.error('Failed to evaluate feature flag', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};
