/**
 * Audit Anchor Service — Issue #471
 *
 * Batch-anchors critical audit log hashes to a verifiable public ledger.
 *
 * Implements `IBlockchainAnchorProvider` from audit.types.ts.
 * Production: swap `MockAnchorProvider` with a real Stellar/Ethereum/Arweave client.
 */

import crypto from 'crypto';
import { getDatabaseClient } from './database.service';
import { logger } from './logger.service';
import type { IBlockchainAnchorProvider } from '../types/audit.types';

// ─── Re-export interface for consumers that import from this module ────────────
export type { IBlockchainAnchorProvider };

// ─── Merkle root helper ───────────────────────────────────────────────────────

function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return '';
  let layer = hashes;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left  = layer[i];
      const right = layer[i + 1] ?? left; // duplicate last node for odd layers
      next.push(crypto.createHash('sha256').update(left + right).digest('hex'));
    }
    layer = next;
  }
  return layer[0];
}

// ─── Mock provider ────────────────────────────────────────────────────────────

/** Default mock — swap for a real ledger client in production. */
class MockAnchorProvider implements IBlockchainAnchorProvider {
  async anchorHash(rootHash: string, metadata?: Record<string, unknown>): Promise<string> {
    const txId = `MOCK_${crypto.createHash('sha256').update(rootHash + Date.now()).digest('hex').slice(0, 32)}`;
    logger.info('audit.anchor.mock', { rootHash, txId, ...metadata });
    return txId;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AuditAnchorService {
  private provider: IBlockchainAnchorProvider;

  constructor(provider?: IBlockchainAnchorProvider) {
    this.provider = provider ?? new MockAnchorProvider();
  }

  /**
   * Find all un-anchored audit entries, compute their Merkle root, submit to
   * the ledger provider via `anchorHash()`, and stamp each entry with the tx id.
   */
  async anchorPending(): Promise<{ anchored: number; txId: string | null; merkleRoot: string | null }> {
    const prisma = getDatabaseClient();

    const pending = await prisma.auditLog.findMany({
      where: { anchoredAt: null, entryHash: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, entryHash: true },
      take: 1000, // process in batches of 1 000
    });

    if (pending.length === 0) return { anchored: 0, txId: null, merkleRoot: null };

    const hashes = pending.map(r => r.entryHash as string);
    const merkleRoot = buildMerkleRoot(hashes);

    let txId: string;
    try {
      txId = await this.provider.anchorHash(merkleRoot, { count: pending.length });
    } catch (err) {
      logger.error('audit.anchor.failed', { error: (err as Error).message });
      throw err;
    }

    const ids = pending.map(r => r.id);
    await prisma.auditLog.updateMany({
      where: { id: { in: ids } },
      data: { anchoredAt: new Date(), anchorTxId: txId },
    });

    logger.info('audit.anchor.complete', { anchored: ids.length, txId, merkleRoot });
    return { anchored: ids.length, txId, merkleRoot };
  }

  /** Verify that a single entry has been anchored. */
  async verifyAnchor(auditLogId: string): Promise<{ anchored: boolean; txId: string | null }> {
    const prisma = getDatabaseClient();
    const entry = await prisma.auditLog.findUnique({
      where: { id: auditLogId },
      select: { anchoredAt: true, anchorTxId: true },
    });
    return {
      anchored: !!entry?.anchoredAt,
      txId: entry?.anchorTxId ?? null,
    };
  }
}

export const auditAnchorService = new AuditAnchorService();
