import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import routes from './routes/index';
import { errorHandler } from './middleware/error.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { logger } from './services/logger.service';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req: Request, res: Response) => {
    req.log.info('Health check invoked');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

app.listen(port, () => {
    logger.info('Server started', { url: `http://localhost:${port}` });
});

export default app;
