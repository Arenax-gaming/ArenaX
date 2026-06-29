-- Migration: 20260623000001_audit_trail_enhancements
-- Adds tamper-evident and compliance fields to AuditLog, plus performance indexes.

-- New columns
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT,
  ADD COLUMN IF NOT EXISTS "entryHash"     TEXT,
  ADD COLUMN IF NOT EXISTS "previousHash"  TEXT,
  ADD COLUMN IF NOT EXISTS "anchoredAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "anchorTxId"    TEXT,
  ADD COLUMN IF NOT EXISTS "redactedAt"    TIMESTAMP(3);

-- Performance indexes for sub-second audit queries
-- (adminId, action, targetType, targetId already have basic indexes)
CREATE INDEX IF NOT EXISTS "AuditLog_correlationId_idx"  ON "AuditLog" ("correlationId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx"      ON "AuditLog" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_entryHash_idx"      ON "AuditLog" ("entryHash");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_targetId_idx" ON "AuditLog" ("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "AuditLog_anchoredAt_idx"     ON "AuditLog" ("anchoredAt") WHERE "anchoredAt" IS NULL;
