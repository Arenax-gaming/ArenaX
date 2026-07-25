import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictToScope } from '../middleware/auth.middleware';
import { defaultQueueMonitoringService } from '../services/queue-monitoring.service';
import { getQueueAdapter } from '../services/queue.service';
import { RabbitMQQueueAdapter } from '../services/rabbitmq-queue.service';
import { HttpError } from '../utils/http-error';

const router: Router = Router();

router.use(authenticateJWT);

router.get(
    '/stats',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const stats = await defaultQueueMonitoringService.getStats();
        res.json(stats);
    }
);

router.get(
    '/health',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const health = await defaultQueueMonitoringService.getQueueHealth();
        res.json(health);
    }
);

router.get(
    '/dead-letters',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const adapter = getQueueAdapter();
        const deadLetters = await adapter.listDeadLetters();
        res.json({ deadLetters, count: deadLetters.length });
    }
);

router.delete(
    '/dead-letters/:id',
    restrictToScope('SYSTEM:WRITE'),
    async (req: Request, res: Response) => {
        const adapter = getQueueAdapter();
        await adapter.discardDeadLetter(req.params.id);
        res.status(204).send();
    }
);

router.get(
    '/metrics',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const stats = await defaultQueueMonitoringService.getStats();
        const adapter = getQueueAdapter();
        const deadLetters = await adapter.listDeadLetters();

        const metrics = {
            connected: stats.connected,
            totalQueues: stats.queues.filter((q) => !q.queue.startsWith('arenax.dlq.')).length,
            totalDlqQueues: stats.queues.filter((q) => q.queue.startsWith('arenax.dlq.')).length,
            totalMessages: stats.queues.reduce((sum, q) => sum + q.messages, 0),
            totalConsumers: stats.queues.reduce((sum, q) => sum + q.consumers, 0),
            deadLetterCount: deadLetters.length,
            queues: stats.queues,
            timestamp: stats.timestamp,
        };
        res.json(metrics);
    }
);

export default router;
