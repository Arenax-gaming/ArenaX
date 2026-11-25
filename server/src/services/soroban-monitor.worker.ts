import prisma from './database.service';
import sorobanRpcService from './soroban-rpc.service';
import { TxStatus } from '@prisma/client';
import { logger } from './logger.service';

// ── #1388 — Polling configuration ────────────────────────────────────────────
// All values are configurable via environment variables.
const INITIAL_BACKOFF_MS = parseInt(process.env.SOROBAN_POLL_INTERVAL_MS  ?? '1000',  10);
const BACKOFF_MULTIPLIER  = parseFloat(process.env.SOROBAN_POLL_BACKOFF   ?? '2');
const MAX_BACKOFF_MS      = parseInt(process.env.SOROBAN_POLL_MAX_MS      ?? '30000', 10);
const TOTAL_TIMEOUT_MS    = parseInt(process.env.SOROBAN_TIMEOUT_MS       ?? '300000',10);
const MAX_RETRIES         = parseInt(process.env.SOROBAN_MAX_RETRIES      ?? '12',    10);

// Active cancellation tokens: txHash → cancel function.
const cancellers = new Map<string, () => void>();

// ── WebSocket delivery helper ─────────────────────────────────────────────────
// Push a typed event to the user's connected sockets.
// Uses the existing Socket.IO server wired in server.ts (via initGameSocket).
// We access it lazily to avoid circular imports at module load time.
function pushUserEvent(userId: string | undefined | null, payload: Record<string, unknown>): void {
    if (!userId) return;
    try {
        // Lazy-require the io instance exposed by server.ts to avoid circular deps.
        // In the full codebase, extract io to a shared singleton (e.g. src/lib/io.ts).
        const { getSocketIOServer } = require('./socket-io.service') as {
            getSocketIOServer: () => import('socket.io').Server | null;
        };
        const io = getSocketIOServer();
        if (io) {
            io.emit(`soroban:${userId}`, payload);
        }
    } catch {
        // Socket.IO server not yet initialised (e.g. during unit tests) — ignore.
    }
}

export class SorobanMonitorWorker {
    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * #1388 — Polls for the status of a submitted Soroban transaction.
     *
     * - Checks every N seconds with exponential back-off (configurable via env).
     * - On SUCCESS or FAILED: persists to DB and pushes a WebSocket event.
     * - If finality is not reached within TOTAL_TIMEOUT_MS: marks EXPIRED and notifies the user.
     * - The loop is cancellable per txHash via cancelPolling().
     */
    async monitor(txHash: string): Promise<void> {
        let retryCount   = 0;
        let backoff      = INITIAL_BACKOFF_MS;
        const deadline   = Date.now() + TOTAL_TIMEOUT_MS;
        let cancelled    = false;

        // Register a cancellation handle so callers can stop this loop.
        cancellers.set(txHash, () => { cancelled = true; });

        // Retrieve userId once so we can push WebSocket events later.
        const record = await prisma.blockchainTransaction.findUnique({
            where: { txHash },
            select: { userId: true },
        });
        const userId = record?.userId ?? null;

        logger.info('Soroban monitor started', { txHash, userId, event: 'monitor_start' });

        while (retryCount < MAX_RETRIES) {
            // Check cancellation before each attempt.
            if (cancelled) {
                logger.info('Soroban monitor cancelled', { txHash, event: 'monitor_cancelled' });
                cancellers.delete(txHash);
                return;
            }

            // Check timeout before each attempt.
            if (Date.now() >= deadline) {
                await this._markExpired(txHash, userId);
                cancellers.delete(txHash);
                return;
            }

            try {
                const response = await sorobanRpcService.getClient().getTransaction(txHash);

                if (response.status === 'SUCCESS') {
                    logger.info('Soroban transaction confirmed', { txHash, userId, event: 'tx_success' });
                    await this._finalise(txHash, userId, TxStatus.SUCCESS);
                    cancellers.delete(txHash);
                    return;
                }

                if (response.status === 'FAILED') {
                    const error = (response as any).resultErrorXdr?.toString() ?? 'Soroban execution failed';
                    logger.error('Soroban transaction failed on-chain', { txHash, userId, error, event: 'tx_failed' });
                    await this._finalise(txHash, userId, TxStatus.FAILED, error);
                    cancellers.delete(txHash);
                    return;
                }

                // NOT_FOUND / PENDING — keep polling.
            } catch (err: any) {
                logger.warn('Soroban poll attempt error', {
                    txHash, attempt: retryCount + 1, error: err.message, event: 'poll_error',
                });
            }

            // Wait with exponential back-off before next attempt.
            await new Promise<void>((resolve) => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
            retryCount++;
        }

        // Exhausted MAX_RETRIES without reaching finality.
        await this._markExpired(txHash, userId);
        cancellers.delete(txHash);
    }

    /**
     * Cancel the polling loop for a specific transaction.
     * No-op if the transaction has already reached finality.
     */
    cancelPolling(txHash: string): void {
        const cancel = cancellers.get(txHash);
        if (cancel) {
            cancel();
            logger.info('Soroban monitor cancellation requested', { txHash, event: 'cancel_requested' });
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private async _finalise(
        txHash: string,
        userId: string | null,
        status: 'SUCCESS' | 'FAILED',
        error?: string,
    ): Promise<void> {
        await this._updateStatus(txHash, status, error);

        // #1388 — Push WebSocket event to the user on finality.
        pushUserEvent(userId, {
            type: 'soroban_tx_finalized',
            txHash,
            status,
            ...(error ? { error } : {}),
        });
    }

    private async _markExpired(txHash: string, userId: string | null): Promise<void> {
        logger.warn('Soroban transaction monitoring timed out — marking EXPIRED', {
            txHash, userId, event: 'tx_expired',
        });
        await this._updateStatus(txHash, 'FAILED' as unknown as TxStatus, 'Transaction finality timeout');

        // #1388 — Notify the user their transaction expired.
        pushUserEvent(userId, {
            type: 'soroban_tx_expired',
            txHash,
            status: 'EXPIRED',
        });
    }

    private async _updateStatus(txHash: string, status: TxStatus, error?: string): Promise<void> {
        try {
            await prisma.blockchainTransaction.update({
                where: { txHash },
                data: { status, error, updatedAt: new Date() },
            });
        } catch (dbErr) {
            logger.error('Failed to update Soroban transaction status in DB', {
                txHash, status, error: dbErr, event: 'db_update_error',
            });
        }
    }
}

export default new SorobanMonitorWorker();
