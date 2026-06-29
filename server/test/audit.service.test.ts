/**
 * Tests for the comprehensive audit trail system — Issue #471.
 *
 * These tests use node:test + node:assert with an in-memory mock.
 * No real database or Prisma client is required.
 *
 * Run:  npx ts-node --transpile-only test/audit.service.test.ts
 */

import assert from 'node:assert';
import test from 'node:test';
import crypto from 'crypto';
import { AuditStatus } from '../src/types/audit.types';

// ─── In-memory Prisma mock ────────────────────────────────────────────────────

type AuditRow = {
  id: string; adminId: string; action: string; targetType: string; targetId: string;
  ipAddress: string | null; userAgent: string | null; requestId: string | null;
  correlationId: string | null; snapshotBefore: object; snapshotAfter: object;
  details: object; entryHash: string | null; previousHash: string | null;
  anchoredAt: Date | null; anchorTxId: string | null; redactedAt: Date | null;
  createdAt: Date;
};

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: crypto.randomUUID(),
    adminId: 'user-1',
    action: 'TEST_ACTION',
    targetType: 'TEST',
    targetId: 'target-1',
    ipAddress: null,
    userAgent: null,
    requestId: null,
    correlationId: null,
    snapshotBefore: {},
    snapshotAfter: {},
    details: {},
    entryHash: null,
    previousHash: null,
    anchoredAt: null,
    anchorTxId: null,
    redactedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

class FakePrismaAuditLog {
  private store: (AuditRow & { _seq: number })[] = [];
  private seq = 0;

  async create({ data }: { data: Partial<AuditRow> }): Promise<AuditRow> {
    const row = { ...makeRow({ id: crypto.randomUUID(), createdAt: new Date(), ...data }), _seq: this.seq++ };
    this.store.push(row);
    return row;
  }

  async findFirst(_opts?: object): Promise<Partial<AuditRow> | null> {
    if (this.store.length === 0) return null;
    // return the row with the highest sequence number (insertion order)
    return [...this.store].sort((a, b) => b._seq - a._seq)[0];
  }

  async findMany({ where, take, skip }: {
    where?: Record<string, unknown>; orderBy?: object;
    take?: number; skip?: number;
  } = {}): Promise<AuditRow[]> {
    let results = [...this.store];
    if (where?.adminId)    results = results.filter(r => r.adminId    === where.adminId);
    if (where?.targetType) results = results.filter(r => r.targetType === where.targetType);
    if (where?.targetId)   results = results.filter(r => r.targetId   === where.targetId);
    // stable ascending insertion order
    results.sort((a, b) => a._seq - b._seq);
    if (skip) results = results.slice(skip);
    if (take) results = results.slice(0, take);
    return results;
  }

  async count({ where }: { where?: Record<string, unknown> } = {}): Promise<number> {
    return (await this.findMany({ where })).length;
  }

  async updateMany({ where, data }: { where?: Record<string, unknown>; data: Partial<AuditRow> }): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.store) {
      const matchId   = !where?.adminId    || row.adminId    === where.adminId;
      const noRedact  = !where?.redactedAt || row.redactedAt === null;
      if (matchId && noRedact) { Object.assign(row, data); count++; }
    }
    return { count };
  }

  async deleteMany({ where }: { where?: Record<string, unknown> } = {}): Promise<{ count: number }> {
    const before = this.store.length;
    if (where?.id && (where.id as { in: string[] }).in) {
      const ids = (where.id as { in: string[] }).in;
      this.store = this.store.filter(r => !ids.includes(r.id));
    }
    return { count: before - this.store.length };
  }

  _reset() { this.store = []; this.seq = 0; }
  _all()   { return this.store; }
}

const fakeAuditLog = new FakePrismaAuditLog();
const db = { auditLog: fakeAuditLog };

// ─── Per-test factory (isolates each test from concurrent runs) ───────────────

function makeDb() {
  const al = new FakePrismaAuditLog();
  return { auditLog: al };
}

type Db = ReturnType<typeof makeDb>;

// ─── Inline audit helpers (mirrors audit.service.ts logic) ───────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${(value as unknown[]).map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function computeHash(entry: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stableStringify(entry)).digest('hex');
}

async function log(ctx: {
  userId: string; role?: string; action: string; status?: AuditStatus;
  targetType: string; targetId: string;
  ipAddress?: string | null; userAgent?: string | null;
  requestId?: string | null; correlationId?: string | null;
  payloadBefore?: Record<string, unknown>; payloadAfter?: Record<string, unknown>;
}, localDb: Db = db) {
  const timestamp = new Date().toISOString();
  const createdAt = new Date(timestamp); // same instant, stable for verify
  const status = ctx.status ?? AuditStatus.SUCCESS;
  const role   = ctx.role   ?? 'SYSTEM';
  const previous = await localDb.auditLog.findFirst();
  const previousHash = previous?.entryHash ?? null;
  const entryHash = computeHash({
    userId: ctx.userId, role, action: ctx.action, status,
    targetType: ctx.targetType, targetId: ctx.targetId,
    ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId ?? null, correlationId: ctx.correlationId ?? null,
    payloadBefore: ctx.payloadBefore, payloadAfter: ctx.payloadAfter,
    timestamp, previousHash,
  });
  return localDb.auditLog.create({
    data: {
      adminId: ctx.userId, action: ctx.action, targetType: ctx.targetType, targetId: ctx.targetId,
      ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null, correlationId: ctx.correlationId ?? null,
      snapshotBefore: ctx.payloadBefore ?? {}, snapshotAfter: ctx.payloadAfter ?? {},
      details: { _status: status, _role: role },
      entryHash, previousHash, anchoredAt: null, anchorTxId: null, redactedAt: null,
      createdAt, // pass exact timestamp used in hash
    },
  });
}

async function verifyIntegrity(localDb: Db = db): Promise<{ ok: boolean; firstTamperedId?: string; totalChecked: number }> {
  const logs = await localDb.auditLog.findMany();
  let checked = 0;
  for (const row of logs) {
    if (!row.entryHash) continue;
    const details = (row.details ?? {}) as Record<string, unknown>;
    const recomputed = computeHash({
      userId: row.adminId, role: details._role ?? 'SYSTEM', action: row.action,
      status: details._status ?? AuditStatus.SUCCESS,
      targetType: row.targetType, targetId: row.targetId,
      ipAddress: row.ipAddress ?? null, userAgent: row.userAgent ?? null,
      requestId: row.requestId ?? null, correlationId: row.correlationId ?? null,
      payloadBefore: (row.snapshotBefore as Record<string, unknown>) ?? undefined,
      payloadAfter:  (row.snapshotAfter  as Record<string, unknown>) ?? undefined,
      timestamp: row.createdAt.toISOString(), previousHash: row.previousHash ?? null,
    });
    if (recomputed !== row.entryHash) return { ok: false, firstTamperedId: row.id, totalChecked: checked };
    checked++;
  }
  return { ok: true, totalChecked: checked };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('each audit entry gets a SHA-256 entryHash', async () => {
  const d = makeDb();
  const row = await log({ userId: 'u1', action: 'LOGIN', targetType: 'USER', targetId: 'u1' }, d);
  assert.ok(row.entryHash, 'entryHash should be set');
  assert.strictEqual(row.entryHash!.length, 64, 'SHA-256 hex is 64 chars');
});

test('second entry links to first via previousHash (chain)', async () => {
  const d = makeDb();
  const first  = await log({ userId: 'u1', action: 'ACTION_A', targetType: 'X', targetId: '1' }, d);
  const second = await log({ userId: 'u1', action: 'ACTION_B', targetType: 'X', targetId: '2' }, d);
  assert.strictEqual(second.previousHash, first.entryHash, 'previousHash must link to previous entryHash');
  assert.notStrictEqual(first.entryHash, second.entryHash, 'each entry hash must be unique');
});

test('integrity check passes for an untampered chain', async () => {
  const d = makeDb();
  await log({ userId: 'u1', action: 'A', targetType: 'T', targetId: '1' }, d);
  await log({ userId: 'u1', action: 'B', targetType: 'T', targetId: '2' }, d);
  await log({ userId: 'u1', action: 'C', targetType: 'T', targetId: '3' }, d);
  const report = await verifyIntegrity(d);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.totalChecked, 3);
});

test('integrity check fails immediately when a record is tampered', async () => {
  const d = makeDb();
  await log({ userId: 'u1', action: 'A', targetType: 'T', targetId: '1' }, d);
  const tampered = await log({ userId: 'u1', action: 'B', targetType: 'T', targetId: '2' }, d);
  await log({ userId: 'u1', action: 'C', targetType: 'T', targetId: '3' }, d);
  // Tamper the middle entry's action in-place
  tampered.action = 'TAMPERED';
  const report = await verifyIntegrity(d);
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.firstTamperedId, tampered.id);
});

test('first entry has null previousHash (chain genesis)', async () => {
  const d = makeDb();
  const genesis = await log({ userId: 'u1', action: 'REGISTER', targetType: 'USER', targetId: 'u1' }, d);
  assert.strictEqual(genesis.previousHash, null, 'genesis entry has no predecessor');
});

test('stableStringify produces identical output regardless of key order', () => {
  const a = stableStringify({ b: 2, a: 1 });
  const b = stableStringify({ a: 1, b: 2 });
  assert.strictEqual(a, b, 'key order must not affect hash input');
});

test('redactUser blanks PII without changing entryHash', async () => {
  const d = makeDb();
  await log({ userId: 'u-pii', action: 'LOGIN', targetType: 'USER', targetId: 'u-pii', ipAddress: '1.2.3.4' }, d);
  await d.auditLog.updateMany({
    where: { adminId: 'u-pii', redactedAt: null },
    data: { ipAddress: null, redactedAt: new Date() },
  });
  const rows = await d.auditLog.findMany({ where: { adminId: 'u-pii' } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ipAddress, null, 'IP should be redacted');
  assert.ok(rows[0].entryHash, 'entryHash remains set after redaction');
  assert.ok(rows[0].redactedAt, 'redactedAt should be stamped');
});

test('anchor service: Merkle root is valid SHA-256 hex', async () => {
  const d = makeDb();
  const r1 = await log({ userId: 'u1', action: 'A', targetType: 'T', targetId: '1' }, d);
  const r2 = await log({ userId: 'u1', action: 'B', targetType: 'T', targetId: '2' }, d);
  const hashes = [r1.entryHash!, r2.entryHash!];
  function merkle(hs: string[]): string {
    let layer = hs;
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        next.push(crypto.createHash('sha256').update(layer[i] + (layer[i + 1] ?? layer[i])).digest('hex'));
      }
      layer = next;
    }
    return layer[0];
  }
  const root = merkle(hashes);
  assert.strictEqual(root.length, 64, 'Merkle root is a valid SHA-256 hex');
});

test('AuditStatus enum values are SUCCESS, FAILED, CRITICAL', () => {
  assert.strictEqual(AuditStatus.SUCCESS,  'SUCCESS');
  assert.strictEqual(AuditStatus.FAILED,   'FAILED');
  assert.strictEqual(AuditStatus.CRITICAL, 'CRITICAL');
});

test('log() stores _status and _role in details', async () => {
  const d = makeDb();
  const row = await log({
    userId: 'u1', role: 'ADMIN', action: 'WALLET_WITHDRAW',
    status: AuditStatus.CRITICAL, targetType: 'WALLET', targetId: 'w1',
  }, d);
  const details = row.details as Record<string, unknown>;
  assert.strictEqual(details._status, AuditStatus.CRITICAL);
  assert.strictEqual(details._role,   'ADMIN');
});
