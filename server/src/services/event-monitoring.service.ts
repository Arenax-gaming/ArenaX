import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import prisma from './database.service';
import sorobanRpcService from './soroban-rpc.service';
import eventParser from './event-parser.service';
import { logger } from './logger.service';
import type { Prisma } from '@prisma/client';

interface PollConfig {
  intervalMs: number;
  maxLedgerBatch: number;
  startLedger?: number;
  contracts: string[];
}

function decodeScVal(raw: string): xdr.ScVal {
  return xdr.ScVal.fromXDR(raw, 'base64');
}

export class EventMonitoringService {
  private polling = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastProcessedLedger: number = 0;

  private config: PollConfig = {
    intervalMs: 10_000,
    maxLedgerBatch: 100,
    contracts: [],
  };

  configure(overrides: Partial<PollConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  async start(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    const highest = await prisma.blockchainEvent.findFirst({
      orderBy: { ledger: 'desc' },
      select: { ledger: true },
    });
    this.lastProcessedLedger = highest?.ledger ?? (this.config.startLedger ?? 0);

    logger.info('Event monitoring started', {
      startLedger: this.lastProcessedLedger,
      intervalMs: this.config.intervalMs,
    });

    this.intervalHandle = setInterval(() => this.pollOnce(), this.config.intervalMs);
    this.pollOnce().catch((err) => logger.error('Initial event poll failed', { error: err }));
  }

  stop(): void {
    this.polling = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info('Event monitoring stopped');
  }

  async pollOnce(): Promise<void> {
    if (!this.polling) return;

    try {
      const rpc = sorobanRpcService.getClient();
      const latestLedger = await rpc.getLatestLedger();
      const toLedger = Math.min(
        latestLedger.sequence,
        this.lastProcessedLedger + this.config.maxLedgerBatch,
      );

      if (toLedger <= this.lastProcessedLedger) return;

      for (const contractId of this.config.contracts) {
        try {
          const result = await rpc.getEvents({
            startLedger: this.lastProcessedLedger + 1,
            filters: [{
              type: 'contract',
              contractIds: [contractId],
            }],
            limit: this.config.maxLedgerBatch,
          });

          for (const event of result.events) {
            await this.processEvent(event);
          }
        } catch (err: any) {
          logger.warn('Failed to fetch events for contract', {
            contractId,
            error: err.message,
          });
        }
      }

      this.lastProcessedLedger = toLedger;
    } catch (err: any) {
      logger.error('Event poll iteration failed', { error: err.message });
    }
  }

  private async processEvent(event: any): Promise<void> {
    try {
      const txHash = event.id.split('-')[0];

      const existing = await prisma.blockchainEvent.findFirst({
        where: { txHash, eventType: event.id },
      });
      if (existing) return;

      let topics: xdr.ScVal[];
      try {
        topics = (event.topic ?? []).map((t: any) =>
          typeof t === 'string' ? decodeScVal(t) : t,
        );
      } catch {
        logger.warn('Failed to decode event topics, skipping');
        return;
      }

      let data: xdr.ScVal;
      try {
        const rawXdr = event.value?.xdr ?? event.value;
        data = typeof rawXdr === 'string' ? decodeScVal(rawXdr) : rawXdr;
      } catch {
        logger.warn('Failed to decode event data, skipping');
        return;
      }

      let parsed;
      try {
        parsed = eventParser.parseEvent(topics, data);
      } catch {
        logger.debug('Unknown event (no registered parser), storing raw');
        parsed = null;
      }

      const ledgerNum = typeof event.ledger === 'number'
        ? event.ledger
        : parseInt(String(event.ledger), 10);

      const contractId = typeof event.contractId === 'string'
        ? event.contractId
        : String(event.contractId ?? '');

      await prisma.blockchainEvent.create({
        data: {
          eventType: event.id,
          namespace: parsed?.namespace ?? 'unknown',
          schemaVersion: parsed?.version ?? 'v0',
          contractId,
          txHash,
          ledger: isNaN(ledgerNum) ? 0 : ledgerNum,
          data: (parsed?.data ?? { raw: event.value?.xdr ?? event.value }) as Prisma.InputJsonValue,
        },
      });

      if (parsed) {
        await this.handleParsedEvent(parsed, txHash, contractId);
      }
    } catch (err: any) {
      logger.error('Failed to process blockchain event', { error: err.message });
    }
  }

  private async handleParsedEvent(
    parsed: { namespace: string; version: string; eventType: string; data: any },
    txHash: string,
    contractId: string,
  ): Promise<void> {
    try {
      if (parsed.namespace === 'ArenaXMatch' || parsed.namespace === 'ArenaXMLf') {
        await this.handleMatchEvent(parsed, txHash);
      }
    } catch (err: any) {
      logger.error('Failed to handle parsed event', {
        namespace: parsed.namespace,
        eventType: parsed.eventType,
        error: err.message,
      });
    }
  }

  private async handleMatchEvent(
    parsed: { namespace: string; eventType: string; data: any },
    txHash: string,
  ): Promise<void> {
    const data = parsed.data as Record<string, any>;
    const onChainId = data.matchId ?? data.id ?? txHash;

    switch (parsed.eventType) {
      case 'CREATED': {
        const existingMatch = await prisma.match.findUnique({
          where: { onChainId },
        });
        if (existingMatch) break;

        await prisma.match.create({
          data: {
            onChainId,
            playerAId: data.playerA ?? '',
            playerBId: data.playerB ?? '',
            status: 'CREATED',
            lastChainTx: txHash,
          },
        });
        logger.info('Match created from contract event', { onChainId });
        break;
      }

      case 'STARTED': {
        await prisma.match.updateMany({
          where: { onChainId, status: 'CREATED' },
          data: { status: 'STARTED', startedAt: new Date(), lastChainTx: txHash },
        });
        logger.info('Match started from contract event', { onChainId });
        break;
      }

      case 'COMPLETED':
      case 'RESULT': {
        await prisma.match.updateMany({
          where: { onChainId },
          data: {
            status: 'COMPLETED',
            winnerId: data.winner ?? data.winnerId,
            endedAt: new Date(),
            lastChainTx: txHash,
          },
        });
        logger.info('Match completed from contract event', { onChainId });
        break;
      }

      case 'DISPUTED': {
        await prisma.match.updateMany({
          where: { onChainId },
          data: { status: 'DISPUTED', lastChainTx: txHash },
        });
        logger.info('Match disputed from contract event', { onChainId });
        break;
      }

      case 'RESOLVED':
      case 'FINALIZED': {
        await prisma.match.updateMany({
          where: { onChainId },
          data: { status: 'FINALIZED', lastChainTx: txHash },
        });
        logger.info('Match finalized from contract event', { onChainId });
        break;
      }

      case 'CANCELLED': {
        await prisma.match.updateMany({
          where: { onChainId },
          data: { status: 'FINALIZED', endedAt: new Date(), lastChainTx: txHash },
        });
        logger.info('Match cancelled from contract event', { onChainId });
        break;
      }
    }
  }

  getLastProcessedLedger(): number {
    return this.lastProcessedLedger;
  }

  isRunning(): boolean {
    return this.polling;
  }
}

export default new EventMonitoringService();
