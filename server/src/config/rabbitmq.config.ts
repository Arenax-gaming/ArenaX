import amqplib from 'amqplib';
import { getEnv } from './env';
import { logger } from '../services/logger.service';

export interface RabbitMQConfig {
    url: string;
    prefetchCount: number;
    heartbeatInterval: number;
}

let connection: any = null;
let channel: any = null;

export const getRabbitMQConfig = (): RabbitMQConfig => {
    const env = getEnv();
    return {
        url: env.RABBITMQ_URL || 'amqp://localhost:5672',
        prefetchCount: env.RABBITMQ_PREFETCH_COUNT,
        heartbeatInterval: env.RABBITMQ_HEARTBEAT_INTERVAL,
    };
};

export const connectRabbitMQ = async (): Promise<any> => {
    if (connection) return connection;

    const config = getRabbitMQConfig();
    try {
        connection = await amqplib.connect(config.url, {
            heartbeat: config.heartbeatInterval,
        });
        connection.on('error', (err: Error) => {
            logger.error('RabbitMQ connection error', { error: err.message });
        });
        connection.on('close', () => {
            logger.warn('RabbitMQ connection closed');
            connection = null;
            channel = null;
        });
        logger.info('RabbitMQ connected successfully');
        return connection;
    } catch (error) {
        logger.error('Failed to connect to RabbitMQ', { error });
        throw error;
    }
};

export const getConfirmChannel = async (): Promise<any> => {
    if (channel) return channel;

    const conn = await connectRabbitMQ();
    const config = getRabbitMQConfig();
    channel = await conn.createConfirmChannel();
    await channel.prefetch(config.prefetchCount);
    channel.on('error', (err: Error) => {
        logger.error('RabbitMQ channel error', { error: err.message });
    });
    channel.on('close', () => {
        logger.warn('RabbitMQ channel closed');
        channel = null;
    });
    logger.info('RabbitMQ confirm channel created');
    return channel;
};

export const disconnectRabbitMQ = async (): Promise<void> => {
    if (channel) {
        await channel.close();
        channel = null;
    }
    if (connection) {
        await connection.close();
        connection = null;
    }
    logger.info('RabbitMQ disconnected');
};

export const isConnected = (): boolean => {
    return connection !== null && channel !== null;
};
