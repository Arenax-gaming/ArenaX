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

        const adminId = req.user?.id || 'system';
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

        const adminId = req.user?.id || 'system';
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
        const adminId = req.user?.id || 'system';
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
        const { key } = req.params;
        const { userId, role, email, ip } = req.body;

        const isEnabled = await featureFlagService.evaluate(key, {
            userId: userId || req.user?.id,
            role: role || req.user?.role,
            email: email || req.user?.email,
            ip: ip || req.ip
        });

        res.status(200).json({ key, isEnabled });
    } catch (error) {
        logger.error('Failed to evaluate feature flag', { error });
        res.status(500).json({ error: (error as Error).message });
    }
};
