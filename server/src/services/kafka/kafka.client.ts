import { Kafka, KafkaConfig, Producer, Consumer, Admin, logLevel } from 'kafkajs';
import { logger } from '../logger.service';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const clientId = process.env.KAFKA_CLIENT_ID ?? 'arenax-server';

const config: KafkaConfig = {
  clientId,
  brokers,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
};

class KafkaClient {
  private readonly kafka = new Kafka(config);
  private producer: Producer | null = null;
  private admin: Admin | null = null;

  getProducer(): Producer {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30_000,
        // idempotent producer — exactly-once writes
        idempotent: true,
      });
    }
    return this.producer;
  }

  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({
      groupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxWaitTimeInMs: 5_000,
    });
  }

  getAdmin(): Admin {
    if (!this.admin) {
      this.admin = this.kafka.admin();
    }
    return this.admin;
  }

  async connectProducer(): Promise<void> {
    await this.getProducer().connect();
    logger.info('Kafka producer connected');
  }

  async disconnectProducer(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
      logger.info('Kafka producer disconnected');
    }
  }

  async disconnectAdmin(): Promise<void> {
    if (this.admin) {
      await this.admin.disconnect();
      this.admin = null;
    }
  }
}

export const kafkaClient = new KafkaClient();
