-- CreateEnum
CREATE TYPE "WalletKeyAccessAction" AS ENUM (
    'SIGN',
    'EXPORT',
    'RECOVERY_CHALLENGE_CREATED',
    'RECOVERY_CHALLENGE_COMPLETED',
    'ROTATION'
);

-- CreateEnum
CREATE TYPE "WalletRecoveryChallengeStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED'
);

-- AlterTable
ALTER TABLE "UserWallet"
    ADD COLUMN "encryptedSecretKeyVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "lastRotatedAt" TIMESTAMP(3);

UPDATE "UserWallet"
SET "encryptedSecretKeyVersion" = "encryptionVersion"
WHERE "encryptedSecretKeyVersion" IS NULL;

-- CreateTable
CREATE TABLE "WalletKeyAccessAudit" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "WalletKeyAccessAction" NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "keyVersion" INTEGER,
    "metadata" JSONB,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletKeyAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletRecoveryChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "WalletRecoveryChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "requestId" TEXT,
    "requestedFromIp" TEXT,
    "requestedUserAgent" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletRecoveryChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletKeyAccessAudit_entryHash_key" ON "WalletKeyAccessAudit"("entryHash");

-- CreateIndex
CREATE INDEX "WalletKeyAccessAudit_walletId_createdAt_idx" ON "WalletKeyAccessAudit"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletKeyAccessAudit_actorUserId_createdAt_idx" ON "WalletKeyAccessAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletRecoveryChallenge_userId_status_expiresAt_idx" ON "WalletRecoveryChallenge"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletRecoveryChallenge_walletId_status_idx" ON "WalletRecoveryChallenge"("walletId", "status");

-- AddForeignKey
ALTER TABLE "WalletKeyAccessAudit"
    ADD CONSTRAINT "WalletKeyAccessAudit_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletKeyAccessAudit"
    ADD CONSTRAINT "WalletKeyAccessAudit_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRecoveryChallenge"
    ADD CONSTRAINT "WalletRecoveryChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRecoveryChallenge"
    ADD CONSTRAINT "WalletRecoveryChallenge_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
