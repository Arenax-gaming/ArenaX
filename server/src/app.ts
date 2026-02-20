import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import passport from 'passport';
import routes from './routes/index';
import { configurePassport } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';

dotenv.config();

configurePassport(passport);

export const createApp = (): Express => {
    const app: Express = express();

    // Middleware
    app.use(helmet());
    app.use(cors());
    app.use(morgan('dev'));
    app.use(express.json());
    app.use(passport.initialize());

    // Routes
    app.use('/api', routes);

    // Health check
    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Error handling
    app.use(errorHandler);

    return app;
};

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`[server]: Server is running at http://localhost:${port}`);
    });
}

export default app;
