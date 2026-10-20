-- CreateEnum
CREATE TYPE "PrizePayoutStatus" AS ENUM ('AWAITING_SIGNATURES', 'READY', 'SUBMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "TournamentPrizeAccount" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "adminSigner" TEXT NOT NULL,
    "systemSigner" TEXT NOT NULL,
    "lowThreshold" INTEGER NOT NULL,
    "medThreshold" INTEGER NOT NULL,
    "highThreshold" INTEGER NOT NULL,
    "creationTxHash" TEXT,
    "depositCursor" TEXT,
    "totalDeposited" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TournamentPrizeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizePoolDeposit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAccount" TEXT NOT NULL,
    "amount" DECIMAL(20,7) NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetIssuer" TEXT,
    "ledgerAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrizePoolDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizePayoutRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "payouts" JSONB NOT NULL,
    "signedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PrizePayoutStatus" NOT NULL DEFAULT 'AWAITING_SIGNATURES',
    "requestedBy" TEXT NOT NULL,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrizePayoutRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentPrizeAccount_tournamentId_key" ON "TournamentPrizeAccount"("tournamentId");
CREATE UNIQUE INDEX "TournamentPrizeAccount_publicKey_key" ON "TournamentPrizeAccount"("publicKey");
CREATE UNIQUE INDEX "PrizePoolDeposit_operationId_key" ON "PrizePoolDeposit"("operationId");
CREATE INDEX "PrizePoolDeposit_accountId_idx" ON "PrizePoolDeposit"("accountId");
CREATE INDEX "PrizePayoutRequest_accountId_idx" ON "PrizePayoutRequest"("accountId");
CREATE INDEX "PrizePayoutRequest_status_idx" ON "PrizePayoutRequest"("status");

ALTER TABLE "PrizePoolDeposit" ADD CONSTRAINT "PrizePoolDeposit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TournamentPrizeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrizePayoutRequest" ADD CONSTRAINT "PrizePayoutRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TournamentPrizeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
