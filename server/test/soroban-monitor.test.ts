/**
 * Issue #1388 — Soroban polling + WebSocket delivery tests
 *
 * Drives the monitor worker to finality and asserts:
 *   - DB is updated to SUCCESS / FAILED / EXPIRED
 *   - WebSocket event is pushed to the user
 *   - Polling loop is cancellable
 */

import { SorobanMonitorWorker } from '../src/services/soroban-monitor.worker';
import { TxStatus } from '@prisma/client';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock socket-io singleton (WebSocket push target)
const mockEmit = jest.fn();
jest.mock('../src/services/socket-io.service', () => ({
    getSocketIOServer: () => ({ emit: mockEmit }),
}));

// Mock Prisma
const mockUpdate = jest.fn();
jest.mock('../src/services/database.service', () => ({
    __esModule: true,
    default: {
        blockchainTransaction: {
            findUnique: jest.fn(async () => ({ userId: 'user-123' })),
            update: mockUpdate,
        },
    },
}));

// Mock logger
jest.mock('../src/services/logger.service', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock Soroban RPC — drives status sequence
let rpcCallCount = 0;
let rpcStatusSequence: string[] = [];

jest.mock('../src/services/soroban-rpc.service', () => ({
    __esModule: true,
    default: {
        getClient: () => ({
            getTransaction: jest.fn(async (_hash: string) => {
                const status = rpcStatusSequence[rpcCallCount] ?? 'NOT_FOUND';
                rpcCallCount++;
                return { status, resultErrorXdr: status === 'FAILED' ? 'err-xdr' : undefined };
            }),
        }),
    },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorker(): SorobanMonitorWorker {
    // Override env vars for fast tests
    process.env.SOROBAN_POLL_INTERVAL_MS = '1';
    process.env.SOROBAN_POLL_BACKOFF     = '1';
    process.env.SOROBAN_POLL_MAX_MS      = '10';
    process.env.SOROBAN_MAX_RETRIES      = '5';
    process.env.SOROBAN_TIMEOUT_MS       = '60000';
    return new SorobanMonitorWorker();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    rpcCallCount = 0;
});

describe('#1388 SorobanMonitorWorker', () => {
    it('polls to SUCCESS and fires WebSocket event', async () => {
        rpcStatusSequence = ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS'];
        const worker = makeWorker();
        await worker.monitor('tx-hash-001');

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: TxStatus.SUCCESS }) }),
        );
        expect(mockEmit).toHaveBeenCalledWith(
            'soroban:user-123',
            expect.objectContaining({ type: 'soroban_tx_finalized', status: TxStatus.SUCCESS }),
        );
    });

    it('polls to FAILED and fires WebSocket event', async () => {
        rpcStatusSequence = ['NOT_FOUND', 'FAILED'];
        const worker = makeWorker();
        await worker.monitor('tx-hash-002');

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: TxStatus.FAILED }) }),
        );
        expect(mockEmit).toHaveBeenCalledWith(
            'soroban:user-123',
            expect.objectContaining({ type: 'soroban_tx_finalized', status: TxStatus.FAILED }),
        );
    });

    it('marks EXPIRED and notifies user when timeout reached', async () => {
        // All retries return NOT_FOUND — exhausts MAX_RETRIES
        rpcStatusSequence = Array(10).fill('NOT_FOUND');
        const worker = makeWorker();
        await worker.monitor('tx-hash-003');

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: TxStatus.EXPIRED }) }),
        );
        expect(mockEmit).toHaveBeenCalledWith(
            'soroban:user-123',
            expect.objectContaining({ type: 'soroban_tx_expired', status: 'EXPIRED' }),
        );
    });

    it('cancellation stops the polling loop before finality', async () => {
        rpcStatusSequence = Array(10).fill('NOT_FOUND');
        const worker = makeWorker();

        // Start monitor and cancel immediately.
        const promise = worker.monitor('tx-cancel-001');
        worker.cancelPolling('tx-cancel-001');
        await promise;

        // DB should NOT have been updated to a final state.
        const finalStatuses = [TxStatus.SUCCESS, TxStatus.FAILED, TxStatus.EXPIRED];
        const calledWithFinal = mockUpdate.mock.calls.some((call: any[]) =>
            finalStatuses.includes(call[0]?.data?.status),
        );
        expect(calledWithFinal).toBe(false);
    });
});
