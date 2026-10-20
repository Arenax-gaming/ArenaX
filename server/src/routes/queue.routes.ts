import { Router, Request, Response } from 'express';
import { authenticateJWT, restrictToScope } from '../middleware/auth.middleware';
import { defaultQueueMonitoringService } from '../services/queue-monitoring.service';
import { getQueueAdapter } from '../services/queue.service';
import { RabbitMQQueueAdapter } from '../services/rabbitmq-queue.service';
import { HttpError } from '../utils/http-error';

const router: Router = Router();

router.use(authenticateJWT);

/**
 * @openapi
 * /v1/queue/stats:
 *   get:
 *     summary: Get queue stats
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    '/stats',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const stats = await defaultQueueMonitoringService.getStats();
        res.json(stats);
    }
);

/**
 * @openapi
 * /v1/queue/health:
 *   get:
 *     summary: Get queue health
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    '/health',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const health = await defaultQueueMonitoringService.getQueueHealth();
        res.json(health);
    }
);

/**
 * @openapi
 * /v1/queue/dead-letters:
 *   get:
 *     summary: Get queue dead letters
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
    '/dead-letters',
    restrictToScope('SYSTEM:READ'),
    async (_req: Request, res: Response) => {
        const adapter = getQueueAdapter();
        const deadLetters = await adapter.listDeadLetters();
        res.json({ deadLetters, count: deadLetters.length });
    }
);

/**
 * @openapi
 * /v1/queue/dead-letters/{id}:
 *   delete:
 *     summary: Delete queue dead letters
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '204':
 *         description: Successful response
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
    '/dead-letters/:id',
    restrictToScope('SYSTEM:WRITE'),
    async (req: Request, res: Response) => {
        const adapter = getQueueAdapter();
        await adapter.discardDeadLetter(req.params.id);
        res.status(204).send();
    }
);

/**
 * @openapi
 * /v1/queue/metrics:
 *   get:
 *     summary: Get queue metrics
 *     tags: [Queue]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '401':
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
