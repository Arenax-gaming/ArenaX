-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('XLM', 'USDC', 'AX');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_SLASH', 'PLATFORM_FEE', 'PRIZE_POOL_FUND');

-- CreateTable: high-precision ledger (7 decimal places)
CREATE TABLE "Ledger" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "xlmBalance"   DECIMAL(20,7) NOT NULL DEFAULT 0,
    "xlmEscrowed"  DECIMAL(20,7) NOT NULL DEFAULT 0,
    "usdcBalance"  DECIMAL(20,7) NOT NULL DEFAULT 0,
    "usdcEscrowed" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "axBalance"    DECIMAL(20,7) NOT NULL DEFAULT 0,
    "axEscrowed"   DECIMAL(20,7) NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable: immutable transaction history with idempotency
CREATE TABLE "WalletTransaction" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type"           "TransactionType" NOT NULL,
    "currency"       "Currency" NOT NULL,
    "amount"         DECIMAL(20,7) NOT NULL,
    "balanceBefore"  DECIMAL(20,7) NOT NULL,
    "balanceAfter"   DECIMAL(20,7) NOT NULL,
    "escrowBefore"   DECIMAL(20,7) NOT NULL,
    "escrowAfter"    DECIMAL(20,7) NOT NULL,
    "matchId"        TEXT,
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on idempotency key (prevents double-spend / duplicate credits)
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "Ledger_userId_key" ON "Ledger"("userId");

-- Indexes
CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");
CREATE INDEX "WalletTransaction_matchId_idx" ON "WalletTransaction"("matchId");

-- Foreign keys
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
